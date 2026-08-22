import { test } from 'node:test'
import assert from 'node:assert/strict'
import { FakeRunPodClient } from '../../../src/crystal/FakeRunPodClient.js'
import type { Materia, MateriaStore } from '../../../src/types/materia.js'
import type { Hospitium, HospitiumStore } from '../../../src/types/hospitium.js'
import { bus } from '../../../src/lib/bus.js'
import { withTrace, makeTraceContext } from '../../../src/lib/trace.js'

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
    async create(input) {
      const h = { ...input, id: `h${++n}` } as Hospitium
      if (!h.materiaId) throw new Error('memoryHospitia: this double keys by materiaId; create needs one')
      map.set(h.materiaId, h); return h
    },
    async findByMateriaId(materiaId) { return map.get(materiaId) ?? null },
    // Studio-binding half of the interface. This suite provisions gen-warm pod records,
    // which carry a materiaId from creation — unreached here, so these throw rather than
    // return a plausible default.
    async findByModoId(_modoId) { throw new Error('memoryHospitia.findByModoId: not implemented for this suite') },
    async bindMateria(_modoId, _materiaId) { throw new Error('memoryHospitia.bindMateria: not implemented for this suite') },
    async findActive() { return [...map.values()].filter(h => !h.terminatum) },
    async update(materiaId, patch) { const h = { ...map.get(materiaId)!, ...patch }; map.set(materiaId, h); return h },
    all() { return [...map.values()] },
  }
}

const okFetch = (async () => new Response('{}', { status: 200 })) as unknown as typeof fetch
const INPUT = { image: { ociRef: 'runpod/pytorch:2.4.0' } }

test('Phase A: stamps bootCostImpetus on the Materia (identity-blind half)', async () => {
  const materiae = memoryMateriae()
  const client = new FakeRunPodClient(okFetch, { stepMs: 1, warmTtlMs: 50 }, materiae)
  await withTrace(makeTraceContext({ actumId: 'a1', animaId: 'host-1' }), async () => {
    await client.submit({ input: INPUT, webhook: 'http://localhost/wh' })
    await new Promise(r => setTimeout(r, 100))
  })
  const parked = materiae.all().find(m => m.imageRef === 'runpod/pytorch:2.4.0')
  assert.ok(parked, 'expected a parked materia')
  assert.equal(typeof parked!.bootCostImpetus, 'bigint')
  assert.ok(parked!.bootCostImpetus! > 0n, 'bootCostImpetus should be > 0')
  // The pod's own row stays identity-blind — no hostAnimaId / adminAnimaIds.
  const raw = parked as unknown as Record<string, unknown>
  assert.equal(raw.hostAnimaId, undefined)
  assert.equal(raw.adminAnimaIds, undefined)
})

test('Phase A: creates the paired Hospitium for an identified host (hostKey = { animaId })', async () => {
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
  assert.equal(hospitia.all().length, 1)
  const h = hospitia.all()[0]
  assert.deepEqual(h.hostKey, { animaId: 'host-1' })
  assert.equal(h.materiaId, materiae.all()[0].id)
  assert.ok(h.inceptum instanceof Date)
})

test('Phase A: creates the paired Hospitium for an anonymous host (hostKey = { commitment })', async () => {
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
  assert.equal(hospitia.all().length, 1)
  assert.deepEqual(hospitia.all()[0].hostKey, { commitment })
  // Materia stays identity-blind even when the host is anonymous.
  assert.equal((materiae.all()[0] as unknown as Record<string, unknown>).hostAnimaId, undefined)
})

test('Phase A: stamps Materia.groupChatId when the provisioning context carries one', async () => {
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
  assert.equal(parked.groupChatId, 'g-456')
  // Identity still off-pod — only the chat id (not identity) is on Materia.
  assert.equal((parked as unknown as Record<string, unknown>).adminAnimaIds, undefined)
  assert.deepEqual(hospitia.all()[0].hostKey, { animaId: 'host-1' })
})

test('Phase A: DM provisioning leaves groupChatId absent on the Materia', async () => {
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
  assert.equal(materiae.all()[0].groupChatId, undefined)
})

test('Phase A: emits pod.parked carrying materiaId + groupChatId + source platform', async () => {
  const materiae = memoryMateriae()
  const client = new FakeRunPodClient(okFetch, { stepMs: 1, warmTtlMs: 50 }, materiae)
  const events: Array<{ materiaId: string; groupChatId?: string; platform?: string }> = []
  const listener = (d: { materiaId: string; groupChatId?: string; platform?: string }): void => { events.push(d) }
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
  assert.equal(events.length, 1)
  assert.equal(events[0].materiaId, materiae.all()[0].id)
  assert.equal(events[0].groupChatId, 'g-456')
  assert.equal(events[0].platform, 'telegram')
})

test('Phase A: omits platform on the event when the trace has no platform set', async () => {
  const materiae = memoryMateriae()
  const client = new FakeRunPodClient(okFetch, { stepMs: 1, warmTtlMs: 50 }, materiae)
  const events: Array<{ platform?: string }> = []
  const listener = (d: { platform?: string }): void => { events.push(d) }
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
  assert.equal(events.length, 1)
  assert.equal(events[0].platform, undefined)
})

test('Phase A: skips Hospitium creation when no hostKey is in the provisioning context', async () => {
  const materiae = memoryMateriae()
  const hospitia = memoryHospitia()
  const client = new FakeRunPodClient(okFetch, { stepMs: 1, warmTtlMs: 50 }, materiae, hospitia)
  await withTrace(makeTraceContext({ actumId: 'a1' }), async () => {
    await client.submit({ input: INPUT, webhook: 'http://localhost/wh' })   // no provisioningContext
    await new Promise(r => setTimeout(r, 100))
  })
  assert.equal(materiae.all().length, 1)
  assert.equal(hospitia.all().length, 0)
})
