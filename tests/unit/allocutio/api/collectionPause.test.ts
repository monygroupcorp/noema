import { test } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { CollectioCursor } from '../../../../src/crystal/CollectioCursor.js'
import type { Collectio, Collectiones, Collectionum, CollectioStatus } from '../../../../src/types/collectio.js'
import type { Actum, ActumStatus } from '../../../../src/types/actum.js'
import type { Actorum, Inceptio } from '../../../../src/types/cursus.js'

// =============================================================================
// Collection pause — persisted + rehydrated across a (simulated) restart.
// Guards the noema-032 fix: pausing writes `Collectio.pausatum`, and a fresh
// CollectioCursor reading the SAME persisted stores must honour it — a paused
// collection stays paused after a process restart until resumed.
// =============================================================================

function makeCollectio(overrides: Partial<Collectio> = {}): Collectio {
  return {
    id: 'col-1',
    modusId: 'flux-schnell',
    aditusBase: {},
    tractus: [],
    numerus: 5,
    provenanceHash: 'sha256:test',
    by: { animaId: 'anima-1' },
    acta: [],
    completae: 0,
    fractae: 0,
    pendentes: 0,
    reiectae: 0,
    concurrentia: 2,
    impetusTotal: 0n,
    status: 'agens',
    natum: new Date(),
    ...overrides,
  }
}

function makeCollectionum(initial: Collectio): Collectionum {
  const store = new Map<string, Collectio>([[initial.id, { ...initial }]])
  return {
    async find(id: string) {
      return store.get(id) ?? null
    },
    async list(filter?: Partial<Pick<Collectio, 'status'>>): Promise<Collectiones> {
      const all = [...store.values()]
      return filter?.status ? all.filter((c) => c.status === filter.status) : all
    },
    async listByStatus(status: CollectioStatus) {
      return [...store.values()].filter((c) => c.status === status)
    },
    async create(input) {
      const c = { ...input, id: randomUUID(), natum: new Date(), acta: [], completae: 0, fractae: 0, pendentes: 0, reiectae: 0, impetusTotal: 0n } as Collectio
      store.set(c.id, c)
      return c
    },
    async update(id: string, patch: Partial<Collectio>) {
      const existing = store.get(id)
      if (!existing) throw new Error(`Collectio '${id}' not found`)
      const updated = { ...existing, ...patch }
      store.set(id, updated)
      return updated
    },
  }
}

function makeActorum(): Actorum {
  const store = new Map<string, Actum>()
  return {
    async create(actum) {
      const a = { ...actum, inceptum: new Date() } as Actum
      store.set(a.id, a)
      return a
    },
    async update(id: string, patch: Partial<Actum>) {
      const existing = store.get(id)
      if (!existing) throw new Error(`Actum '${id}' not found`)
      const updated = { ...existing, ...patch } as Actum
      store.set(id, updated)
      return updated
    },
    async findById(id: string) {
      return store.get(id) ?? null
    },
    async findByExternusJobId() {
      return null
    },
    async findExpired() {
      return []
    },
    // Seams the pause/resume path never reaches: they throw rather than return a default
    // that would let a later test pass without a real implementation.
    async findByCallbackNonce() { throw new Error('unused') },
    async findByNullifier() { throw new Error('unused') },
    async findInFlight() { throw new Error('unused') },
    async findByCompositum() { throw new Error('unused') },
    store,
  } as Actorum & { store: Map<string, Actum> }
}

test('pause() persists pausatum; resume() clears it', async () => {
  const collectio = makeCollectio()
  const collectiones = makeCollectionum(collectio)
  const actorum = makeActorum()
  let counter = 0
  async function dispatch(inceptio: Inceptio): Promise<{ actum: Actum }> {
    const id = `actum-${counter++}`
    const actum: Actum = {
      id,
      modusId: inceptio.modusId,
      modusVersiono: '1',
      aditus: inceptio.aditus,
      status: 'nascens' as ActumStatus,
      impetus: 0n,
      signaConsumed: [],
      inceptum: new Date(),
      expirat: new Date(Date.now() + 60_000),
    }
    ;(actorum as unknown as { store: Map<string, Actum> }).store.set(id, actum)
    return { actum }
  }

  const cursor = new CollectioCursor(dispatch, collectiones, actorum, {})
  await cursor.start(collectio)
  await cursor.pause('col-1')
  assert.ok((await collectiones.find('col-1'))?.pausatum instanceof Date)

  await cursor.resume('col-1')
  assert.equal((await collectiones.find('col-1'))?.pausatum, undefined)
})

test('pause -> simulated restart (fresh cursor over same store) -> no dispatch until resume', async () => {
  const collectio = makeCollectio({ id: 'col-restart', status: 'agens', numerus: 5, concurrentia: 2 })
  const collectiones = makeCollectionum(collectio)
  const actorum = makeActorum() as Actorum & { store: Map<string, Actum> }

  let counter = 0
  const calls: Inceptio[] = []
  // Dispatch writes into the SAME shared actorum — mirrors a real async pod
  // persisting an Actum row, so a fresh cursor can rehydrate from it.
  async function dispatch(inceptio: Inceptio): Promise<{ actum: Actum }> {
    calls.push(inceptio)
    const id = `actum-${counter++}`
    const actum: Actum = {
      id,
      modusId: inceptio.modusId,
      modusVersiono: '1',
      aditus: inceptio.aditus,
      status: 'nascens' as ActumStatus,
      impetus: 0n,
      signaConsumed: [],
      inceptum: new Date(),
      expirat: new Date(Date.now() + 60_000),
    }
    actorum.store.set(id, actum)
    return { actum }
  }

  // First cursor: start, pause (persists pausatum), then "die" — simulating a
  // process restart. No further calls are made on this instance.
  const cursor1 = new CollectioCursor(dispatch, collectiones, actorum, {})
  await cursor1.start(collectio)
  assert.equal(calls.length, 2, 'dispatched 2 pieces (concurrentia) before pause')
  await cursor1.pause('col-restart')

  const stored = await collectiones.find('col-restart')
  assert.ok(stored?.pausatum, 'pause persisted before the "restart"')

  // Fresh CollectioCursor instance over the SAME persisted stores — the restart.
  const cursor2 = new CollectioCursor(dispatch, collectiones, actorum, {})
  await cursor2.rehydrate()

  const callsBeforeResume = calls.length
  await cursor2.onActumCompleta('col-restart', 'actum-0', true)
  assert.equal(calls.length, callsBeforeResume, 'no dispatch after restart while still paused')

  await cursor2.resume('col-restart')
  assert.ok(calls.length > callsBeforeResume, 'dispatch resumes once unpaused')
})
