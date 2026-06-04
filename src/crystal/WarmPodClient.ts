import type { RunPodClient } from './RunPodCursor.js'
import type { Materia, MateriaStore } from '../types/materia.js'
import type { ActumExecutio } from '../types/actum.js'
import type { R2Config } from './SecurePodClient.js'
import { SecurePodClient } from './SecurePodClient.js'
import { submitToRunner, awaitViaStream, installViaRunner, type InstallResult } from './comfyrunnerClient.js'
import type { ModelRef } from '../types/actum.js'
import type { ModelInstallClient, InstallProgress } from './ModelInstaller.js'
import { makeLogger } from '../lib/logger.js'
import { bus } from '../lib/bus.js'
import { getTrace } from '../lib/trace.js'

const log = makeLogger('cursor:runpod:warm')

interface WarmPodConfig {
  runnerReadyTimeoutMs?: number
  runnerPollIntervalMs?: number
  jobTimeoutMs?: number
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

  async submit(params: { input: unknown; webhook?: string; onPodActive?: (podId: string) => Promise<void>; onMetrics?: (executio: ActumExecutio) => Promise<void> }): Promise<{ id: string }> {
    const { id, externusId } = this.materia
    // Unique per-submission ID — reusing externusId would 409 on second job to same warm pod
    const jobId = `${externusId}-${Date.now()}`
    let runnerAcceptedJob = false

    // Signal "warm" so the Telegram layer reacts 🔥 (vs 👌 for a cold start), and
    // carry the pod id so the destroy button can terminate this warm pod.
    const ctx = getTrace()
    if (ctx?.actumId) bus.emit('actum.stage', { actumId: ctx.actumId, stage: 'warm-pod-found', elapsedMs: 0, info: { podId: externusId } })

    this._runBackground(params.input, params.webhook, jobId, (accepted) => { runnerAcceptedJob = accepted }, params.onMetrics)
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
  ): Promise<void> {
    const { id, externusId } = this.materia
    const runnerBase = this._runnerBase()
    let podReachable = false
    // Warm reuse: no provisioning cost, so coldStart is false. Download metrics
    // (if the warm pod was missing models) and execution time stream from comfyrunner.
    const executio: ActumExecutio = { podId: externusId, coldStart: false }

    try {
      await this._waitForRunner(runnerBase)
      podReachable = true

      await submitToRunner(this.fetchFn, runnerBase, jobId, input, webhook, this.config.r2)
      onRunnerAccepted(true)
      log.info('job submitted to comfyrunner', { materiaId: id, externusId, jobId })

      await awaitViaStream(
        this.fetchFn,
        runnerBase,
        jobId,
        this.config.jobTimeoutMs ?? 45 * 60 * 1000,
        undefined,
        (m) => { Object.assign(executio, m); void onMetrics?.({ ...executio }) },
      )
    } catch (err) {
      const msg = (err as Error).message ?? ''
      if (msg.includes('503') || msg.includes('ECONNREFUSED') || msg.includes('not reachable')) {
        podReachable = false
      }
      throw err
    } finally {
      const nextStatus = (!podReachable || this.materia.podPolicy === 'private') ? 'terminated' : 'idle'
      const patch: { status: 'terminated' | 'idle'; warmUntil?: Date } = { status: nextStatus }
      // Re-arm the idle deadline so the reaper gives this pod a fresh warm window
      // past *this* job's delivery (a follow-up within the window reuses it).
      if (nextStatus === 'idle') patch.warmUntil = new Date(Date.now() + (this.config.warmTtlMs ?? 60_000))
      await this.materiae.update(id, patch).catch(() => {})
    }
  }

  private async _waitForRunner(runnerBase: string): Promise<void> {
    const timeoutMs = this.config.runnerReadyTimeoutMs ?? 30_000
    const pollMs    = this.config.runnerPollIntervalMs ?? 2000
    const deadline  = Date.now() + timeoutMs
    while (Date.now() < deadline) {
      try {
        const res = await this.fetchFn(`${runnerBase}/health`, { signal: AbortSignal.timeout(5000) })
        if (res.ok) {
          const body = await res.json() as { status?: string }
          if (body.status === 'ready' || body.status === 'busy') return
        }
      } catch (_) {
        // not ready yet
      }
      await sleep(pollMs)
    }
    throw new Error(`comfyrunner not reachable on warm pod ${this.materia.externusId}`)
  }
}
