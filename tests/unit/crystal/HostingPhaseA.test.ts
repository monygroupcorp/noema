import { describe, it, expect, vi } from 'vitest'
import { FakeRunPodClient } from '../../../src/crystal/FakeRunPodClient.js'
import type { Materia, MateriaStore } from '../../../src/types/materia.js'
import type { Hospitium, HospitiumStore } from '../../../src/types/hospitium.js'
import { bus } from '../../../src/lib/bus.js'
import { withTrace, makeTraceContext } from '../../../src/lib/trace.js'
import { bus } from '../../../src/lib/bus.js'

/** Minimal in-memory MateriaStore — same shape as the FakeWarmPodClient test. */
function memoryMateriae(): MateriaStore & { all(): Materia[] } {
  const map = new Map<string, Materia>()
  let n = 0
  return {
    async create(input) { const m = { ...input, id: `m${++n}` } as Materia; map.set(m.id, m); return m },
    async findById(id) { return map.get(id) ?? null },
    async update(id, patch) { const m = { ...map.get(id)!, ...patch }; map.set(id, m); return m },
    async findWarm() { return null },
    async findActive() { return [...map.values()].filter(m => m.status !== 'terminated') },
    async reapIdle() { return [] },
    all() { return [...map.values()] },
  }
}
function memoryHospitia(): HospitiumStore & { all(): Hospitium[] } {
  const map = new Map<string, Hospitium>()
  let n = 0
  return {
    async create(input) { const h = { ...input, id: `h${++n}` } as Hospitium; map.set(h.materiaId, h); return h },
    async findByMateriaId(materiaId) { return map.get(materiaId) ?? null },
    async update(materiaId, patch) { const h = { ...map.get(materiaId)!, ...patch }; map.set(materiaId, h); return h },
    all() { return [...map.values()] },
  }
}

const okFetch = vi.fn(async () => new Response('{}', { status: 200 })) as unknown as typeof fetch
const INPUT = { image: { ociRef: 'runpod/pytorch:2.4.0' } }

describe('Phase A — warm-park annotation', () => {
  it('stamps bootCostImpetus on the Materia (identity-blind half)', async () => {
    const materiae = memoryMateriae()
    const client = new FakeRunPodClient(okFetch, { stepMs: 1, warmTtlMs: 50 }, materiae)
    await withTrace(makeTraceContext({ actumId: 'a1', animaId: 'host-1' }), async () => {
      await client.submit({ input: INPUT, webhook: 'http://localhost/wh' })
      await new Promise(r => setTimeout(r, 100))
    })
    const parked = materiae.all().find(m => m.imageRef === 'runpod/pytorch:2.4.0')
    expect(parked).toBeTruthy()
    expect(typeof parked!.bootCostImpetus).toBe('bigint')
    expect(parked!.bootCostImpetus!).toBeGreaterThan(0n)
    // The pod's own row stays identity-blind — no hostAnimaId / adminAnimaIds.
    expect((parked as unknown as Record<string, unknown>).hostAnimaId).toBeUndefined()
    expect((parked as unknown as Record<string, unknown>).adminAnimaIds).toBeUndefined()
  })

  it('creates the paired Hospitium for an identified host (hostKey = { animaId })', async () => {
    const materiae = memoryMateriae()
    const hospitia = memoryHospitia()
    const client = new FakeRunPodClient(okFetch, { stepMs: 1, warmTtlMs: 50 }, materiae, hospitia)
    await withTrace(makeTraceContext({ actumId: 'a1', animaId: 'host-1' }), async () => {
      await client.submit({
        input: INPUT,
        webhook: 'http://localhost/wh',
        provisioningContext: { hostKey: { animaId: 'host-1' } },
      })
      await new Promise(r => setTimeout(r, 100))
    })
    expect(hospitia.all()).toHaveLength(1)
    const h = hospitia.all()[0]
    expect(h.hostKey).toEqual({ animaId: 'host-1' })
    expect(h.materiaId).toBe(materiae.all()[0].id)
    expect(h.inceptum).toBeInstanceOf(Date)
  })

  it('creates the paired Hospitium for an anonymous host (hostKey = { commitment })', async () => {
    const materiae = memoryMateriae()
    const hospitia = memoryHospitia()
    const client = new FakeRunPodClient(okFetch, { stepMs: 1, warmTtlMs: 50 }, materiae, hospitia)
    const commitment = '0xabc123anon'
    await withTrace(makeTraceContext({ actumId: 'a1', commitment }), async () => {
      await client.submit({
        input: INPUT,
        webhook: 'http://localhost/wh',
        provisioningContext: { hostKey: { commitment } },
      })
      await new Promise(r => setTimeout(r, 100))
    })
    expect(hospitia.all()).toHaveLength(1)
    expect(hospitia.all()[0].hostKey).toEqual({ commitment })
    // Materia stays identity-blind even when the host is anonymous.
    expect((materiae.all()[0] as unknown as Record<string, unknown>).hostAnimaId).toBeUndefined()
  })

  it('stamps Materia.groupChatId when the provisioning context carries one', async () => {
    const materiae = memoryMateriae()
    const hospitia = memoryHospitia()
    const client = new FakeRunPodClient(okFetch, { stepMs: 1, warmTtlMs: 50 }, materiae, hospitia)
    await withTrace(makeTraceContext({ actumId: 'a1', animaId: 'host-1', groupChatId: 'g-456' }), async () => {
      await client.submit({
        input: INPUT,
        webhook: 'http://localhost/wh',
        provisioningContext: { hostKey: { animaId: 'host-1' }, groupChatId: 'g-456' },
      })
      await new Promise(r => setTimeout(r, 100))
    })
    const parked = materiae.all()[0]
    expect(parked.groupChatId).toBe('g-456')
    // Identity still off-pod — only the chat id (not identity) is on Materia.
    expect((parked as unknown as Record<string, unknown>).adminAnimaIds).toBeUndefined()
    expect(hospitia.all()[0].hostKey).toEqual({ animaId: 'host-1' })
  })

  it('DM provisioning leaves groupChatId absent on the Materia', async () => {
    const materiae = memoryMateriae()
    const client = new FakeRunPodClient(okFetch, { stepMs: 1, warmTtlMs: 50 }, materiae)
    await withTrace(makeTraceContext({ actumId: 'a1', animaId: 'host-1' }), async () => {
      await client.submit({
        input: INPUT,
        webhook: 'http://localhost/wh',
        provisioningContext: { hostKey: { animaId: 'host-1' } },
      })
      await new Promise(r => setTimeout(r, 100))
    })
    expect(materiae.all()[0].groupChatId).toBeUndefined()
  })

  it('emits pod.parked carrying materiaId + groupChatId + source platform (cross-platform self-scoping)', async () => {
    const materiae = memoryMateriae()
    const client = new FakeRunPodClient(okFetch, { stepMs: 1, warmTtlMs: 50 }, materiae)
    const events: Array<{ materiaId: string; groupChatId?: string; platform?: string }> = []
    const listener = (d: { materiaId: string; groupChatId?: string; platform?: string }) => events.push(d)
    bus.on('pod.parked', listener)
    try {
      await withTrace(makeTraceContext({ actumId: 'a1', animaId: 'host-1', groupChatId: 'g-456', platform: 'telegram' }), async () => {
        await client.submit({
          input: INPUT,
          webhook: 'http://localhost/wh',
          provisioningContext: { hostKey: { animaId: 'host-1' }, groupChatId: 'g-456' },
        })
        await new Promise(r => setTimeout(r, 100))
      })
    } finally { bus.off('pod.parked', listener) }
    expect(events).toHaveLength(1)
    expect(events[0].materiaId).toBe(materiae.all()[0].id)
    expect(events[0].groupChatId).toBe('g-456')
    expect(events[0].platform).toBe('telegram')
  })

  it('omits platform on the event when the trace has no platform set (e.g. legacy / api flow)', async () => {
    const materiae = memoryMateriae()
    const client = new FakeRunPodClient(okFetch, { stepMs: 1, warmTtlMs: 50 }, materiae)
    const events: Array<{ platform?: string }> = []
    const listener = (d: { platform?: string }) => events.push(d)
    bus.on('pod.parked', listener)
    try {
      await withTrace(makeTraceContext({ actumId: 'a1', animaId: 'host-1' }), async () => {
        await client.submit({
          input: INPUT,
          webhook: 'http://localhost/wh',
          provisioningContext: { hostKey: { animaId: 'host-1' } },
        })
        await new Promise(r => setTimeout(r, 100))
      })
    } finally { bus.off('pod.parked', listener) }
    expect(events).toHaveLength(1)
    expect(events[0].platform).toBeUndefined()
  })

  it('skips Hospitium creation when no hostKey is in the provisioning context (e.g. true anonymous run with no commitment claimed)', async () => {
    const materiae = memoryMateriae()
    const hospitia = memoryHospitia()
    const client = new FakeRunPodClient(okFetch, { stepMs: 1, warmTtlMs: 50 }, materiae, hospitia)
    await withTrace(makeTraceContext({ actumId: 'a1' }), async () => {
      await client.submit({ input: INPUT, webhook: 'http://localhost/wh' })   // no provisioningContext
      await new Promise(r => setTimeout(r, 100))
    })
    expect(materiae.all()).toHaveLength(1)
    expect(hospitia.all()).toHaveLength(0)
  })
})
