import type { RunPodClient } from './RunPodCursor.js'
import type { Materia, MateriaStore } from '../types/materia.js'
import type { ActumExecutio } from '../types/actum.js'
import type { R2Config } from './SecurePodClient.js'
import { SecurePodClient } from './SecurePodClient.js'
import { submitToRunner, awaitViaStream, installViaRunner, RunnerJobLost, type InstallResult } from './comfyrunnerClient.js'
import type { ModelRef } from '../types/actum.js'
import type { ModelInstallClient, InstallProgress } from './ModelInstaller.js'
import { makeLogger } from '../lib/logger.js'
import { getTrace } from '../lib/trace.js'
import { recordProgressus } from '../execution/progressusSink.js'
import { bus } from '../lib/bus.js'
import { coldStartProgressus } from '../execution/progressus.js'

const log = makeLogger('cursor:runpod:warm')

interface WarmPodConfig {
  runnerReadyTimeoutMs?: number
  runnerPollIntervalMs?: number
  /** Absolute COST ceiling for one job (ms). Protects against a job the runner still calls
   *  `running` (e.g. ComfyUI deadlocked inside a node) holding a paid GPU indefinitely — it is
   *  not what catches a dead job, so it stays generous enough to cover model downloads.
   *  Default 45 min. */
  jobTimeoutMs?: number
  /** How long the job's stream may go silent before we ask the runner whether the job is still
   *  alive (ms). Protects against a runner that lost the job (restart, crash): silence plus a
   *  `404` fails the run in about this long instead of at the cost ceiling. Default 60_000. */
  jobSilenceMs?: number
  r2?: R2Config
  /** How long the pod stays warm/idle after this job before the reaper kills it (ms). Default 60_000. */
  warmTtlMs?: number
}

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms))
}

/**
 * WarmPodClient — runs a ComfyUI job on an already-running SECURE pod.
 *
 * Submits the job to comfyrunner via the RunPod HTTP proxy. comfyrunner handles
 * model/custom-node preflight, inference, R2 upload, and fires the completion
 * webhook directly from the pod. Crystal subscribes to the SSE stream only to
 * track lifecycle (terminate vs keep-warm) and emit stage events to the bus.
 */
export class WarmPodClient implements RunPodClient, ModelInstallClient {
  constructor(
    private readonly materia: Materia,
    private readonly materiae: MateriaStore,
    private readonly fetchFn: typeof fetch = globalThis.fetch,
    private readonly config: WarmPodConfig = {},
  ) {}

  async submit(params: { input: unknown; webhook?: string; jobToken?: string; r2?: R2Config; onPodActive?: (podId: string) => Promise<void>; onMetrics?: (executio: ActumExecutio) => Promise<void> }): Promise<{ id: string }> {
    const { id, externusId } = this.materia
    // Unique per-submission ID — reusing externusId would 409 on second job to same warm pod
    const jobId = `${externusId}-${Date.now()}`
    let runnerAcceptedJob = false

    // Signal "warm" so the Telegram layer reacts 🔥 (vs 👌 for a cold start), and
    // carry the pod id so the destroy button can terminate this warm pod.
    const ctx = getTrace()
    if (ctx?.actumId) {
      // Warm reuse → a near-zero `provisioning`/'warm pod reused' Progressus (#6a): the Telegram
      // layer reacts 🔥 off this, and cold-vs-warm cost falls straight out of phaseDurations
      // (warm provisioning ≈ 0). Single owned channel since #6e retired the `actum.stage` shim.
      // Fire-and-forget but .catch — a recorder DB error must never break the run (§4).
      const prog = coldStartProgressus('warm-pod-found', { podId: externusId })
      if (prog) recordProgressus(ctx.actumId, { ...prog, at: new Date() }).catch(err => log.warn('progressus record failed', { error: (err as Error).message }))
    }

    this._runBackground(params.input, params.webhook, jobId, (accepted) => { runnerAcceptedJob = accepted }, params.onMetrics, params.jobToken, params.r2)
      .catch(async (err) => {
        log.error(`Materia ${externusId} job failed`, { materiaId: id, externusId, error: (err as Error).message })
        if (params.webhook && !runnerAcceptedJob) {
          // comfyrunner never received the job — Crystal is the only one that can fire this webhook
          for (let attempt = 0; attempt < 3; attempt++) {
            if (attempt) await new Promise(r => setTimeout(r, 1000 * attempt))
            try {
              const res = await this.fetchFn(params.webhook, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ id: jobId, status: 'FAILED', error: (err as Error).message }),
              })
              if (res.ok) break
            } catch (_) { /* retry */ }
          }
        }
      })

    // Return the per-submission jobId, not externusId: comfyrunner fires its
    // webhook keyed by jobId, and the actum's externusJobId must match it so the
    // completion webhook can find the actum. (externusId would 404 every time.)
    return { id: jobId }
  }

  /**
   * Download-only model install onto this warm pod (no gen). Waits for the runner, then POSTs the
   * refs to comfyrunner `/install`. Returns the download tally; the caller (ModelInstaller) merges
   * the ids into `Materia.installedModels`. (Real progress streaming is a later refinement — the
   * `/install` endpoint returns a final tally for now; `onProgress` is honored by the fake client.)
   */
  async installModels(models: ModelRef[], _onProgress?: (p: InstallProgress) => void): Promise<InstallResult> {
    const runnerBase = this._runnerBase()
    await this._waitForRunner(runnerBase)
    return installViaRunner(this.fetchFn, runnerBase, models, this.config.jobTimeoutMs)
  }

  // ── private ──────────────────────────────────────────────────────────────

  private _runnerBase(): string {
    return SecurePodClient.runnerBase(this.materia.externusId)
  }

  private async _runBackground(
    input: unknown,
    webhook: string | undefined,
    jobId: string,
    onRunnerAccepted: (accepted: boolean) => void,
    onMetrics?: (executio: ActumExecutio) => Promise<void>,
    jobToken?: string,
    /** Per-run object-store override (noema-347). A warm pod is reused across owners, so a
     *  private run's bucket + key prefix MUST ride the submission — never the pod's own config. */
    r2Override?: R2Config,
  ): Promise<void> {
    const { id, externusId } = this.materia
    const runnerBase = this._runnerBase()
    // Whether the runner ever answered for this job. Not a liveness verdict — the verdict is
    // asked for on the failure path below.
    let reachedRunner = false
    let jobFailed = false
    let failure: unknown
    // Warm reuse: no provisioning cost, so coldStart is false. Download metrics
    // (if the warm pod was missing models) and execution time stream from comfyrunner.
    const executio: ActumExecutio = { podId: externusId, coldStart: false }

    try {
      await this._waitForRunner(runnerBase)
      reachedRunner = true

      await submitToRunner(this.fetchFn, runnerBase, jobId, input, webhook, r2Override ?? this.config.r2, jobToken)
      onRunnerAccepted(true)
      log.info('job submitted to comfyrunner', { materiaId: id, externusId, jobId })

      await awaitViaStream(
        this.fetchFn,
        runnerBase,
        jobId,
        this.config.jobTimeoutMs ?? 45 * 60 * 1000,
        (m) => { Object.assign(executio, m); void onMetrics?.({ ...executio }) },
        this.config.jobSilenceMs ?? 60_000,
      )
    } catch (err) {
      jobFailed = true
      failure = err
      throw err
    } finally {
      // A pod's fate is ASKED, never read out of an error message. On the happy path the job just
      // delivered through this pod, so it is alive by construction and the happy path pays for no
      // extra network call. On the failure path we probe /health once: a failed JOB on a healthy
      // pod must leave the pod reusable, and a pod that cannot answer must not be re-armed warm.
      let podAlive = !jobFailed
      let probeAnswer: string | null = null
      if (jobFailed && reachedRunner) {
        probeAnswer = await this._probeRunnerOnce(runnerBase, 5_000)
        podAlive = probeAnswer === 'ready' || probeAnswer === 'busy' || probeAnswer === 'starting'
      }
      if (jobFailed) {
        const err = failure as Error | undefined
        const lostTheJob = failure instanceof RunnerJobLost
        const fields = {
          materiaId: id,
          externusId,
          jobId,
          errorName: err?.name ?? typeof failure,
          errorMessage: err?.message ?? String(failure),
          liveness: lostTheJob ? 'gone' : 'unclassified',
          probe: probeAnswer ?? 'no-answer',
        }
        // Taxonomy capture (stable message strings — these are meant to be grepped in pod logs).
        if (!lostTheJob) log.warn('warm job failed with an unclassified error', fields)
        else if (podAlive) log.warn('warm job liveness disagreement: runner lost the job but /health answers', fields)
      }
      const nextStatus = (!podAlive || this.materia.podPolicy === 'private') ? 'terminated' : 'idle'
      const patch: { status: 'terminated' | 'idle'; warmUntil?: Date } = { status: nextStatus }
      // Re-arm the idle deadline so the reaper gives this pod a fresh warm window
      // past *this* job's delivery (a follow-up within the window reuses it).
      //
      // EXTEND ONLY, NEVER SHORTEN. A host who bought a longer window — the warm-window
      // buttons stamp `warmUntil` directly, and `/arm` parks with the leased `warmMs` —
      // owns that deadline and is paying Census for it. Assigning `now + ttl`
      // unconditionally let the first job delivered on the pod collapse a 30-minute
      // window to the 60-second default, killing the pod under the host and ending any
      // chain of guests after the first. Re-read the stored deadline rather than trusting
      // `this.materia`, which is the snapshot taken when this client was built and does
      // not see a window set while the job was running.
      if (nextStatus === 'idle') {
        const floor = new Date(Date.now() + (this.config.warmTtlMs ?? 60_000))
        const stored = (await this.materiae.findById(id).catch(() => null))?.warmUntil
        patch.warmUntil = stored && stored > floor ? stored : floor
      }
      await this.materiae.update(id, patch).catch(() => {})
      // A pod going back to idle is the moment the warm-pod line has been waiting for.
      // Announced here rather than discovered by a poll, so a run that queued because
      // this pod was busy starts the instant it stops being busy. Only a pod that is
      // actually reusable is announced — a terminated one is not capacity.
      if (nextStatus === 'idle') {
        bus.emit('pod.idle', { materiaId: id, ...(this.materia.imageRef ? { imageRef: this.materia.imageRef } : {}) })
      }
    }
  }

  private async _waitForRunner(runnerBase: string): Promise<void> {
    const timeoutMs = this.config.runnerReadyTimeoutMs ?? 30_000
    const pollMs    = this.config.runnerPollIntervalMs ?? 2000
    const deadline  = Date.now() + timeoutMs
    while (Date.now() < deadline) {
      const status = await this._probeRunnerOnce(runnerBase, 5000)
      if (status === 'ready' || status === 'busy') return
      await sleep(pollMs)
    }
    throw new Error(`comfyrunner not reachable on warm pod ${this.materia.externusId}`)
  }

  /**
   * One `GET /health` against the runner. Returns the reported status (`starting`/`busy`/`ready`),
   * or null if the runner did not answer at all. The single health-check implementation: the
   * readiness poll loop and the post-failure fate probe both go through this.
   */
  private async _probeRunnerOnce(runnerBase: string, timeoutMs: number): Promise<string | null> {
    try {
      const res = await this.fetchFn(`${runnerBase}/health`, { signal: AbortSignal.timeout(timeoutMs) })
      if (!res.ok) return null
      const body = await res.json() as { status?: string }
      return typeof body.status === 'string' ? body.status : null
    } catch (_) {
      return null
    }
  }
}
