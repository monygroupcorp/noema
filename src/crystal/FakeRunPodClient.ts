import type { RunPodClient } from './RunPodCursor.js'
import type { ActumExecutio } from '../types/actum.js'
import { bus } from '../lib/bus.js'
import { getTrace } from '../lib/trace.js'
import { makeLogger } from '../lib/logger.js'

const log = makeLogger('cursor:fake')

/**
 * FakeRunPodClient — simulates the full RunPod pod lifecycle locally, instantly,
 * and for $0. Drop-in for SecurePodClient in dev (DEV_FAKE_POD=1) so the whole
 * Telegram UX — reactions, the session bulletin, the delivery menu, warm/kill —
 * can be exercised without provisioning (or paying for) a real GPU pod.
 *
 * Emits the same actum.stage events the real cursor does, then fires a COMPLETED
 * webhook to the local handler with a sample image. No SSH, no comfyrunner, no $.
 */
export class FakeRunPodClient implements RunPodClient {
  constructor(
    private readonly fetchFn: typeof fetch = globalThis.fetch,
    private readonly opts: { stepMs?: number; gpuType?: string; region?: string; costPerHr?: number; imageUrl?: string } = {},
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
    const imageUrl = this.opts.imageUrl ?? process.env.DEV_FAKE_IMAGE ?? 'https://picsum.photos/seed/noema/512'

    const actumId = getTrace()?.actumId
    const emit = (stage: string, info?: Record<string, unknown>) => {
      if (actumId) bus.emit('actum.stage', { actumId, stage, elapsedMs: 0, info })
    }
    const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

    log.info('fake pod run starting', { podId })
    emit('provisioning'); await sleep(step)
    emit('pod-locked', { podId, gpuType, region, costPerHr }); await sleep(step)
    emit('ssh-ready'); await sleep(step / 2)
    emit('bootstrapping'); await sleep(step)
    for (let i = 1; i <= 4; i++) { emit(`downloading:${i}/4`, { etaMs: (4 - i) * step }); await sleep(step) }
    emit('comfy-ready'); await sleep(step / 2)
    emit('inferring'); await sleep(step)

    // Report telemetry like the real client so the bulletin/Info show real-looking stats.
    void params.onMetrics?.({
      provisionMs: step, sshReadyMs: step * 1.5, downloadMs: step * 4, executionMs: 8_000,
      modelsDownloaded: 4, modelsReused: 0, gpuType, podId, coldStart: true, costPerHr,
    })

    // Fire the COMPLETED webhook at the local handler (mirrors comfyrunner).
    if (params.webhook) {
      await this.fetchFn(params.webhook, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: podId, status: 'COMPLETED', output: [{ url: imageUrl }], executionTime: 8_000 }),
      }).then(() => log.info('fake delivered', { podId, imageUrl }))
        .catch(err => log.warn('fake webhook failed', { error: String(err) }))
    }
  }
}
