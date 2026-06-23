import type { RunPodClient } from './RunPodCursor.js'
import type { Materia, MateriaStore } from '../types/materia.js'
import type { ActumExecutio, ModelRef } from '../types/actum.js'
import type { InstallResult } from './comfyrunnerClient.js'
import type { ModelInstallClient, InstallProgress } from './ModelInstaller.js'
import type { FakeOpts } from './FakeRunPodClient.js'
import { bus } from '../lib/bus.js'
import { getTrace } from '../lib/trace.js'
import { makeLogger } from '../lib/logger.js'
import { recordProgressus } from '../execution/progressusSink.js'
import { fakeStageToProgressus } from './FakeRunPodClient.js'

const log = makeLogger('cursor:fake:warm')

/**
 * FakeWarmPodClient — the warm counterpart to FakeRunPodClient. Simulates reusing
 * an already-running pod (the idle Materia parked by a previous fake cold run):
 * no provisioning, no model download — just a quick inference. Mirrors
 * WarmPodClient's contract: emits `warm-pod-found` (drives the 🔥 reaction),
 * returns a per-submission jobId (the webhook is keyed by jobId, not the pod id),
 * fires a COMPLETED webhook, and re-arms the Materia's idle warm window so the
 * idle reaper sweeps it after the chosen TTL. No SSH, no comfyrunner, no $.
 */
export class FakeWarmPodClient implements RunPodClient, ModelInstallClient {
  constructor(
    private readonly materia: Materia,
    private readonly materiae: MateriaStore,
    private readonly fetchFn: typeof fetch = globalThis.fetch,
    private readonly opts: FakeOpts = {},
  ) {}

  async submit(params: { input: unknown; webhook?: string; onPodActive?: (podId: string) => Promise<void>; onMetrics?: (e: ActumExecutio) => Promise<void> }): Promise<{ id: string }> {
    const { externusId } = this.materia
    const jobId = `${externusId}-${Date.now()}`

    // Signal "warm" so the Telegram layer reacts 🔥 (vs 👌 for a cold start).
    const actumId = getTrace()?.actumId
    if (actumId) {
      bus.emit('actum.stage', { actumId, stage: 'warm-pod-found', elapsedMs: 0, info: { podId: externusId } })
      const prog = fakeStageToProgressus('warm-pod-found', { podId: externusId })   // #6b: 🔥-only, skipped by the journal
      if (prog) recordProgressus(actumId, { ...prog, at: new Date() }).catch(err => log.warn('progressus record failed', { error: (err as Error).message }))
    }

    void this._run(jobId, actumId, params).catch(err => log.error('fake warm run failed', { error: String(err) }))
    return { id: jobId }
  }

  /** Simulate a download-only install onto the warm pod — steps through the models emitting
   *  progress (drives the bulletin's "installing…" tail), no real download, no $. */
  async installModels(models: ModelRef[], onProgress?: (p: InstallProgress) => void): Promise<InstallResult> {
    const step = this.opts.stepMs ?? (Number(process.env.DEV_FAKE_STEP_MS) || 800)
    const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))
    let done = 0
    for (const m of models) {
      await sleep(step / 2)
      done += 1
      onProgress?.({ done, total: models.length, current: m.id })
    }
    log.info('fake install complete', { podId: this.materia.externusId, count: done })
    return { modelsDownloaded: done, modelsReused: 0, downloadMs: done * Math.round(step / 2), downloadBytes: models.reduce((n, m) => n + (m.sizeBytes ?? 0), 0) }
  }

  private async _run(jobId: string, actumId: string | undefined, params: Parameters<FakeWarmPodClient['submit']>[0]): Promise<void> {
    const step = this.opts.stepMs ?? (Number(process.env.DEV_FAKE_STEP_MS) || 800)
    const warmTtlMs = this.opts.warmTtlMs ?? 60_000
    const gpuType = this.materia.gpu || this.opts.gpuType || 'NVIDIA GeForce RTX 4090'
    const region = this.opts.region ?? 'EU-RO-1'
    const costPerHr = this.opts.costPerHr ?? 0.69
    const imageUrl = this.opts.imageUrl ?? process.env.DEV_FAKE_IMAGE ?? 'https://picsum.photos/seed/noema-warm/512'
    const podId = this.materia.externusId

    const start = Date.now()
    const emit = (stage: string, info?: Record<string, unknown>) => {
      if (actumId) bus.emit('actum.stage', { actumId, stage, elapsedMs: Date.now() - start, info })
      if (actumId) {
        const prog = fakeStageToProgressus(stage, info)   // #6b: drive the bulletin off the owned timeline
        if (prog) recordProgressus(actumId, { ...prog, at: new Date() }).catch(err => log.warn('progressus record failed', { error: (err as Error).message }))
      }
    }
    const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

    log.info('fake warm pod run starting', { podId, materiaId: this.materia.id })
    try {
      emit('pod-locked', { podId, gpuType, region, costPerHr }); await sleep(step / 2)
      emit('inferring'); await sleep(step)

      const executionMs = step
      void params.onMetrics?.({
        executionMs, downloadMs: 0, modelsDownloaded: 0, modelsReused: 4,
        gpuType, podId, coldStart: false, costPerHr,
        // A warm reuse bills only its short inference window (~25s).
        billedMs: 25_000,
      })

      if (params.webhook) {
        await this.fetchFn(params.webhook, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: jobId, status: 'COMPLETED', output: [{ url: imageUrl }], executionTime: executionMs }),
        }).then(() => log.info('fake warm delivered', { podId, imageUrl }))
          .catch(err => log.warn('fake warm webhook failed', { error: String(err) }))
      }
    } finally {
      // Re-arm the idle deadline so the reaper gives this pod a fresh warm window.
      await this.materiae.update(this.materia.id, {
        status: 'idle',
        warmUntil: new Date(Date.now() + warmTtlMs),
      }).catch(() => {})
    }
  }
}
