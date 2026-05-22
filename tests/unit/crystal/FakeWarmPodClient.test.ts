import { describe, it, expect, vi } from 'vitest'
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
const okFetch = (sink: unknown[]) => vi.fn(async (_u: string, init?: RequestInit) => {
  sink.push(JSON.parse((init?.body as string) ?? '{}')); return new Response('{}', { status: 200 })
}) as unknown as typeof fetch

describe('fake cold→warm→reap', () => {
  it('cold run parks an idle Materia matching the modus image ref', async () => {
    const materiae = memoryMateriae()
    const cold = new FakeRunPodClient(okFetch([]), { stepMs: 1, warmTtlMs: 50 }, materiae)
    await withTrace(makeTraceContext({ actumId: 'a1' }), async () => {
      await cold.submit({ input, webhook: 'http://localhost/wh' })
      await new Promise(r => setTimeout(r, 100))
    })
    const parked = materiae.all().find(m => m.imageRef === OCI)
    expect(parked).toBeTruthy()
    expect(parked!.status).toBe('idle')
    expect(parked!.warmUntil).toBeInstanceOf(Date)
  })

  it('warm reuse emits warm-pod-found, delivers, and re-arms the idle window', async () => {
    const materiae = memoryMateriae()
    const m = await materiae.create({
      genus: 'runpod', externusId: 'pod-x', gpu: 'RTX 4090', vramGb: 24, ramGb: 32,
      imageRef: OCI, impetusPerSecond: 0n, status: 'active',
    } as Omit<Materia, 'id'>)

    const webhooks: Array<{ id: string; status: string }> = []
    const warm = new FakeWarmPodClient(m, materiae, okFetch(webhooks), { stepMs: 1, warmTtlMs: 50 })

    const stages: string[] = []
    const listener = (d: { stage: string }) => stages.push(d.stage)
    bus.on('actum.stage', listener)
    let jobId = ''
    await withTrace(makeTraceContext({ actumId: 'a2' }), async () => {
      const r = await warm.submit({ input, webhook: 'http://localhost/wh' })
      jobId = r.id
      await new Promise(r => setTimeout(r, 100))
    })
    bus.off('actum.stage', listener)

    expect(jobId.startsWith('pod-x-')).toBe(true)  // webhook keyed by jobId, not pod id
    expect(stages).toContain('warm-pod-found')
    expect(stages).toContain('inferring')
    expect(webhooks).toHaveLength(1)
    expect(webhooks[0]).toMatchObject({ id: jobId, status: 'COMPLETED' })

    const after = await materiae.findById(m.id)
    expect(after!.status).toBe('idle')
    expect(after!.warmUntil).toBeInstanceOf(Date)
  })

  it('reapIdle terminates the parked pod once its warm window lapses', async () => {
    const materiae = memoryMateriae()
    await materiae.create({
      genus: 'runpod', externusId: 'pod-y', gpu: 'RTX 4090', vramGb: 24, ramGb: 32,
      imageRef: OCI, impetusPerSecond: 0n, status: 'idle', warmUntil: new Date(Date.now() - 1),
    } as Omit<Materia, 'id'>)
    const reaped = await materiae.reapIdle(new Date())
    expect(reaped).toHaveLength(1)
    expect(reaped[0].externusId).toBe('pod-y')
  })
})
