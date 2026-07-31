import fs from 'node:fs'
import path from 'node:path'
import type { RunPodClient, ProvisioningContext } from './RunPodCursor.js'
import type { Procurator, StudioStageCb, StudioProvision } from './Procurator.js'
import type { Materia, MateriaStore } from '../types/materia.js'
import type { HospitiumStore } from '../types/hospitium.js'
import type { ActumExecutio } from '../types/actum.js'
import { makeLogger } from '../lib/logger.js'
import { SshTransport } from './SshTransport.js'
import { getTrace } from '../lib/trace.js'
import { bus } from '../lib/bus.js'
import { recordProgressus } from '../execution/progressusSink.js'
import { coldStartProgressus } from '../execution/progressus.js'
import { terminatePod as _terminatePodUtil } from './terminatePod.js'
import { submitToRunner, awaitViaStream, isCompiledSpec, type R2Config } from './comfyrunnerClient.js'
import { computeBootCostImpetus, impetusPerSecondFromHourly } from '../ledger/rates.js'

const COMFYRUNNER_SCRIPT_PATH = path.resolve(__dirname, '../../scripts/pod/comfyrunner.py')
// The multi-runtime runner (ADR-0007) — shipped for non-ComfyUI runtimes (vLLM). ComfyUI stays on
// comfyrunner.py until its cutover is live-verified, so the proven gen path is untouched.
const RUNNER_SCRIPT_PATH = path.resolve(__dirname, '../../scripts/pod/runner.py')
// The one-shot LoRA trainer (Slice E) — launched detached for a long single job (not the
// VRAM-scheduled runner.py, not comfyrunner's held SSE pipeline).
const AITKTRAINER_SCRIPT_PATH = path.resolve(__dirname, '../../scripts/pod/aitktrainer.py')

const log = makeLogger('cursor:runpod:secure')

// Pinned ComfyUI ref (2026-07-10 P0): bootstrap used to clone unpinned HEAD, which drifted onto a
// torch-2.5+-only code path (`enable_gqa` kwarg) while every fundament's image pins torch 2.4.0 —
// every ComfyUI pod broke. `Fundamentum.comfyRef` is the per-substrate source of truth (ADR-0005);
// this constant is the fallback when a caller doesn't have one to pass (submit()'s CompiledSpec
// doesn't yet carry comfyRef — a Compiler-side follow-up, out of this fix's scope). Bump both this
// and every Fundamentum.comfyRef together; never let the clone go unpinned again.
const DEFAULT_COMFYUI_REF = 'v0.26.0'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type { R2Config } from './comfyrunnerClient.js'

// Ordered by preference: 24GB VRAM SECURE-tier GPUs first, then fallbacks
// All GPUs with ≥24 GB VRAM — needed for the full BF16 FLUX model.
// Ordered roughly by expected speed (fastest/most available first).
//
// Every entry MUST be present in ACCEPTED_GPU_TYPE_IDS below (RunPod's current
// gpuTypeIds enum). RunPod's REST API rejects an unknown gpuTypeId with a 400 on
// POST rest.runpod.io/v1/pods — a stale/renamed SKU here silently degrades the
// SECURE tier (both SECURE attempts 400 and the run falls back to COMMUNITY, losing
// the private/TEE guarantee). `assertGpuTypeIdsAccepted` enforces this at construct
// time so a future enum drift fails loud and early instead of as a mid-provision 400.
// (noema-103, 2026-07-14: pruned the A30 SKU — absent from RunPod's accepted enum.)
export const DEFAULT_GPU_TYPE_IDS = [
  'NVIDIA GeForce RTX 4090',
  'NVIDIA GeForce RTX 3090',
  'NVIDIA GeForce RTX 3090 Ti',
  'NVIDIA RTX A5000',
  'NVIDIA A40',
  'NVIDIA L4',
  'NVIDIA L40',
  'NVIDIA L40S',
  'NVIDIA RTX A6000',
  'NVIDIA RTX 6000 Ada Generation',
  'NVIDIA A100 80GB PCIe',
  'NVIDIA A100-SXM4-80GB',
  'NVIDIA H100 PCIe',
  'NVIDIA H100 NVL',
  'NVIDIA H100 80GB HBM3',
  'NVIDIA RTX A4500',
  'NVIDIA RTX 4000 Ada Generation',
]

// RunPod's accepted `gpuTypeIds` enum, snapshotted verbatim from the staging 400 body
// (2026-07-31). This is the authoritative allow-list DEFAULT_GPU_TYPE_IDS is validated
// against at construct time. When RunPod changes its catalogue the construct-time guard
// throws naming the offending SKU — refresh this snapshot (and prune DEFAULT_GPU_TYPE_IDS
// to match) rather than suppressing the error.
export const ACCEPTED_GPU_TYPE_IDS = [
  'AMD Instinct MI300X OAM',
  'NVIDIA A100 80GB PCIe',
  'NVIDIA A100-SXM4-40GB',
  'NVIDIA A100-SXM4-80GB',
  'NVIDIA A40',
  'NVIDIA B200',
  'NVIDIA B300 SXM6 AC',
  'NVIDIA B300 SXM6 AC MIG 1g.34gb',
  'NVIDIA GeForce RTX 3070',
  'NVIDIA GeForce RTX 3080',
  'NVIDIA GeForce RTX 3080 Ti',
  'NVIDIA GeForce RTX 3090',
  'NVIDIA GeForce RTX 3090 Ti',
  'NVIDIA GeForce RTX 4070 Ti',
  'NVIDIA GeForce RTX 4080',
  'NVIDIA GeForce RTX 4080 SUPER',
  'NVIDIA GeForce RTX 4090',
  'NVIDIA GeForce RTX 5080',
  'NVIDIA GeForce RTX 5090',
  'NVIDIA H100 80GB HBM3',
  'NVIDIA H100 NVL',
  'NVIDIA H100 PCIe',
  'NVIDIA H200',
  'NVIDIA H200 NVL',
  'NVIDIA L4',
  'NVIDIA L40',
  'NVIDIA L40S',
  'NVIDIA RTX 2000 Ada Generation',
  'NVIDIA RTX 4000 Ada Generation',
  'NVIDIA RTX 4000 SFF Ada Generation',
  'NVIDIA RTX 5000 Ada Generation',
  'NVIDIA RTX 6000 Ada Generation',
  'NVIDIA RTX A2000',
  'NVIDIA RTX A4000',
  'NVIDIA RTX A4500',
  'NVIDIA RTX A5000',
  'NVIDIA RTX A6000',
  'NVIDIA RTX PRO 4000 Blackwell',
  'NVIDIA RTX PRO 4500 Blackwell',
  'NVIDIA RTX PRO 5000 Blackwell',
  'NVIDIA RTX PRO 6000 Blackwell Max-Q Workstation Edition',
  'NVIDIA RTX PRO 6000 Blackwell Server Edition',
  'NVIDIA RTX PRO 6000 Blackwell Workstation Edition',
  'Tesla V100-PCIE-16GB',
  'Tesla V100-SXM2-16GB',
]

/**
 * Construct-time guard (noema-103): assert every id in `ids` is present in RunPod's
 * accepted `gpuTypeIds` enum (`accepted`, default ACCEPTED_GPU_TYPE_IDS). Throws an Error
 * naming the specific offending SKU(s) so a RunPod enum drift fails loud and early —
 * before ever reaching a live provision POST — instead of surfacing as an opaque 400.
 */
export function assertGpuTypeIdsAccepted(
  ids: readonly string[],
  accepted: readonly string[] = ACCEPTED_GPU_TYPE_IDS,
): void {
  const offending = ids.filter(id => !accepted.includes(id))
  if (offending.length > 0) {
    throw new Error(
      `SecurePodClient: DEFAULT_GPU_TYPE_IDS contains GPU type id(s) not in RunPod's ` +
      `accepted gpuTypeIds enum: ${offending.map(s => `'${s}'`).join(', ')}. RunPod ` +
      `rejects unknown gpuTypeIds with a 400 on pod provision. Update DEFAULT_GPU_TYPE_IDS ` +
      `and/or the ACCEPTED_GPU_TYPE_IDS snapshot to match RunPod's current enum.`,
    )
  }
}

export interface SecurePodConfig {
  apiKey: string
  sshKeyPath: string
  gpuTypeIds?: string[]   // defaults to DEFAULT_GPU_TYPE_IDS
  imageName?: string      // defaults to spec.image.ociRef at runtime
  cloudType?: 'SECURE' | 'COMMUNITY'
  containerDiskGb?: number
  /** Overrideable timeouts (ms) — defaults tuned for production, inject small values in tests. */
  provisionTimeoutMs?: number    // default: 30_000 — per-request timeout for the pod creation POST
  sshInfoTimeoutMs?: number      // default: 10_000 — per-request timeout for each SSH status poll GET
  sshReadyTimeoutMs?: number     // default: 10 min  — overall deadline for SSH to become reachable
  sshPollIntervalMs?: number     // default: 8000
  comfyReadyTimeoutMs?: number   // default: 5 min
  comfyPollIntervalMs?: number   // default: 2000
  jobTimeoutMs?: number          // default: 15 min
  /** How many times to retry the COMPLETED webhook POST on failure (default: 3). */
  webhookRetries?: number        // default: 3
  /** Base delay between webhook retries in ms; doubles each attempt (default: 1000). */
  webhookRetryDelayMs?: number   // default: 1000
  /** When true: register pod as idle Materia instead of terminating after a successful job. */
  keepWarm?: boolean
  /** How long a pod stays warm/idle before the reaper terminates it (ms). Default 60_000. */
  warmTtlMs?: number
  /** Cost rate for the Materia record (default 0n). */
  impetusPerSecond?: bigint
  /** How many pod provision attempts before giving up (default: 3; last attempt uses COMMUNITY cloud). */
  podRetries?: number
  /** When set, output files are uploaded to R2 before posting the completion webhook. */
  r2?: R2Config
}

export interface SshTransportLike {
  exec(command: string, options?: { stdio?: string; timeout?: number }): Promise<string | undefined>
  close(): Promise<void>
}

interface SshInfo {
  host: string
  port: number
  user: string
  costPerHr?: number
  gpuType?: string
  region?: string
}

interface RunPodPodStatus {
  desiredStatus?: string
  publicIp?: string
  portMappings?: Record<string, number>
  costPerHr?: number
  gpuTypeIds?: string[]
  machine?: { gpuDisplayName?: string; dataCenterId?: string; location?: string }
}

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms))
}

/** Single-quote a value for a POSIX shell command line (escapes embedded single quotes). */
function shellQuote(v: string): string {
  return `'${v.replace(/'/g, `'\\''`)}'`
}

// ---------------------------------------------------------------------------
// SecurePodClient
// ---------------------------------------------------------------------------

// `StudioStageCb` (the `/arm` provisioning stage callback) is the Procurator role's
// type — re-exported here for the existing importers.
export type { StudioStageCb } from './Procurator.js'

export class SecurePodClient implements RunPodClient, Procurator {
  constructor(
    private readonly config: SecurePodConfig,
    private readonly sshFactory: (info: SshInfo) => SshTransportLike,
    private readonly fetchFn: typeof fetch = globalThis.fetch,
    private readonly materiae?: MateriaStore,
    /** Hospitium side-table — when present, a host-guest bond record is created
     *  alongside each warm-parked Materia so dispatch can find the host's anima
     *  without putting identity on the pod's row. */
    private readonly hospitia?: HospitiumStore,
    /** Injectable pod-terminate function — defaults to the RunPod REST call. The
     *  seam exists so tests can swap a spy without module-mocking gymnastics. */
    private readonly terminatePodFn: (apiKey: string, podId: string) => Promise<void> = _terminatePodUtil,
    /**
     * Liveness check for the actum a retry is about to spend a pod on — reads the actum's
     * current status and returns false once it's terminal (`completus`/`fractus`, which also
     * covers the expiry watchdog's fail path). Optional: absent means "can't check" and retries
     * proceed as before (back-compat for callers with no store wired). Bounded to the smallest
     * read surface the retry loop needs — not a full Actorum dependency.
     */
    private readonly isActumLive?: (actumId: string) => Promise<boolean>,
  ) {
    // Fail loud and early if the hardcoded SECURE-tier GPU preference list has drifted
    // out of RunPod's accepted gpuTypeIds enum — surfaces the offending SKU here rather
    // than as an opaque 400 mid-provision (noema-103).
    assertGpuTypeIdsAccepted(DEFAULT_GPU_TYPE_IDS)
  }

  /**
   * Zombie-retry guard (2026-07-13): re-checks the in-flight actum's liveness before spending
   * another pod on it. Fails OPEN (returns true) when there's no actumId in trace or no
   * `isActumLive` callback wired, and on a callback error — a liveness-check hiccup must never
   * block a legitimate retry; the guard only ever narrows the retry loop, never widens it.
   */
  private async _actumStillLive(): Promise<boolean> {
    const actumId = getTrace()?.actumId
    if (!actumId || !this.isActumLive) return true
    try {
      return await this.isActumLive(actumId)
    } catch {
      return true
    }
  }

  async submit(params: {
    input: unknown
    webhook?: string
    jobToken?: string
    provisioningContext?: ProvisioningContext
    onPodActive?: (podId: string) => Promise<void>
    onMetrics?: (executio: ActumExecutio) => Promise<void>
  }): Promise<{ id: string }> {
    // Derive image from spec if available, else fall back to config
    const specOciRef = isCompiledSpec(params.input) ? params.input.image?.ociRef : undefined
    const imageName = specOciRef ?? this.config.imageName ?? 'runpod/pytorch:2.4.0-py3.11-cuda12.4.1-devel-ubuntu22.04'

    const maxAttempts = this.config.podRetries ?? 3

    // Provision with retries — synchronous so we return a real pod ID
    // Attempts 1-2: SECURE cloud. Attempt 3: ALL cloud (community fallback).
    let podId: string | undefined
    let lastProvisionErr: Error | undefined
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const isFallback = attempt >= maxAttempts
      const cloudType = isFallback ? 'COMMUNITY' : undefined
      const gpuTypeIds = isFallback ? null : undefined  // null = any GPU on final attempt
      if (attempt > 1) log.info('retrying pod provision', { attempt, cloudType: cloudType ?? 'SECURE' })
      log.info('pod provisioning', { actumId: getTrace()?.actumId, imageName, cloudType: cloudType ?? 'SECURE' })
      try {
        podId = await this._provisionPod(imageName, cloudType, gpuTypeIds)
        break
      } catch (err) {
        lastProvisionErr = err as Error
        log.warn(`provision attempt ${attempt}/${maxAttempts} failed`, { error: lastProvisionErr.message })
      }
    }
    if (!podId) throw lastProvisionErr

    const _traceCtx = getTrace()
    if (_traceCtx) {
      _traceCtx.wideFields.podId = podId
      _traceCtx.provisionMs = Date.now() - _traceCtx.startTs
    }

    let activePodId = podId
    // Tracks whether comfyrunner accepted the job. Once true, comfyrunner owns
    // the failure webhook — Crystal must not fire a second one.
    let runnerAcceptedJob = false
    const runWithRetry = async () => {
      try {
        await this._runBackground(podId!, imageName, params.input, params.webhook, undefined, (accepted) => { runnerAcceptedJob = accepted }, params.onMetrics, params.provisioningContext, params.jobToken)
      } catch (firstErr) {
        // Once comfyrunner accepted the job it OWNS the run and the webhook. A
        // dropped SSE stream after that point means we lost visibility, not that
        // the job failed — re-provisioning would spawn a redundant pod and
        // re-download every model. Stop here and let comfyrunner fire the webhook.
        // EXCEPTION: a throttle bail is a deliberate "this pod is fleecing us" abort
        // — we DO want to re-provision on a fresh pod, so let it fall through to retry.
        if (runnerAcceptedJob && !(firstErr as { isThrottleError?: boolean }).isThrottleError) {
          log.warn('lost SSE after comfyrunner accepted job — not retrying; comfyrunner owns the webhook', { podId, error: (firstErr as Error).message })
          return
        }
        // A permanent (4xx) error is deterministic — a fresh pod hits the same rejection. Fail fast
        // instead of burning more provisions (each re-runs the heavy bootstrap + model download).
        if ((firstErr as { permanent?: boolean }).permanent) {
          log.warn('pod run failed permanently — not retrying', { podId, error: (firstErr as Error).message })
          throw firstErr
        }
        log.warn(`pod run attempt 1/${maxAttempts} failed`, { podId, error: (firstErr as Error).message })
        for (let attempt = 2; attempt <= maxAttempts; attempt++) {
          // Liveness gate — before spending a NEW pod on a retry, confirm the actum this
          // job belongs to hasn't already gone terminal (e.g. the expiry watchdog fired
          // mid-retry and refunded it). Without this, a slow retry cascade keeps
          // provisioning pods for a run nobody is paying for anymore (2026-07-13 incident).
          if (!(await this._actumStillLive())) {
            log.warn('retry aborted — actum already terminal', { actumId: getTrace()?.actumId, attempt })
            return
          }
          log.info('retrying on new pod', { attempt })
          let retryPodId: string
          try {
            retryPodId = await this._provisionPod(imageName)
          } catch (provErr) {
            log.warn(`provision retry ${attempt}/${maxAttempts} failed`, { error: (provErr as Error).message })
            if (attempt === maxAttempts) throw provErr
            continue
          }
          activePodId = retryPodId
          // Second gate — the actum could have gone terminal during provisioning itself;
          // check again before submitting the job so we don't hand comfyrunner work for a
          // dead run, and terminate the pod we just spun up instead of leaking it.
          if (!(await this._actumStillLive())) {
            log.warn('retry aborted — actum already terminal', { actumId: getTrace()?.actumId, attempt })
            await this._terminatePod(retryPodId).catch(() => {})
            return
          }
          // Update DB so the retry pod is tracked; webhook will fire with retryPodId
          await params.onPodActive?.(retryPodId).catch(() => {})
          try {
            await this._runBackground(retryPodId, imageName, params.input, params.webhook, retryPodId, (accepted) => { runnerAcceptedJob = accepted }, params.onMetrics, params.provisioningContext, params.jobToken)
            return
          } catch (runErr) {
            if (runnerAcceptedJob && !(runErr as { isThrottleError?: boolean }).isThrottleError) {
              log.warn('lost SSE after comfyrunner accepted job — not retrying; comfyrunner owns the webhook', { podId: retryPodId, error: (runErr as Error).message })
              return
            }
            if ((runErr as { permanent?: boolean }).permanent) {
              log.warn('pod run failed permanently — not retrying', { podId: retryPodId, error: (runErr as Error).message })
              throw runErr
            }
            log.warn(`pod run attempt ${attempt}/${maxAttempts} failed`, { podId: retryPodId, error: (runErr as Error).message })
            if (attempt === maxAttempts) throw runErr
          }
        }
      }
    }

    runWithRetry().catch(async (err) => {
      log.error(`Pod ${activePodId} failed`, { podId: activePodId, error: (err as Error).message })
      // Only fire Crystal-side webhook when comfyrunner never accepted the job —
      // EXCEPT when we exhausted throttle-retries: comfyrunner accepted but we
      // deliberately bailed every pod, so no webhook is coming and the client must
      // be told (and refunded) "no good pods available".
      if (params.webhook && (!runnerAcceptedJob || (err as { isThrottleError?: boolean }).isThrottleError)) {
        // Key the failure webhook by `activePodId` — retries advance the actum's
        // externusJobId (via onPodActive) to the LAST pod, so posting the FIRST pod's
        // id 404s and the run never reaches `fractus` (incident 2026-06-19).
        await this._postWebhook(params.webhook, { id: activePodId, status: 'FAILED', error: (err as Error).message })
          .catch(() => {})
      }
    })

    return { id: podId }
  }

  /**
   * `/arm` Start — provision a warm studio with NO gen (Part A real). Provisions a pod, bootstraps
   * comfyrunner to ready, then parks it warm (an idle `Materia`) — the same record `submit` builds
   * on a successful gen, minus the job. Returns pod telemetry for the bulletin journal, or null on
   * failure (the pod is terminated). Models are applied afterward via the live-install path.
   */
  async provisionStudio(
    opts: { runtime?: string; comfyRef?: string; warmMs?: number; provisioningContext?: ProvisioningContext } = {},
    onStage?: StudioStageCb,
  ): Promise<StudioProvision | null> {
    const imageName = this.config.imageName ?? 'runpod/pytorch:2.4.0-py3.11-cuda12.4.1-devel-ubuntu22.04'
    let prov: { podId: string; sshInfo: SshInfo; provisionMs: number }
    try {
      prov = await this._provisionAndBootstrap(imageName, onStage, opts.runtime, opts.comfyRef)
    } catch (err) {
      log.warn('studio provision failed', { error: (err as Error).message })
      return null
    }
    const materia = await this._parkWarm(prov.podId, prov.sshInfo, imageName, prov.provisionMs, opts.runtime, opts.warmMs, opts.provisioningContext)
    if (!materia) { await this._terminatePod(prov.podId).catch(() => {}); return null }
    return {
      podId: prov.podId,
      ...(prov.sshInfo.gpuType ? { gpuType: prov.sshInfo.gpuType } : {}),
      ...(typeof prov.sshInfo.costPerHr === 'number' ? { costPerHr: prov.sshInfo.costPerHr } : {}),
      provisionMs: prov.provisionMs,
    }
  }

  /**
   * Provision a SECURE pod and launch a DETACHED pod script (Slice E training) — NOT submit()'s
   * held SSE pipeline (built for short gens) and NOT runner.py's VRAM scheduler. For one long
   * single-shot job: provision (SECURE for attempts 1-2, COMMUNITY/any-GPU on the last), wait SSH,
   * run `setup` (bootstrap ai-toolkit onto the stock torch≥2.9 base — clone + pip install its
   * deps), upload `aitktrainer.py`, nohup-launch it with `env` (+ injected RUNPOD_POD_ID = the pod
   * id), close SSH, return the pod id. Fire-and-forget — the pod posts its own `/runner/status` +
   * completion webhook. `image` is a stock RunPod base (SSH-ready). GPU-gated: live-verified, not
   * CI-covered (the launcher's logic + the setup recipe are tested hermetically).
   */
  async launchTrainingPod(opts: { image: string; env: Record<string, string>; setup: string[] }): Promise<{ podId: string }> {
    const maxAttempts = this.config.podRetries ?? 3
    let podId: string | undefined
    let lastErr: Error | undefined
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const isFallback = attempt >= maxAttempts
      try {
        podId = await this._provisionPod(opts.image, isFallback ? 'COMMUNITY' : undefined, isFallback ? null : undefined)
        break
      } catch (err) {
        lastErr = err as Error
        log.warn(`training pod provision attempt ${attempt}/${maxAttempts} failed`, { error: lastErr.message })
      }
    }
    if (!podId) throw lastErr ?? new Error('training pod provision failed')

    let ssh: SshTransportLike | null = null
    try {
      const sshInfo = await this._waitForSsh(podId)
      log.info('training pod locked', { podId, gpuType: sshInfo.gpuType, costPerHr: sshInfo.costPerHr })
      ssh = await this._waitForSshd(sshInfo)
      await this._bootstrapDetached(ssh, podId, AITKTRAINER_SCRIPT_PATH, 'aitktrainer.py',
        { ...opts.env, RUNPOD_POD_ID: podId }, opts.setup)
      await ssh.close()
      ssh = null
      return { podId }
    } catch (err) {
      await ssh?.close().catch(() => {})
      await this._terminatePod(podId).catch(() => {})   // don't leak a pod whose job never started
      throw err
    }
  }

  /**
   * Run the `setup` bootstrap commands over SSH (clone ai-toolkit + pip install its deps onto the
   * stock base), then upload a pod script and launch it DETACHED with `env` (nohup) — the pod owns
   * its own status + completion webhook from here. Setup gets a generous timeout (the pip install is
   * the slow step). Env values are shell-quoted (base64 blobs + URLs).
   */
  private async _bootstrapDetached(
    ssh: SshTransportLike, podId: string, scriptPath: string, scriptName: string,
    env: Record<string, string>, setup: string[] = [],
  ): Promise<void> {
    log.info('bootstrapping training pod', { podId, script: scriptName, setupSteps: setup.length })
    for (const cmd of setup) {
      await ssh.exec(cmd, { timeout: 1_200_000 })   // pip install of the ai-toolkit dep tree is slow
    }
    const script = fs.readFileSync(scriptPath, 'utf8')
    const b64 = Buffer.from(script).toString('base64').replace(/\n/g, '')
    await ssh.exec(`echo '${b64}' | base64 -d > /root/${scriptName}`, { timeout: 10_000 })
    const envStr = Object.entries(env).map(([k, v]) => `${k}=${shellQuote(v)}`).join(' ')
    await ssh.exec(`${envStr} nohup python3 /root/${scriptName} >> /tmp/${scriptName}.log 2>&1 &`, { timeout: 10_000 })
    log.info('training pod launched', { podId })
  }

  // ── private ──────────────────────────────────────────────────────────────

  /**
   * Provision a pod and bring comfyrunner to ready WITHOUT submitting a job — the front half of the
   * gen path (provision-with-retries → SSH → bootstrap → /health ready). Emits the same stages.
   * Terminates the pod and rethrows on any failure so no pod leaks. (`submit` keeps its own inline
   * version because it interleaves job retry/throttle logic; this is the provision-only path.)
   */
  private async _provisionAndBootstrap(
    imageName: string,
    onStage?: StudioStageCb,
    runtime?: string,
    comfyRef?: string,
  ): Promise<{ podId: string; sshInfo: SshInfo; provisionMs: number }> {
    const startMs = Date.now()
    const signal = (stage: string, info?: import('../lib/bus.js').StageInfo) => {
      const ctx = getTrace()
      if (ctx?.actumId) {
        // Record the cold-start phase onto the owned Progressus timeline (#6a). Maps only the
        // pod-lifecycle stages; comfyrunner's own stages return undefined (it records those).
        // Fire-and-forget but .catch — a recorder DB error must never break the run (§4).
        const prog = coldStartProgressus(stage, info)
        if (prog) recordProgressus(ctx.actumId, { ...prog, at: new Date() }).catch(err => log.warn('progressus record failed', { error: (err as Error).message }))
      }
      onStage?.(stage, info)   // direct callback for the /arm bulletin (no actumId/trace in that path)
    }

    // Provision with retries — SECURE for attempts 1-2, COMMUNITY/any-GPU on the last (mirrors submit).
    const maxAttempts = this.config.podRetries ?? 3
    let podId: string | undefined
    let lastErr: Error | undefined
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const isFallback = attempt >= maxAttempts
      try {
        podId = await this._provisionPod(imageName, isFallback ? 'COMMUNITY' : undefined, isFallback ? null : undefined)
        break
      } catch (err) {
        lastErr = err as Error
        log.warn(`studio provision attempt ${attempt}/${maxAttempts} failed`, { error: lastErr.message })
      }
    }
    if (!podId) throw lastErr ?? new Error('pod provision failed')

    let ssh: SshTransportLike | null = null
    try {
      signal('provisioning')
      const sshInfo = await this._waitForSsh(podId)
      signal('pod-locked', { gpuType: sshInfo.gpuType, region: sshInfo.region, costPerHr: sshInfo.costPerHr, podId })
      ssh = await this._waitForSshd(sshInfo)
      signal('bootstrapping')
      await this._bootstrap(ssh, podId, runtime, comfyRef)
      await ssh.close()
      ssh = null
      await this._waitForRunner(SecurePodClient.runnerBase(podId))
      signal('comfy-ready')
      return { podId, sshInfo, provisionMs: Date.now() - startMs }
    } catch (err) {
      await ssh?.close().catch(() => {})
      await this._terminatePod(podId).catch(() => {})   // don't leak a half-provisioned pod
      throw err
    }
  }

  private async _postWebhook(url: string, body: unknown): Promise<void> {
    const retries = this.config.webhookRetries ?? 3
    const baseDelayMs = this.config.webhookRetryDelayMs ?? 1000
    let lastError: unknown
    for (let attempt = 0; attempt <= retries; attempt++) {
      if (attempt > 0) await sleep(baseDelayMs * (2 ** (attempt - 1)))
      try {
        const res = await this.fetchFn(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        })
        if (res.ok) return
        const errBody = await res.text().catch(() => '')
        log.warn('webhook POST failed', { attempt, status: res.status, body: errBody })
        lastError = new Error(`webhook POST returned ${res.status}`)
      } catch (err) {
        lastError = err
      }
    }
    throw lastError
  }

  private async _fetchWithTimeout(url: string, init: RequestInit, ms: number): Promise<Response> {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), ms)
    try {
      return await this.fetchFn(url, { ...init, signal: controller.signal })
    } finally {
      clearTimeout(timer)
    }
  }

  // gpuTypeIds=null → omit from request (let RunPod pick any available GPU)
  private async _provisionPod(imageName: string, cloudType?: string, gpuTypeIds?: string[] | null): Promise<string> {
    const resolvedGpus = gpuTypeIds !== undefined ? gpuTypeIds : (this.config.gpuTypeIds ?? DEFAULT_GPU_TYPE_IDS)
    const body: Record<string, unknown> = {
      name: `noema-${Date.now()}`,
      imageName,
      gpuCount: 1,
      cloudType: cloudType ?? this.config.cloudType ?? 'SECURE',
      containerDiskInGb: this.config.containerDiskGb ?? 40,
      ports: ['22/tcp', '8188/http', '8080/http'],
      supportPublicIp: true,
    }
    if (resolvedGpus !== null) body.gpuTypeIds = resolvedGpus
    const res = await this._fetchWithTimeout('https://rest.runpod.io/v1/pods', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.config.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    }, this.config.provisionTimeoutMs ?? 30_000)

    if (!res.ok) {
      const text = await res.text().catch(() => '')
      throw new Error(`RunPod pod provision failed: ${res.status} ${text}`)
    }

    const data = await res.json() as { id: string }
    return data.id
  }

  private async _waitForSsh(podId: string): Promise<SshInfo> {
    const timeoutMs = this.config.sshReadyTimeoutMs ?? 10 * 60 * 1000
    const pollMs = this.config.sshPollIntervalMs ?? 8000
    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline) {
      const info = await this._getSshInfo(podId)
      if (info) {
        const sshCtx = getTrace()
        log.info('pod SSH ready', {
          podId,
          elapsedMs: Date.now() - (sshCtx?.startTs ?? Date.now()),
        })
        // After SSH becomes ready — record elapsed and cursorType
        if (sshCtx) {
          sshCtx.sshReadyMs = Date.now() - sshCtx.startTs
          sshCtx.wideFields.cursorType = 'runpod:secure'
        }
        return info
      }
      await sleep(pollMs)
    }
    throw new Error(`Pod ${podId} SSH not ready within ${timeoutMs}ms`)
  }

  private async _getSshInfo(podId: string): Promise<SshInfo | null> {
    let res: Response
    try {
      res = await this._fetchWithTimeout(`https://rest.runpod.io/v1/pods/${podId}`, {
        headers: { 'Authorization': `Bearer ${this.config.apiKey}` },
      }, this.config.sshInfoTimeoutMs ?? 10_000)
    } catch {
      // Timeout or network error on a single poll — treat as not-ready.
      // _waitForSsh deadline governs the overall give-up point.
      return null
    }
    if (!res.ok) return null

    const data = await res.json() as RunPodPodStatus
    log.debug('pod status poll', {
      podId,
      desiredStatus: data.desiredStatus,
      publicIp: data.publicIp,
      portMappings: data.portMappings,
    })
    if (data.desiredStatus !== 'RUNNING') return null
    if (!data.publicIp) return null

    const sshPort = data.portMappings?.['22']
    if (!sshPort) return null

    const gpuType = data.machine?.gpuDisplayName ?? data.gpuTypeIds?.[0]
    const region  = data.machine?.dataCenterId ?? data.machine?.location
    return { host: data.publicIp, port: sshPort, user: 'root', costPerHr: data.costPerHr, gpuType, region }
  }

  private async _terminatePod(podId: string): Promise<void> {
    await this.terminatePodFn(this.config.apiKey, podId)
  }

  // externusJobId: the job ID stored on the actum (always the first pod's ID, even on retries)
  // onRunnerAccepted: called with true once comfyrunner has accepted the job (owns the webhook from that point)
  private async _runBackground(
    podId: string,
    imageName: string,
    input: unknown,
    webhook: string | undefined,
    externusJobId?: string,
    onRunnerAccepted?: (accepted: boolean) => void,
    onMetrics?: (executio: ActumExecutio) => Promise<void>,
    provisioningContext?: ProvisioningContext,
    jobToken?: string,
  ): Promise<void> {
    const startMs = Date.now()
    let ssh: SshTransportLike | null = null
    let sshInfo: SshInfo | null = null
    const signal = (stage: string, info?: import('../lib/bus.js').StageInfo) => {
      const ctx = getTrace()
      if (ctx?.actumId) {
        const prog = coldStartProgressus(stage, info)   // cold-start phases onto the owned timeline (#6a)
        if (prog) recordProgressus(ctx.actumId, { ...prog, at: new Date() }).catch(err => log.warn('progressus record failed', { error: (err as Error).message }))
      }
    }
    // Pod telemetry accumulated as the job runs and persisted onto the actum
    // (via onMetrics) before completion — the completion webhook can't see this
    // in-flight state otherwise. Each report sends the full accumulated object.
    const executio: ActumExecutio = { podId, coldStart: true }
    const reportMetrics = () => { void onMetrics?.({ ...executio }) }
    let jobSucceeded = false

    try {
      signal('provisioning')
      sshInfo = await this._waitForSsh(podId)
      executio.provisionMs = Date.now() - startMs
      executio.costPerHr = sshInfo.costPerHr
      executio.gpuType = sshInfo.gpuType
      // Pod acquired — surface GPU/region/price to the user the moment we lock on.
      log.info('pod locked', { podId, gpuType: sshInfo.gpuType, region: sshInfo.region, costPerHr: sshInfo.costPerHr })
      signal('pod-locked', { gpuType: sshInfo.gpuType, region: sshInfo.region, costPerHr: sshInfo.costPerHr, podId })
      ssh = await this._waitForSshd(sshInfo)
      executio.sshReadyMs = Date.now() - startMs
      reportMetrics()  // persist provision/ssh/podId/costPerHr — survives even if download fails
      signal('bootstrapping')
      // `comfyRef` isn't on CompiledSpecLike yet (Compiler-side follow-up); read it defensively so a
      // future compiled spec that does carry it is honored without another SecurePodClient change.
      const specComfyRef = isCompiledSpec(input) ? (input as { comfyRef?: string }).comfyRef : undefined
      await this._bootstrap(ssh, podId, isCompiledSpec(input) ? input.runtime : undefined, specComfyRef)

      // SSH only needed for bootstrap — close before HTTP phase
      await ssh.close()
      ssh = null

      const runnerBase = SecurePodClient.runnerBase(podId)
      await this._waitForRunner(runnerBase)
      signal('comfy-ready')

      const jobId = externusJobId ?? podId
      await submitToRunner(this.fetchFn, runnerBase, jobId, input, webhook, this.config.r2, jobToken)
      onRunnerAccepted?.(true)  // comfyrunner now owns the failure webhook

      const submitCtx = getTrace()
      if (submitCtx) submitCtx.jobSubmitMs = Date.now() - submitCtx.startTs

      // comfyrunner fires the webhook; we subscribe to SSE only to know when done
      // (so we can terminate/warm the pod). comfyrunner records its own Progressus timeline
      // through the in-process recorder seam — no stage callback needed (#6e).
      await awaitViaStream(
        this.fetchFn, runnerBase, jobId, this.config.jobTimeoutMs ?? 45 * 60 * 1000,
        (m) => { Object.assign(executio, m); reportMetrics() },
      )
      jobSucceeded = true
    } finally {
      await ssh?.close().catch(() => {})
      if (jobSucceeded && this.config.keepWarm && this.materiae && sshInfo) {
        // Boot wall-clock — the cost we now ask future guests to amortize.
        const runtime = isCompiledSpec(input) ? input.runtime : undefined
        await this._parkWarm(podId, sshInfo, imageName, Date.now() - startMs, runtime, undefined, provisioningContext)
      } else {
        await this._terminatePod(podId)
      }
    }
  }

  /**
   * Create the warm `Materia` for a ready pod (status idle, warm window, boot-cost), pair a
   * `Hospitium` when the host is known, and emit `pod.parked`. Shared by the gen path (where
   * `bootMs` is the actual cold-start wall-clock) and the provision-only `/arm` Start path (where
   * it's the provision+bootstrap elapsed — an estimate, reconciled later). `runtime` records which
   * on-pod runtime the studio serves. Returns the Materia (or undefined on create failure).
   */
  private async _parkWarm(
    podId: string,
    sshInfo: SshInfo,
    imageName: string,
    bootMs: number,
    runtime?: string,
    warmMs?: number,
    provisioningContext?: ProvisioningContext,
  ): Promise<Materia | undefined> {
    if (!this.materiae) return undefined
    const bootCostImpetus = computeBootCostImpetus(bootMs, sshInfo.costPerHr ?? 0)
    // `costPerHr` (the pod's real hourly cost) is the source of truth for warm-time
    // billing — Census charges it per-window. `impetusPerSecond` stays a coarse
    // display/legacy-fallback figure (config override still wins, else the coarse
    // conversion, else 0 when the rate is unknown).
    const impetusPerSecond = this.config.impetusPerSecond
      ?? (sshInfo.costPerHr ? impetusPerSecondFromHourly(sshInfo.costPerHr) : 0n)
    const materia = await this.materiae.create({
      genus: 'runpod',
      externusId: podId,
      gpu: sshInfo.gpuType ?? (this.config.gpuTypeIds ?? DEFAULT_GPU_TYPE_IDS)[0] ?? '',
      vramGb: 0,
      ramGb: 0,
      imageRef: imageName,
      sshHost: sshInfo.host,
      sshPort: sshInfo.port,
      impetusPerSecond,
      ...(typeof sshInfo.costPerHr === 'number' ? { costPerHr: sshInfo.costPerHr } : {}),
      status: 'idle',
      warmUntil: new Date(Date.now() + (warmMs ?? this.config.warmTtlMs ?? 60_000)),
      bootCostImpetus,
      ...(runtime ? { runtime } : {}),
      ...(provisioningContext?.groupChatId ? { groupChatId: provisioningContext.groupChatId } : {}),
    }).catch(() => undefined)
    // Pair the Materia with a Hospitium when we know the host — identified (animaId) or
    // anonymous-arcanum (commitment). Either way, identity sits off-pod (see types/hospitium.ts).
    if (materia && this.hospitia && provisioningContext?.hostKey) {
      await this.hospitia.create({
        materiaId: materia.id,
        hostKey: provisioningContext.hostKey,
        inceptum: new Date(),
      }).catch(() => undefined)
    }
    // Late-binding hosting metadata (e.g. group admin resolution) hangs off pod.parked so the
    // crystal core stays platform-neutral; carry the source platform for adapter scoping.
    if (materia) {
      const platform = getTrace()?.platform
      bus.emit('pod.parked', {
        materiaId: materia.id,
        ...(provisioningContext?.groupChatId ? { groupChatId: provisioningContext.groupChatId } : {}),
        ...(platform ? { platform } : {}),
      })
    }
    return materia
  }

  // Port appearing in RunPod API does not mean sshd is accepting connections yet.
  // Probe with `true` until the daemon is ready or we hit the deadline.
  private async _waitForSshd(info: SshInfo): Promise<SshTransportLike> {
    const deadlineMs = Date.now() + 3 * 60_000
    while (true) {
      const ssh = this.sshFactory(info)
      try {
        await ssh.exec('true', { timeout: 8_000 })
        return ssh
      } catch (err) {
        await ssh.close().catch(() => {})
        if (Date.now() >= deadlineMs) throw new Error('sshd did not become ready within 3 min')
        log.debug('sshd not ready, retrying in 5s')
        await new Promise(r => setTimeout(r, 5_000))
      }
    }
  }

  /** Returns the comfyrunner HTTP base URL for a given pod ID. */
  static runnerBase(podId: string): string {
    return `https://${podId}-8080.proxy.runpod.net`
  }

  /** Poll comfyrunner /health until it reports 'ready' or 'busy'. */
  private async _waitForRunner(runnerBase: string): Promise<void> {
    const timeoutMs = this.config.comfyReadyTimeoutMs ?? 5 * 60 * 1000
    const pollMs    = this.config.comfyPollIntervalMs ?? 2000
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
    throw new Error('comfyrunner did not become ready within timeout')
  }

  /** Bootstrap dispatches on the pod's runtime (ADR-0007). ComfyUI keeps the proven comfyrunner.py
   *  path byte-for-byte; vLLM/llm pods get the multi-runtime runner.py. */
  private async _bootstrap(ssh: SshTransportLike, podId: string, runtime?: string, comfyRef?: string): Promise<void> {
    if (runtime === 'vLLM' || runtime === 'llm') {
      return this._bootstrapRunner(ssh, podId, 'vLLM', 'vllm huggingface_hub boto3')
    }
    if (runtime === 'sglang' || runtime === 'transformers') {
      // SGLang serves custom-arch models (MOSS) vLLM can't. sglang[all] pulls a CUDA-13 torch whose
      // bundled libs (nvidia/cu13/lib) aren't on the linker path, and sgl_kernel needs libnuma.so.1
      // — without both, sglang crashes at startup on the CUDA-12.4 base. Fix: apt install libnuma1
      // here; the runner prepends nvidia/cu13/lib to LD_LIBRARY_PATH at launch (SGLangExecutor.
      // _serve_env). Verified-live-local 2026-06-12.
      return this._bootstrapRunner(ssh, podId, 'sglang', '"sglang[all]" huggingface_hub boto3',
        ['apt-get update -qq && apt-get install -y -qq libnuma1'])
    }
    if (runtime === 'python-modelcard') {
      // The modelcard repo brings its own deps (the runner `pip install -e .`s it at load); the pod
      // just needs the download + R2 tooling. git is ensured inside _bootstrapRunner.
      return this._bootstrapRunner(ssh, podId, 'python-modelcard', 'huggingface_hub boto3')
    }
    return this._bootstrapComfyUI(ssh, podId, comfyRef)
  }

  private async _bootstrapComfyUI(ssh: SshTransportLike, podId: string, comfyRef?: string): Promise<void> {
    const ref = comfyRef ?? DEFAULT_COMFYUI_REF
    log.info('bootstrapping pod', { podId, runtime: 'ComfyUI', comfyRef: ref })

    // Install deps, clone a PINNED ComfyUI ref — never HEAD (2026-07-10 P0: unpinned HEAD drifted
    // torch-incompatible and broke every ComfyUI pod). `--branch` works for both tags and branches.
    await ssh.exec('which git || (apt-get update -qq && apt-get install -y -qq git)', { timeout: 120_000 })
    await ssh.exec(`cd /root && rm -rf ComfyUI && git clone --depth 1 --branch ${shellQuote(ref)} https://github.com/comfyanonymous/ComfyUI.git`, { timeout: 120_000 })
    await ssh.exec('cd /root/ComfyUI && pip install -r requirements.txt websocket-client boto3 -q', { timeout: 600_000 })

    // Upload comfyrunner.py and start it — comfyrunner owns ComfyUI startup internally
    const script = fs.readFileSync(COMFYRUNNER_SCRIPT_PATH, 'utf8')
    const b64 = Buffer.from(script).toString('base64').replace(/\n/g, '')
    await ssh.exec(`echo '${b64}' | base64 -d > /root/comfyrunner.py`, { timeout: 10_000 })
    await ssh.exec(
      `RUNPOD_POD_ID=${podId} COMFYUI_DIR=/root/ComfyUI nohup python3 /root/comfyrunner.py >> /tmp/comfyrunner.log 2>&1 &`,
      { timeout: 5_000 },
    )
    log.info('comfyrunner started', { podId })
  }

  /**
   * Serving-runtime bootstrap (ADR-0007): pip-install the given serving stack + upload runner.py —
   * the multi-harness manager. The runner holds an `Executor` per runtime and lazily loads each
   * (download repo → launch server → wait) on first job, bounded by a VRAM budget. We install only
   * the one stack this pod needs (`pipPkgs`), so in practice the pod runs that one harness; a job
   * for another runtime would fail to load (its lib absent). True co-residency (multiple stacks on
   * one pod) is a later provisioning mode.
   *
   * NOTE: serving flags/versions are tuned live on a real pod (vLLM is verified; SGLang/MOSS is
   * wired but the exact sglang version + audio request format need a live pass).
   */
  private async _bootstrapRunner(ssh: SshTransportLike, podId: string, runtime: string, pipPkgs: string, postInstall: string[] = []): Promise<void> {
    log.info('bootstrapping pod', { podId, runtime })

    await ssh.exec('which git || (apt-get update -qq && apt-get install -y -qq git)', { timeout: 120_000 })
    await ssh.exec(`pip install ${pipPkgs} -q`, { timeout: 1_200_000 })
    for (const cmd of postInstall) {
      await ssh.exec(cmd, { timeout: 120_000 })
    }

    const script = fs.readFileSync(RUNNER_SCRIPT_PATH, 'utf8')
    const b64 = Buffer.from(script).toString('base64').replace(/\n/g, '')
    await ssh.exec(`echo '${b64}' | base64 -d > /root/runner.py`, { timeout: 10_000 })
    await ssh.exec(
      `RUNPOD_POD_ID=${podId} MODEL_ROOT=/root/models nohup python3 /root/runner.py >> /tmp/runner.log 2>&1 &`,
      { timeout: 5_000 },
    )
    log.info('runner started', { podId, runtime })
  }
}

// ---------------------------------------------------------------------------
// Default SSH factory — uses the system ssh binary via the crystal SshTransport.
// ---------------------------------------------------------------------------

export function makeSecurePodSshFactory(sshKeyPath: string): (info: SshInfo) => SshTransportLike {
  const sshLog = makeLogger('ssh:transport')
  return (info: SshInfo) =>
    new SshTransport({ host: info.host, port: info.port, username: info.user, privateKeyPath: sshKeyPath, logger: sshLog })
}
