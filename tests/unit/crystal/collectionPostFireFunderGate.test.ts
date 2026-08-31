// =============================================================================
// A fired collection's flow may only be moved by the funder.
// =============================================================================
//
// `patchCollectionDraft` is owner-scoped, and ownership is a team overlay: every member of a
// collection's Sodalitas passes the owner check. Once a collection is fired it keeps dispatching,
// and `CollectioCursor` re-reads `modusId` on every tick — so a post-fire flow change directs
// pieces funded by the collection's `by`. `fireCollection` and `extendCollection` already gate
// their spend-triggering writes on the funder; these tests pin the same rule on the post-fire
// flow change, and pin that draft-mode team editing is untouched by it.
//
// Hermetic: in-memory stores + a recording cursor. No DB, no network.
// =============================================================================

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'

import { CrystalApi, type CrystalApiDeps } from '../../../src/allocutio/api/CrystalApi.js'
import type { Collectio, Collectiones, Collectionum, CollectioStatus } from '../../../src/types/collectio.js'
import type { Modus } from '../../../src/types/modus.js'
import type { AuctorKey } from '../../../src/flow/types.js'

const funder: AuctorKey = { animaId: 'anima-funder' }
const teammate: AuctorKey = { animaId: 'anima-teammate' }
const TEAM_ID = 'team-1'
const FLOW_ID = 'test-flow'
const OTHER_FLOW_ID = 'test-flow-b'

const isForbidden = (e: unknown) => (e as { code?: string }).code === 'auth.forbidden'

function makeModus(id: string = FLOW_ID, versio = '1.0.0'): Modus {
  return {
    id,
    nomen: id,
    genus: 'atomicus',
    versio,
    contentHash: `sha256:${id}`,
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
      const c = { ...input, id: randomUUID(), natum: new Date(), acta: [], completae: 0, fractae: 0, pendentes: 0, reiectae: 0, impetusTotal: 0n } as Collectio
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

/** CrystalApi wired with the Collections path plus a two-member team the funder belongs to. */
function makeApi() {
  const collectiones = makeCollectionum()
  const started: string[] = []
  const flows = [makeModus(), makeModus(OTHER_FLOW_ID, '2.0.0')]
  const deps = {
    collectiones,
    collectioCursor: {
      async start(c: Collectio) { started.push(c.id) },
    },
    modorum: {
      async find(id: string) { return flows.find((m) => m.id === id) ?? null },
    },
    animae: {
      async find(id: string) { return { id } },
    },
    sodalitatum: {
      async find(id: string) {
        return id === TEAM_ID ? { id: TEAM_ID, membra: ['anima-funder', 'anima-teammate'] } : null
      },
      async listByMember(animaId: string) {
        return ['anima-funder', 'anima-teammate'].includes(animaId) ? [{ id: TEAM_ID, membra: ['anima-funder', 'anima-teammate'] }] : []
      },
    },
  } as unknown as CrystalApiDeps
  return { api: new CrystalApi(deps), collectiones, started }
}

const axis = [{ porta: 'prompt', valores: [{ value: 'a' }, { value: 'b' }] }]

/** A team-owned draft, authored and funded by `funder`. */
async function teamDraft() {
  const { api, collectiones, started } = makeApi()
  const c = await api.collect(funder, { draft: true, nomen: 'a set', teamId: TEAM_ID })
  await api.patchCollectionDraft(funder, c.id, { modusId: FLOW_ID, numerus: 2, tractus: axis })
  assert.equal(collectiones.store.get(c.id)?.sodalitasId, TEAM_ID, 'the fixture must be team-owned')
  return { api, collectiones, started, id: c.id }
}

/** The same collection, fired — still dispatching, still funded by `funder`. */
async function firedTeamCollection() {
  const ctx = await teamDraft()
  await ctx.api.fireCollection(funder, ctx.id)
  assert.notEqual(ctx.collectiones.store.get(ctx.id)?.status, 'draft', 'the fixture must actually be fired')
  return ctx
}

test('post-fire flow change: the funder may move a fired collection to another flow', async () => {
  const { api, collectiones, id } = await firedTeamCollection()

  const patched = await api.patchCollectionDraft(funder, id, { modusId: OTHER_FLOW_ID })

  assert.equal(patched.modusId, OTHER_FLOW_ID, 'the funder’s flow change lands')
  assert.match(patched.provenanceHash, /^sha256:[0-9a-f]+$/)
  assert.equal(collectiones.store.get(id)?.modusId, OTHER_FLOW_ID)
})

test('post-fire flow change: a non-funder team member is refused, and the live collection keeps its flow', async () => {
  const { api, collectiones, id } = await firedTeamCollection()

  // The teammate passes the owner check — the team overlay owns the collection…
  assert.equal((await api.getCollection(teammate, id)).id, id)

  // …but the flow directs spend charged to the funder, so the write is refused.
  await assert.rejects(() => api.patchCollectionDraft(teammate, id, { modusId: OTHER_FLOW_ID }), isForbidden)

  assert.equal(collectiones.store.get(id)?.modusId, FLOW_ID, 'the stored flow did not move')
  // `CollectioCursor` re-reads the collection on every dispatch tick — that read still sees the
  // flow the funder chose.
  assert.equal((await collectiones.find(id))?.modusId, FLOW_ID)
})

test('the gate is scoped to fired collections: a non-funder team member may still edit a DRAFT', async () => {
  const { api, collectiones, id } = await teamDraft()

  const patched = await api.patchCollectionDraft(teammate, id, { modusId: OTHER_FLOW_ID })
  assert.equal(patched.modusId, OTHER_FLOW_ID, 'draft-mode team editing is unaffected')

  // Traits and supply stay writable in draft for the team member too.
  const regrid = await api.patchCollectionDraft(teammate, id, { numerus: 5 })
  assert.equal(regrid.total, 5)
  assert.equal(collectiones.store.get(id)?.status, 'draft')
})
