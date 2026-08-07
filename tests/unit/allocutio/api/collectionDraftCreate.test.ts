// =============================================================================
// Collection create is a NAMING act — the flowless draft lifecycle.
// =============================================================================
//
// Creating a collection used to be a generation launch in disguise: it demanded a base flow,
// a supply and an axis of variation before it would create anything. It now asks only for a
// name (plus an optional description), always as a draft, and the generative config is
// authored afterwards. These tests pin the three halves of that:
//
//   1. a draft may be created knowing NOTHING generative — and dispatches nothing;
//   2. the immediate-spend path (draft falsy) keeps its original strictness, unchanged;
//   3. firing is where completeness is enforced — an unfinished draft refuses to dispatch,
//      so "create is free" never becomes "fire crashes at dispatch".
//
// Hermetic: in-memory stores + a recording cursor. No DB, no network.
// =============================================================================

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'

import { CrystalApi, type CrystalApiDeps } from '../../../../src/allocutio/api/CrystalApi.js'
import type { Collectio, Collectiones, Collectionum, CollectioStatus } from '../../../../src/types/collectio.js'
import type { Modus } from '../../../../src/types/modus.js'
import type { AuctorKey } from '../../../../src/flow/types.js'

const auctor: AuctorKey = { animaId: 'anima-1' }
const FLOW_ID = 'test-flow'

function makeModus(): Modus {
  return {
    id: FLOW_ID,
    nomen: FLOW_ID,
    genus: 'atomicus',
    versio: '1.0.0',
    contentHash: `sha256:${FLOW_ID}`,
    aditus: { prompt: { type: 'text', required: true } },
    exitus: { image: { type: 'image' } },
    ministerium: 'fake',
    canonica: true,
    natum: new Date('2026-01-01T00:00:00Z'),
    mutatum: new Date('2026-01-01T00:00:00Z'),
  }
}

function makeCollectionum(): Collectionum & { store: Map<string, Collectio> } {
  const store = new Map<string, Collectio>()
  return {
    store,
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
      const c = { ...input, id: randomUUID(), natum: new Date(), acta: [], completae: 0, fractae: 0, reiectae: 0, impetusTotal: 0n } as Collectio
      store.set(c.id, c)
      return c
    },
    async update(id: string, patch) {
      const existing = store.get(id)
      if (!existing) throw new Error(`Collectio '${id}' not found`)
      const updated = { ...existing, ...patch } as Collectio
      store.set(id, updated)
      return updated
    },
  }
}

/** A CrystalApi wired with only what the Collections path touches, plus a recording cursor. */
function makeApi(over: { flows?: Modus[]; frozen?: boolean } = {}) {
  const collectiones = makeCollectionum()
  const started: string[] = []
  const flows = over.flows ?? [makeModus()]
  const deps = {
    collectiones,
    collectioCursor: {
      async start(c: Collectio) { started.push(c.id) },
    },
    modorum: {
      async find(id: string) { return flows.find((m) => m.id === id) ?? null },
    },
    animae: {
      async find() { return over.frozen ? { id: 'anima-1', disputeFrozen: true } : { id: 'anima-1' } },
    },
  } as unknown as CrystalApiDeps
  return { api: new CrystalApi(deps), collectiones, started }
}

test('collect: a draft may be created with a name + description and NOTHING generative — and dispatches nothing', async () => {
  const { api, collectiones, started } = makeApi()

  const c = await api.collect(auctor, { draft: true, nomen: 'a set', descriptio: 'a working note' })

  assert.equal(c.status, 'draft')
  assert.equal(c.nomen, 'a set')
  assert.equal(c.modusId, '')          // no flow chosen yet
  assert.equal(c.total, 0)
  assert.equal(c.provenanceHash, '')   // nothing to content-address yet
  // `descriptio` is a persisted field, not a UI-only string.
  assert.equal(collectiones.store.get(c.id)?.descriptio, 'a working note')
  assert.deepEqual(collectiones.store.get(c.id)?.tractus, [])
  assert.deepEqual(started, [], 'a draft must NOT be dispatched')
})

test('collect: a draft that DOES name a flow is still validated, and gets a real provenance hash', async () => {
  const { api, started } = makeApi()

  const c = await api.collect(auctor, { draft: true, nomen: 'a set', modusId: FLOW_ID, total: 4, tractus: [] })
  assert.equal(c.modusId, FLOW_ID)
  assert.notEqual(c.provenanceHash, '')
  assert.deepEqual(started, [])

  await assert.rejects(
    () => api.collect(auctor, { draft: true, modusId: 'no-such-flow' }),
    (e: unknown) => (e as { code?: string }).code === 'not_found.flow',
  )
})

test('collect: the immediate-spend path is unchanged — no flow still throws not_found.flow', async () => {
  const { api, started } = makeApi()

  await assert.rejects(
    () => api.collect(auctor, { nomen: 'a set' }),
    (e: unknown) => (e as { code?: string }).code === 'not_found.flow',
  )
  assert.deepEqual(started, [], 'nothing was created, so nothing dispatched')

  // …and a complete non-draft still creates AND dispatches.
  const c = await api.collect(auctor, { modusId: FLOW_ID, total: 2, tractus: [{ porta: 'prompt', valores: [{ value: 'a' }, { value: 'b' }] }] })
  assert.equal(c.status, 'pending')
  assert.deepEqual(started, [c.id])
})

test('fireCollection: an unfinished draft refuses to fire, and dispatches nothing', async () => {
  const { api, collectiones, started } = makeApi()
  const axis = [{ porta: 'prompt', valores: [{ value: 'a' }, { value: 'b' }] }]

  const c = await api.collect(auctor, { draft: true, nomen: 'a set' })

  // No flow.
  await assert.rejects(
    () => api.fireCollection(auctor, c.id),
    (e: unknown) => (e as { code?: string }).code === 'not_found.flow',
  )

  // Flow, but no supply.
  await api.patchCollectionDraft(auctor, c.id, { modusId: FLOW_ID, tractus: axis })
  await assert.rejects(
    () => api.fireCollection(auctor, c.id),
    (e: unknown) => (e as { code?: string }).code === 'input.malformed',
  )

  // Flow + supply, but no axis of variation.
  await api.patchCollectionDraft(auctor, c.id, { numerus: 3, tractus: [] })
  await assert.rejects(
    () => api.fireCollection(auctor, c.id),
    (e: unknown) => (e as { code?: string }).code === 'input.malformed',
  )

  assert.deepEqual(started, [], 'an unfinished draft must never reach the cursor')
  assert.equal(collectiones.store.get(c.id)?.status, 'draft', 'a refused fire leaves it a draft')

  // Complete it and it fires.
  await api.patchCollectionDraft(auctor, c.id, { tractus: axis })
  const fired = await api.fireCollection(auctor, c.id)
  assert.equal(fired.status, 'pending')
  assert.deepEqual(started, [c.id])
})

test('patchCollectionDraft: naming a flow re-derives provenance; a fired collection is frozen', async () => {
  const { api } = makeApi()

  const c = await api.collect(auctor, { draft: true, nomen: 'a set' })
  assert.equal(c.provenanceHash, '')

  const withFlow = await api.patchCollectionDraft(auctor, c.id, { modusId: FLOW_ID, numerus: 5 })
  assert.equal(withFlow.modusId, FLOW_ID)
  assert.equal(withFlow.total, 5)
  assert.match(withFlow.provenanceHash, /^sha256:[0-9a-f]+$/)

  // A bogus flow is rejected on the way in.
  await assert.rejects(
    () => api.patchCollectionDraft(auctor, c.id, { modusId: 'no-such-flow' }),
    (e: unknown) => (e as { code?: string }).code === 'not_found.flow',
  )

  // The grid changing re-addresses it too (the pre-existing guarantee, still held).
  const withGrid = await api.patchCollectionDraft(auctor, c.id, { tractus: [{ porta: 'prompt', valores: [{ value: 'a' }] }] })
  assert.notEqual(withGrid.provenanceHash, withFlow.provenanceHash)

  // Fired ⇒ frozen.
  await api.fireCollection(auctor, c.id)
  await assert.rejects(
    () => api.patchCollectionDraft(auctor, c.id, { modusId: FLOW_ID }),
    (e: unknown) => (e as { code?: string }).code === 'input.malformed',
  )
})

test('collect: the dispute-freeze gate still fires first — draft or not', async () => {
  const { api, collectiones } = makeApi({ frozen: true })
  const isForbidden = (e: unknown) => (e as { code?: string }).code === 'auth.forbidden'

  await assert.rejects(() => api.collect(auctor, { draft: true, nomen: 'a set' }), isForbidden)
  await assert.rejects(() => api.collect(auctor, { modusId: FLOW_ID, total: 1, tractus: [] }), isForbidden)
  assert.equal(collectiones.store.size, 0, 'a frozen auctor creates nothing at all')
})
