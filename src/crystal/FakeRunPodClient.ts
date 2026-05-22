import type { RunPodClient } from './RunPodCursor.js'
import type { ActumExecutio } from '../types/actum.js'
import type { MateriaStore } from '../types/materia.js'
import { bus } from '../lib/bus.js'
import { getTrace } from '../lib/trace.js'
import { makeLogger } from '../lib/logger.js'

const log = makeLogger('cursor:fake')

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
 * Emits the same actum.stage events the real cursor does with *real* elapsed
 * times, fires a COMPLETED webhook with a sample image, then — mirroring
 * SecurePodClient — registers an idle Materia in the store so the NEXT /make is
 * routed to a warm pod (FakeWarmPodClient) and the idle reaper can sweep it.
 * No SSH, no comfyrunner, no $.
 */
export class FakeRunPodClient implements RunPodClient {
  constructor(
    private readonly fetchFn: typeof fetch = globalThis.fetch,
    private readonly opts: FakeOpts = {},
    private readonly materiae?: MateriaStore,
  ) {}

  async submit(params: { input: unknown; webhook?: string; onPodActive?: (podId: string) => Promise<void>; onMetrics?: (e: ActumExecutio) => Promise<void> }): Promise<{ id: string }> {
    const podId = `fake-${Date.now().toString(36)}`
    void this._run(podId, params).catch(err => log.error('fake run failed', { error: String(err) }))
    return { id: podId }
  }

  private async _run(podId: string, params: Parameters<FakeRunPodClient['submit']>[0]): Promise<void> {
    const step = this.opts.stepMs ?? 800
    const gpuType = this.opts.gpuType ?? 'NVIDIA GeForce RTX 4090'
    const region = this.opts.region ?? 'EU-RO-1'
    const costPerHr = this.opts.costPerHr ?? 0.69
    const warmTtlMs = this.opts.warmTtlMs ?? 60_000
    const imageUrl = this.opts.imageUrl ?? process.env.DEV_FAKE_IMAGE ?? 'https://picsum.photos/seed/noema/512'

    const actumId = getTrace()?.actumId
    const start = Date.now()
    const emit = (stage: string, info?: Record<string, unknown>) => {
      if (actumId) bus.emit('actum.stage', { actumId, stage, elapsedMs: Date.now() - start, info })
    }
    const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

    log.info('fake cold pod run starting', { podId })
    emit('provisioning'); await sleep(step)
    emit('pod-locked', { podId, gpuType, region, costPerHr }); await sleep(step)
    emit('ssh-ready'); await sleep(step / 2)
    emit('bootstrapping'); await sleep(step)
    for (let i = 1; i <= 4; i++) { emit(`downloading:${i}/4`, { etaMs: (4 - i) * step }); await sleep(step) }
    emit('comfy-ready'); await sleep(step / 2)
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
      await this.materiae.create({
        genus: 'runpod',
        externusId: podId,
        gpu: gpuType,
        vramGb: 24,
        ramGb: 32,
        imageRef: ociRef,
        impetusPerSecond: 0n,
        status: 'idle',
        warmUntil: new Date(Date.now() + warmTtlMs),
      }).catch(err => log.warn('fake materia create failed', { error: String(err) }))
      log.info('fake pod parked warm', { podId, imageRef: ociRef, warmTtlMs })
    }
  }
}
