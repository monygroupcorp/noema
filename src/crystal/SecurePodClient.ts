import fs from 'node:fs'
import path from 'node:path'
import type { RunPodClient, ProvisioningContext } from './RunPodCursor.js'
import type { Procurator, StudioStageCb, StudioProvision } from './Procurator.js'
import type { Materia, MateriaStore } from '../types/materia.js'
import type { HospitiumStore } from '../types/hospitium.js'
import type { ActumExecutio } from '../types/actum.js'
import { makeLogger } from '../lib/logger.js'
import { getTrace } from '../lib/trace.js'
import { bus } from '../lib/bus.js'
import { terminatePod as _terminatePodUtil } from './terminatePod.js'
import { submitToRunner, awaitViaStream, isCompiledSpec, type R2Config } from './comfyrunnerClient.js'
import { computeBootCostImpetus, impetusPerSecondFromHourly } from '../ledger/rates.js'

const COMFYRUNNER_SCRIPT_PATH = path.resolve(__dirname, '../../scripts/pod/comfyrunner.py')

const log = makeLogger('cursor:runpod:secure')

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type { R2Config } from './comfyrunnerClient.js'

// Ordered by preference: 24GB VRAM SECURE-tier GPUs first, then fallbacks
// All GPUs with ≥24 GB VRAM — needed for the full BF16 FLUX model.
// Ordered roughly by expected speed (fastest/most available first).
const DEFAULT_GPU_TYPE_IDS = [
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
  'NVIDIA A30',
  'NVIDIA H100 PCIe',
  'NVIDIA H100 NVL',
  'NVIDIA H100 80GB HBM3',
  'NVIDIA RTX A4500',
  'NVIDIA RTX 4000 Ada Generation',
]

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
  ) {}

  async submit(params: {
    input: unknown
    webhook?: string
    provisioningContext?: ProvisioningContext
    onPodActive?: (podId: string) => Promise<void>
    onMetrics?: (executio: ActumExecutio) => Promise<void>
  }): Promise<{ id: string }> {
    // Derive image from spec if available, else fall back to config
    const specOciRef = isCompiledSpec(params.input)
      ? ((params.input as unknown as { image?: { ociRef?: string } }).image?.ociRef)
      : undefined
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
        await this._runBackground(podId!, imageName, params.input, params.webhook, undefined, (accepted) => { runnerAcceptedJob = accepted }, params.onMetrics, params.provisioningContext)
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
        log.warn(`pod run attempt 1/${maxAttempts} failed`, { podId, error: (firstErr as Error).message })
        for (let attempt = 2; attempt <= maxAttempts; attempt++) {
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
          // Update DB so the retry pod is tracked; webhook will fire with retryPodId
          await params.onPodActive?.(retryPodId).catch(() => {})
          try {
            await this._runBackground(retryPodId, imageName, params.input, params.webhook, retryPodId, (accepted) => { runnerAcceptedJob = accepted }, params.onMetrics, params.provisioningContext)
            return
          } catch (runErr) {
            if (runnerAcceptedJob && !(runErr as { isThrottleError?: boolean }).isThrottleError) {
              log.warn('lost SSE after comfyrunner accepted job — not retrying; comfyrunner owns the webhook', { podId: retryPodId, error: (runErr as Error).message })
              return
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
        await this._postWebhook(params.webhook, { id: podId, status: 'FAILED', error: (err as Error).message })
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
    opts: { runtime?: string; warmMs?: number; provisioningContext?: ProvisioningContext } = {},
    onStage?: StudioStageCb,
  ): Promise<StudioProvision | null> {
    const imageName = this.config.imageName ?? 'runpod/pytorch:2.4.0-py3.11-cuda12.4.1-devel-ubuntu22.04'
    let prov: { podId: string; sshInfo: SshInfo; provisionMs: number }
    try {
      prov = await this._provisionAndBootstrap(imageName, onStage)
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
  ): Promise<{ podId: string; sshInfo: SshInfo; provisionMs: number }> {
    const startMs = Date.now()
    const emitStage = (stage: string, info?: import('../lib/bus.js').StageInfo) => {
      const ctx = getTrace()
      if (ctx?.actumId) bus.emit('actum.stage', { actumId: ctx.actumId, stage, elapsedMs: Date.now() - (ctx.startTs ?? startMs), info })
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
      emitStage('provisioning')
      const sshInfo = await this._waitForSsh(podId)
      emitStage('pod-locked', { gpuType: sshInfo.gpuType, region: sshInfo.region, costPerHr: sshInfo.costPerHr, podId })
      ssh = await this._waitForSshd(sshInfo)
      emitStage('bootstrapping')
      await this._bootstrap(ssh, podId)
      await ssh.close()
      ssh = null
      await this._waitForRunner(SecurePodClient.runnerBase(podId))
      emitStage('comfy-ready')
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
  ): Promise<void> {
    const startMs = Date.now()
    let ssh: SshTransportLike | null = null
    let sshInfo: SshInfo | null = null
    const emitStage = (stage: string, info?: import('../lib/bus.js').StageInfo) => {
      const ctx = getTrace()
      if (ctx?.actumId) bus.emit('actum.stage', { actumId: ctx.actumId, stage, elapsedMs: Date.now() - (ctx.startTs ?? startMs), info })
    }
    // Pod telemetry accumulated as the job runs and persisted onto the actum
    // (via onMetrics) before completion — the completion webhook can't see this
    // in-flight state otherwise. Each report sends the full accumulated object.
    const executio: ActumExecutio = { podId, coldStart: true }
    const reportMetrics = () => { void onMetrics?.({ ...executio }) }
    let jobSucceeded = false

    try {
      emitStage('provisioning')
      sshInfo = await this._waitForSsh(podId)
      executio.provisionMs = Date.now() - startMs
      executio.costPerHr = sshInfo.costPerHr
      executio.gpuType = sshInfo.gpuType
      // Pod acquired — surface GPU/region/price to the user the moment we lock on.
      log.info('pod locked', { podId, gpuType: sshInfo.gpuType, region: sshInfo.region, costPerHr: sshInfo.costPerHr })
      emitStage('pod-locked', { gpuType: sshInfo.gpuType, region: sshInfo.region, costPerHr: sshInfo.costPerHr, podId })
      ssh = await this._waitForSshd(sshInfo)
      executio.sshReadyMs = Date.now() - startMs
      reportMetrics()  // persist provision/ssh/podId/costPerHr — survives even if download fails
      emitStage('bootstrapping')
      await this._bootstrap(ssh, podId)

      // SSH only needed for bootstrap — close before HTTP phase
      await ssh.close()
      ssh = null

      const runnerBase = SecurePodClient.runnerBase(podId)
      await this._waitForRunner(runnerBase)
      emitStage('comfy-ready')

      const jobId = externusJobId ?? podId
      await submitToRunner(this.fetchFn, runnerBase, jobId, input, webhook, this.config.r2)
      onRunnerAccepted?.(true)  // comfyrunner now owns the failure webhook

      const submitCtx = getTrace()
      if (submitCtx) submitCtx.jobSubmitMs = Date.now() - submitCtx.startTs

      // comfyrunner fires the webhook; we subscribe to SSE only to know when done
      // (so we can terminate/warm the pod and emit stage events to the bus)
      await awaitViaStream(
        this.fetchFn, runnerBase, jobId, this.config.jobTimeoutMs ?? 45 * 60 * 1000, emitStage,
        (m) => { Object.assign(executio, m); reportMetrics() },
      )
      jobSucceeded = true
    } finally {
      await ssh?.close().catch(() => {})
      if (jobSucceeded && this.config.keepWarm && this.materiae && sshInfo) {
        // Boot wall-clock — the cost we now ask future guests to amortize.
        const runtime = isCompiledSpec(input) ? (input as unknown as { runtime?: string }).runtime : undefined
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

  private async _bootstrap(ssh: SshTransportLike, podId: string): Promise<void> {
    log.info('bootstrapping pod', { podId })

    // Install deps, clone ComfyUI, install Python packages (comfyrunner deps included)
    await ssh.exec('which git || (apt-get update -qq && apt-get install -y -qq git)', { timeout: 120_000 })
    await ssh.exec('cd /root && rm -rf ComfyUI && git clone --depth 1 https://github.com/comfyanonymous/ComfyUI.git', { timeout: 120_000 })
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
}

// ---------------------------------------------------------------------------
// Default SSH factory — uses the system ssh binary via SshTransport.js
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SshTransportCtor = new (opts: { host: string; port: number; username: string; privateKeyPath: string; logger?: unknown }) => SshTransportLike
let _SshTransport: SshTransportCtor | null = null

function loadSshTransport(): SshTransportCtor {
  if (!_SshTransport) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    _SshTransport = require('../core/services/remote/SshTransport.js') as SshTransportCtor
  }
  return _SshTransport
}

export function makeSecurePodSshFactory(sshKeyPath: string): (info: SshInfo) => SshTransportLike {
  const sshLog = makeLogger('ssh:transport')
  return (info: SshInfo) => {
    const Ctor = loadSshTransport()
    return new Ctor({ host: info.host, port: info.port, username: info.user, privateKeyPath: sshKeyPath, logger: sshLog })
  }
}
