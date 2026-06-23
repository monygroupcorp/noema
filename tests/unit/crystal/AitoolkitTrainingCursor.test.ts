// Build #5 (live shell) — AitoolkitTrainingCursor orchestration: seed → spawn → poll-to-
// terminal (recording the timeline onto the Actum) → exitus/throw. Driven with a fake store
// (scripted Job rows) + fake spawner — no Docker, no DB, no GPU.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { AitoolkitTrainingCursor } from '../../../src/crystal/AitoolkitTrainingCursor.js'
import type { AitkJobStore } from '../../../src/crystal/AitkJobStore.js'
import type { AitkSpawner, AitkRunSpec } from '../../../src/crystal/AitkSpawner.js'
import type { AitkJob } from '../../../src/execution/aitkProgressus.js'
import { registerProgressusRecorder } from '../../../src/execution/progressusSink.js'
import { withTrace, makeTraceContext } from '../../../src/lib/trace.js'
import type { Actum } from '../../../src/types/actum.js'
import type { Modus } from '../../../src/types/modus.js'
import type { Progressus } from '../../../src/types/progressus.js'

type Row = { status: string; step: number; info?: string }

class FakeStore implements AitkJobStore {
  seeded: Array<{ jobId: string; opts?: { gpuIds?: string; jobConfig?: string } }> = []
  private i = 0
  constructor(private readonly rows: Row[]) {}
  async seed(jobId: string, opts?: { gpuIds?: string; jobConfig?: string }): Promise<void> {
    this.seeded.push({ jobId, opts })
  }
  async read(_jobId: string): Promise<AitkJob | undefined> {
    const r = this.i < this.rows.length ? this.rows[this.i] : this.rows[this.rows.length - 1]
    if (this.i < this.rows.length - 1) this.i++
    return { ...r }
  }
}

class FakeSpawner implements AitkSpawner {
  started: AitkRunSpec[] = []
  async start(spec: AitkRunSpec): Promise<void> { this.started.push(spec) }
}

const actum = (aditus: Record<string, unknown>): Actum =>
  ({ id: 'act-train', aditus } as unknown as Actum)

async function withRecorder(actumId: string, body: (seen: Progressus[]) => Promise<void>): Promise<void> {
  const seen: Progressus[] = []
  registerProgressusRecorder(async (_id, p) => { seen.push(p) })
  try { await withTrace(makeTraceContext({ actumId }), () => body(seen)) }
  finally { registerProgressusRecorder(async () => {}) }
}

const COMPLETED: Row[] = [
  { status: 'queued',    step: 0,  info: 'seeded by crystal' },
  { status: 'running',   step: 0,  info: 'Loading model' },
  { status: 'running',   step: 0,  info: 'Loading dataset' },
  { status: 'running',   step: 30, info: 'Training' },
  { status: 'running',   step: 60, info: 'Training' },
  { status: 'completed', step: 60, info: 'Training completed' },
]

test('run: seeds the Job row, launches the container, records the timeline, returns exitus', async () => {
  const store = new FakeStore(COMPLETED)
  const spawner = new FakeSpawner()
  const cursor = new AitoolkitTrainingCursor({ store, spawner, image: 'stationthis-klein:1', pollIntervalMs: 1 })

  await withRecorder('act-train', async (seen) => {
    const result = await cursor.run(actum({ jobId: 'stationthis_klein4b', steps: 60, configPath: 'config/x.yaml', gpuId: '0' }))

    assert.equal(result.kind, 'sync')
    if (result.kind !== 'sync') return
    assert.deepEqual(result.exitus.exitus, { trained: true, steps: 60 })
    assert.equal(result.exitus.impetus, 0n)
    assert.equal(typeof result.exitus.duratio, 'number')

    // seeded once with the job id; container launched with the image + config.
    assert.deepEqual(store.seeded.map(s => s.jobId), ['stationthis_klein4b'])
    assert.equal(store.seeded[0].opts?.gpuIds, '0')
    assert.equal(spawner.started.length, 1)
    assert.equal(spawner.started[0].image, 'stationthis-klein:1')
    assert.equal(spawner.started[0].configPath, 'config/x.yaml')
    assert.equal(spawner.started[0].jobId, 'stationthis_klein4b')

    // the §6c timeline landed on the Actum, in order, ending on done.
    assert.deepEqual(seen.map(p => p.phase), ['queued', 'loading', 'downloading', 'executing', 'executing', 'done'])
    assert.deepEqual(seen.find(p => p.phase === 'executing')?.progress, { done: 30, total: 60, unit: 'steps' })
  })
})

test('run: jobId defaults to the Actum id when not in aditus', async () => {
  const store = new FakeStore(COMPLETED)
  const cursor = new AitoolkitTrainingCursor({ store, spawner: new FakeSpawner(), image: 'img:1', pollIntervalMs: 1 })
  await withRecorder('act-train', async () => {
    await cursor.run(actum({ steps: 60, configPath: 'c.yaml' }))
    assert.equal(store.seeded[0].jobId, 'act-train')
  })
})

test('run: an error outcome throws so the Actum goes fractus (and still records failed)', async () => {
  const store = new FakeStore([
    { status: 'running', step: 5, info: 'Training' },
    { status: 'error',   step: 5, info: 'CUDA out of memory' },
  ])
  const cursor = new AitoolkitTrainingCursor({ store, spawner: new FakeSpawner(), image: 'img:1', pollIntervalMs: 1 })
  await withRecorder('act-train', async (seen) => {
    await assert.rejects(() => cursor.run(actum({ steps: 100, configPath: 'c.yaml' })), /training error at step 5: CUDA out of memory/)
    assert.equal(seen.at(-1)?.phase, 'failed')
  })
})

test('run: a missing configPath is rejected before anything is seeded or spawned', async () => {
  const store = new FakeStore(COMPLETED)
  const spawner = new FakeSpawner()
  const cursor = new AitoolkitTrainingCursor({ store, spawner, image: 'img:1', pollIntervalMs: 1 })
  await assert.rejects(() => cursor.run(actum({ steps: 60 })), /configPath` is required/)
  assert.equal(store.seeded.length, 0)
  assert.equal(spawner.started.length, 0)
})

test('reserve: self-hosted on our GPU → modus.impetusFixum ?? 0n', async () => {
  const cursor = new AitoolkitTrainingCursor({ store: new FakeStore(COMPLETED), spawner: new FakeSpawner(), image: 'img:1' })
  assert.equal(await cursor.reserve({} as Modus, {}), 0n)
  assert.equal(await cursor.reserve({ impetusFixum: 7n } as Modus, {}), 7n)
})
