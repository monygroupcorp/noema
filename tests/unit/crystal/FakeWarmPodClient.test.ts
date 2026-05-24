import { test } from 'node:test'
import assert from 'node:assert/strict'
import { FakeRunPodClient } from '../../../src/crystal/FakeRunPodClient.js'
import { FakeWarmPodClient } from '../../../src/crystal/FakeWarmPodClient.js'
import type { Materia, MateriaStore } from '../../../src/types/materia.js'
import { bus } from '../../../src/lib/bus.js'
import { withTrace, makeTraceContext } from '../../../src/lib/trace.js'

/** Minimal in-memory MateriaStore — enough for the fake cold→warm→reap path. */
function memoryMateriae(): MateriaStore & { all(): Materia[] } {
  const map = new Map<string, Materia>()
  let n = 0
  const store: MateriaStore & { all(): Materia[] } = {
    async create(input) { const m = { ...input, id: `m${++n}` } as Materia; map.set(m.id, m); return m },
    async findById(id) { return map.get(id) ?? null },
    async update(id, patch) { const m = { ...map.get(id)!, ...patch }; map.set(id, m); return m },
    async findWarm(spec) {
      for (const m of map.values()) {
        if (m.status === 'idle' && (!spec.imageRef || m.imageRef === spec.imageRef)) {
          m.status = 'active'; return m
        }
      }
      return null
    },
    async findActive() { return [...map.values()].filter(m => m.status !== 'terminated') },
    async reapIdle(now) {
      const reaped: Materia[] = []
      for (const m of map.values()) {
        if (m.status === 'idle' && m.warmUntil && m.warmUntil <= now) { m.status = 'terminated'; reaped.push(m) }
      }
      return reaped
    },
    all() { return [...map.values()] },
  }
  return store
}

const OCI = 'runpod/pytorch:2.4.0'
const input = { image: { ociRef: OCI } }
const okFetch = (sink: unknown[]): typeof fetch =>
  (async (_u: string, init?: RequestInit) => {
    sink.push(JSON.parse((init?.body as string) ?? '{}'))
    return new Response('{}', { status: 200 })
  }) as unknown as typeof fetch

test('cold run parks an idle Materia matching the modus image ref', async () => {
  const materiae = memoryMateriae()
  const cold = new FakeRunPodClient(okFetch([]), { stepMs: 1, warmTtlMs: 50 }, materiae)
  await withTrace(makeTraceContext({ actumId: 'a1' }), async () => {
    await cold.submit({ input, webhook: 'http://localhost/wh' })
    await new Promise(r => setTimeout(r, 100))
  })
  const parked = materiae.all().find(m => m.imageRef === OCI)
  assert.ok(parked, 'expected a parked materia')
  assert.equal(parked!.status, 'idle')
  assert.ok(parked!.warmUntil instanceof Date, 'warmUntil should be a Date')
})

test('warm reuse emits warm-pod-found, delivers, and re-arms the idle window', async () => {
  const materiae = memoryMateriae()
  const m = await materiae.create({
    genus: 'runpod', externusId: 'pod-x', gpu: 'RTX 4090', vramGb: 24, ramGb: 32,
    imageRef: OCI, impetusPerSecond: 0n, status: 'active',
  } as Omit<Materia, 'id'>)

  const webhooks: Array<{ id: string; status: string }> = []
  const warm = new FakeWarmPodClient(m, materiae, okFetch(webhooks), { stepMs: 1, warmTtlMs: 50 })

  const stages: string[] = []
  const listener = (d: { stage: string }): void => { stages.push(d.stage) }
  bus.on('actum.stage', listener)
  let jobId = ''
  await withTrace(makeTraceContext({ actumId: 'a2' }), async () => {
    const r = await warm.submit({ input, webhook: 'http://localhost/wh' })
    jobId = r.id
    await new Promise(r => setTimeout(r, 100))
  })
  bus.off('actum.stage', listener)

  assert.ok(jobId.startsWith('pod-x-'), `jobId keyed by job, not pod id: ${jobId}`)
  assert.ok(stages.includes('warm-pod-found'), `stages missing warm-pod-found: ${stages.join(',')}`)
  assert.ok(stages.includes('inferring'), `stages missing inferring: ${stages.join(',')}`)
  assert.equal(webhooks.length, 1)
  assert.equal(webhooks[0].id, jobId)
  assert.equal(webhooks[0].status, 'COMPLETED')

  const after = await materiae.findById(m.id)
  assert.equal(after!.status, 'idle')
  assert.ok(after!.warmUntil instanceof Date)
})

test('reapIdle terminates the parked pod once its warm window lapses', async () => {
  const materiae = memoryMateriae()
  await materiae.create({
    genus: 'runpod', externusId: 'pod-y', gpu: 'RTX 4090', vramGb: 24, ramGb: 32,
    imageRef: OCI, impetusPerSecond: 0n, status: 'idle', warmUntil: new Date(Date.now() - 1),
  } as Omit<Materia, 'id'>)
  const reaped = await materiae.reapIdle(new Date())
  assert.equal(reaped.length, 1)
  assert.equal(reaped[0].externusId, 'pod-y')
})
