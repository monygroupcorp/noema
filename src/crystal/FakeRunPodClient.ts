import type { RunPodClient, ProvisioningContext } from './RunPodCursor.js'
import type { Procurator, StudioStageCb, StudioProvision } from './Procurator.js'
import type { ActumExecutio } from '../types/actum.js'
import type { MateriaStore } from '../types/materia.js'
import type { HospitiumStore } from '../types/hospitium.js'
import { bus } from '../lib/bus.js'
import { getTrace } from '../lib/trace.js'
import { makeLogger } from '../lib/logger.js'
import { computeBootCostImpetus } from '../ledger/rates.js'
import { recordProgressus } from '../execution/progressusSink.js'
import { coldStartProgressus } from '../execution/progressus.js'
import type { Progressus } from '../types/progressus.js'

const log = makeLogger('cursor:fake')

/**
 * Project a fake stage string → Progressus (#6b). The real path is partitioned — SecurePodClient
 * records only the cold-start phases (`coldStartProgressus`) and comfyrunner records its own — but
 * the fake replaces BOTH (no comfyrunner runs), so it must cover the full vocabulary itself.
 * `ssh-ready` maps to bootstrapping; `pod-bailed` returns undefined (no terminal/quit phase in the
 * owned taxonomy — the fake re-emits `provisioning` right after, which re-drives the hunt).
 */
export function fakeStageToProgressus(stage: string, info?: Record<string, unknown>): Omit<Progressus, 'at'> | undefined {
  const cold = coldStartProgressus(stage, info)
  if (cold) return cold
  if (stage === 'ssh-ready') return { phase: 'pulling', target: 'fundamentum', message: 'bootstrapping runtime' }
  if (stage === 'inferring') return { phase: 'executing' }
  if (stage.startsWith('downloading')) {
    const [done, total] = stage.startsWith('downloading:') ? stage.slice(12).split('/').map(Number) : [undefined, undefined]
    return { phase: 'downloading', target: 'model', ...(done !== undefined && total !== undefined ? { progress: { done, total, unit: 'items' as const } } : {}) }
  }
  return undefined
}

/** Emit a fake stage onto the owned `actum.progressus` timeline (no-op if the stage has no phase). */
function recordFakeStage(actumId: string | undefined, stage: string, info?: Record<string, unknown>): void {
  if (!actumId) return
  const prog = fakeStageToProgressus(stage, info)
  if (prog) recordProgressus(actumId, { ...prog, at: new Date() }).catch(err => log.warn('progressus record failed', { error: (err as Error).message }))
}

export interface FakeOpts {
  /** Base delay between simulated stages (ms). Default 800. */
  stepMs?: number
  gpuType?: string
  region?: string
  costPerHr?: number
  imageUrl?: string
  /** How long the simulated pod stays warm/idle before the reaper kills it (ms). Default 60_000. */
  warmTtlMs?: number
}

/**
 * FakeRunPodClient — simulates a *cold* RunPod pod lifecycle locally, instantly,
 * and for $0. Drop-in for SecurePodClient in dev (DEV_FAKE_POD=1) so the whole
 * Telegram UX — reactions, the session bulletin, warm reuse, the idle reaper —
 * can be exercised without provisioning (or paying for) a real GPU pod.
 *
 * Records the same Progressus timeline the real cursor does (via the in-process recorder
 * seam), fires a COMPLETED webhook with a sample image, then — mirroring
 * SecurePodClient — registers an idle Materia in the store so the NEXT /make is
 * routed to a warm pod (FakeWarmPodClient) and the idle reaper can sweep it.
 * No SSH, no comfyrunner, no $.
 */
export class FakeRunPodClient implements RunPodClient, Procurator {
  private studioSeq = 0
  constructor(
    private readonly fetchFn: typeof fetch = globalThis.fetch,
    private readonly opts: FakeOpts = {},
    private readonly materiae?: MateriaStore,
    /** Optional Hospitium side-table — mirrors SecurePodClient so the fake produces
     *  a faithful host-guest bond record at warm-park. */
    private readonly hospitia?: HospitiumStore,
  ) {}

  /**
   * Provision-only studio (no gen) — the fake `Procurator` half, mirroring
   * `SecurePodClient.provisionStudio`: stream the provisioning stages, park a warm
   * Materia, and pair a Hospitium keyed by `hostKey`. Returns the parked pod's
   * handle so `Conductor.conducere` can find the Materia + open the Modo.
   */
  async provisionStudio(
    opts: { runtime?: string; warmMs?: number; provisioningContext?: ProvisioningContext } = {},
    onStage?: StudioStageCb,
  ): Promise<StudioProvision | null> {
    const step = this.opts.stepMs ?? (Number(process.env.DEV_FAKE_STEP_MS) || 800)
    const gpuType = this.opts.gpuType ?? 'NVIDIA GeForce RTX 4090'
    const region = this.opts.region ?? 'EU-RO-1'
    const costPerHr = this.opts.costPerHr ?? 0.69
    const warmTtlMs = opts.warmMs ?? this.opts.warmTtlMs ?? 60_000
    const runtime = opts.runtime ?? 'ComfyUI'
    const imageRef = runtime === 'llama.cpp'
      ? 'ghcr.io/ggml-org/llama.cpp:server-cuda'
      : 'runpod/pytorch:2.4.0-cuda12.4'
    const podId = `studio-fake-${Date.now().toString(36)}-${this.studioSeq++}`

    const actumId = getTrace()?.actumId
    const start = Date.now()
    const emit = (stage: string, info?: Record<string, unknown>) => {
      recordFakeStage(actumId, stage, info)   // owned timeline drives the bulletin/SSE (#6b/#6e)
      onStage?.(stage, info)
    }
    const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

    emit('provisioning'); await sleep(step)
    emit('pod-locked', { podId, gpuType, region, costPerHr, phaseMs: 30_000 }); await sleep(step)
    emit('bootstrapping'); await sleep(step)
    emit('comfy-ready', { phaseMs: 4.5 * 60_000 })

    if (this.materiae) {
      const materia = await this.materiae.create({
        genus: 'runpod', externusId: podId, gpu: gpuType, vramGb: 24, ramGb: 32,
        imageRef, runtime, impetusPerSecond: 0n, status: 'idle',
        warmUntil: new Date(Date.now() + warmTtlMs), bootCostImpetus: 0n,
        ...(opts.provisioningContext?.groupChatId ? { groupChatId: opts.provisioningContext.groupChatId } : {}),
      }).catch(err => { log.warn('fake studio provision failed', { error: String(err) }); return undefined })
      if (!materia) return null
      if (this.hospitia && opts.provisioningContext?.hostKey) {
        await this.hospitia.create({
          materiaId: materia.id,
          hostKey: opts.provisioningContext.hostKey,
          inceptum: new Date(),
        }).catch(err => log.warn('fake studio hospitium create failed', { error: String(err) }))
      }
      const platform = getTrace()?.platform
      bus.emit('pod.parked', {
        materiaId: materia.id,
        ...(opts.provisioningContext?.groupChatId ? { groupChatId: opts.provisioningContext.groupChatId } : {}),
        ...(platform ? { platform } : {}),
      })
      log.info('fake studio parked warm', { podId, imageRef, runtime, warmTtlMs })
    }
    return { podId, gpuType, costPerHr, provisionMs: Date.now() - start }
  }

  async submit(params: {
    input: unknown
    webhook?: string
    provisioningContext?: ProvisioningContext
    onPodActive?: (podId: string) => Promise<void>
    onMetrics?: (e: ActumExecutio) => Promise<void>
  }): Promise<{ id: string }> {
    const podId = `fake-${Date.now().toString(36)}`
    void this._run(podId, params).catch(err => log.error('fake run failed', { error: String(err) }))
    return { id: podId }
  }

  private async _run(podId: string, params: Parameters<FakeRunPodClient['submit']>[0]): Promise<void> {
    const step = this.opts.stepMs ?? (Number(process.env.DEV_FAKE_STEP_MS) || 800)
    const gpuType = this.opts.gpuType ?? 'NVIDIA GeForce RTX 4090'
    const region = this.opts.region ?? 'EU-RO-1'
    const costPerHr = this.opts.costPerHr ?? 0.69
    const warmTtlMs = this.opts.warmTtlMs ?? 60_000
    const imageUrl = this.opts.imageUrl ?? process.env.DEV_FAKE_IMAGE ?? 'https://picsum.photos/seed/noema/512'

    const actumId = getTrace()?.actumId
    const emit = (stage: string, info?: Record<string, unknown>) => {
      recordFakeStage(actumId, stage, info)   // owned timeline drives the bulletin/SSE (#6b/#6e)
    }
    const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

    log.info('fake cold pod run starting', { podId })
    // Synthetic phase durations so the bulletin shows believable "in 30s" / "4.5m"
    // summaries (the fake's real wall-clock is only seconds). phaseMs at pod-locked
    // is the hunt time; at comfy-ready it's the prep (init + download) time.
    emit('provisioning'); await sleep(step)
    emit('pod-locked', { podId, gpuType, region, costPerHr, phaseMs: 30_000 }); await sleep(step)
    emit('ssh-ready'); await sleep(step / 2)
    emit('bootstrapping'); await sleep(step)
    for (let i = 1; i <= 4; i++) {
      emit(`downloading:${i}/4`, { etaMs: (4 - i) * step }); await sleep(step)
      // DEV_FAKE_BAIL: demo the hero beat — a sluggish pod is cut loose mid-download
      // and a fresh one grabbed (the throttle auto-bail, given a voice).
      if (i === 2 && process.env.DEV_FAKE_BAIL) {
        emit('pod-bailed'); await sleep(step)
        emit('provisioning'); await sleep(step)
        emit('pod-locked', { podId: `${podId}b`, gpuType, region, costPerHr, phaseMs: 28_000 }); await sleep(step / 2)
      }
    }
    emit('comfy-ready', { phaseMs: 4.5 * 60_000 }); await sleep(step / 2)
    emit('inferring'); await sleep(step)

    const executionMs = step
    const downloadMs = step * 4
    void params.onMetrics?.({
      provisionMs: step, sshReadyMs: step * 1.5, downloadMs, executionMs,
      modelsDownloaded: 4, modelsReused: 0, gpuType, podId, coldStart: true, costPerHr,
      // A cold run really bills ~7 min of pod wall-time — surface that so the
      // bulletin shows a believable spend instead of a few fake wall-clock seconds.
      billedMs: 7 * 60_000,
    })

    if (params.webhook) {
      await this.fetchFn(params.webhook, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: podId, status: 'COMPLETED', output: [{ url: imageUrl }], executionTime: executionMs }),
      }).then(() => log.info('fake delivered', { podId, imageUrl }))
        .catch(err => log.warn('fake webhook failed', { error: String(err) }))
    }

    // Register an idle Materia so praefectus.findWarm routes the next job to a
    // warm (FakeWarmPodClient) pod, and the idle reaper can sweep it. ociRef ===
    // imageId:imageVersion === imageRefOf(modus), so the warm match hits.
    if (this.materiae) {
      const ociRef = (params.input as { image?: { ociRef?: string } })?.image?.ociRef
      // The compiled spec's models are exactly what this pod "downloaded" — seed the studio's
      // installedModels from them so the bulletin's Mod • loadout reflects a real model base
      // (and pinned models from Mod • → Add show as installed after a fake gen).
      const installedModels = ((params.input as { models?: Array<{ id?: string }> })?.models ?? [])
        .map(m => m.id).filter((id): id is string => !!id)
      // Synthetic billed cold-start (matches what we report via onMetrics) so the
      // bootCostImpetus stamped on the materia looks realistic in the mock.
      const bootCostImpetus = computeBootCostImpetus(7 * 60_000, costPerHr)
      const materia = await this.materiae.create({
        genus: 'runpod',
        externusId: podId,
        gpu: gpuType,
        vramGb: 24,
        ramGb: 32,
        imageRef: ociRef,
        impetusPerSecond: 0n,
        status: 'idle',
        warmUntil: new Date(Date.now() + warmTtlMs),
        bootCostImpetus,
        ...(installedModels.length ? { installedModels } : {}),
        ...(params.provisioningContext?.groupChatId ? { groupChatId: params.provisioningContext.groupChatId } : {}),
      }).catch(err => { log.warn('fake materia create failed', { error: String(err) }); return undefined })
      // Hospitium pairs the host (identified or anonymous-arcanum) to the materia
      // off-pod by design.
      if (materia && this.hospitia && params.provisioningContext?.hostKey) {
        await this.hospitia.create({
          materiaId: materia.id,
          hostKey: params.provisioningContext.hostKey,
          inceptum: new Date(),
        }).catch(err => log.warn('fake hospitium create failed', { error: String(err) }))
      }
      // Late-binding hosting metadata (group admin resolution etc.) hangs off pod.parked.
      // platform from the trace lets multi-platform processes' adapters self-scope.
      if (materia) {
        const platform = getTrace()?.platform
        bus.emit('pod.parked', {
          materiaId: materia.id,
          ...(params.provisioningContext?.groupChatId ? { groupChatId: params.provisioningContext.groupChatId } : {}),
          ...(platform ? { platform } : {}),
        })
      }
      log.info('fake pod parked warm', { podId, imageRef: ociRef, warmTtlMs, bootCostImpetus: bootCostImpetus.toString() })
    }
  }
}
