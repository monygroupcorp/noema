// =============================================================================
// A fired collection's spend-directing verbs belong to the funder alone.
// =============================================================================
//
// `patchCollectionDraft`, `approveCollectionPiece` and `rejectCollectionPiece` are owner-scoped,
// and ownership is a team overlay: every member of a collection's Sodalitas passes the owner
// check. Two of those verbs spend the collection's `by` once it has been fired.
//
//  - the FLOW: `CollectioCursor` re-reads `modusId` on every dispatch tick, so a post-fire flow
//    change redirects pieces the funder is paying for.
//  - a REJECTION: `rejectAndRevive` bumps `reiectae`, and the dispatch budget is
//    `numerus + reiectae` — so every rejection generates one more piece at the funder's expense,
//    as many times as a reviewer presses the button.
//
// `fireCollection` and `extendCollection` already gate their spend-triggering writes on the
// funder; these tests pin the same rule on both post-fire paths, and pin the two places the gate
// deliberately does NOT reach: draft-mode team editing, and approval (which dispatches nothing).
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
  // What the review verbs actually asked the cursor to do. A rejection that never reaches
  // `rejectAndRevive` is a rejection that never raised the dispatch budget.
  const reviewed: { approved: string[]; rejected: string[] } = { approved: [], rejected: [] }
  const frozen = new Set<string>()
  const flows = [makeModus(), makeModus(OTHER_FLOW_ID, '2.0.0')]
  const deps = {
    collectiones,
    collectioCursor: {
      async start(c: Collectio) { started.push(c.id) },
      async approveActum(_id: string, actumId: string) { reviewed.approved.push(actumId) },
      async rejectAndRevive(_id: string, actumId: string) { reviewed.rejected.push(actumId) },
    },
    modorum: {
      async find(id: string) { return flows.find((m) => m.id === id) ?? null },
    },
    animae: {
      async find(id: string) { return { id, disputeFrozen: frozen.has(id) } },
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
  return { api: new CrystalApi(deps), collectiones, started, reviewed, frozen }
}

const axis = [{ porta: 'prompt', valores: [{ value: 'a' }, { value: 'b' }] }]

/** A team-owned draft, authored and funded by `funder`. */
async function teamDraft() {
  const { api, collectiones, started, reviewed, frozen } = makeApi()
  const c = await api.collect(funder, { draft: true, nomen: 'a set', teamId: TEAM_ID })
  await api.patchCollectionDraft(funder, c.id, { modusId: FLOW_ID, numerus: 2, tractus: axis })
  assert.equal(collectiones.store.get(c.id)?.sodalitasId, TEAM_ID, 'the fixture must be team-owned')
  return { api, collectiones, started, reviewed, frozen, id: c.id }
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

// ── The other post-fire spend path: a rejection rerolls the piece ──────────────────

const HELD_PIECE = 'actum-held'

test('post-fire rejection: the funder may reject a held piece, and it reaches the reroll', async () => {
  const { api, reviewed, id } = await firedTeamCollection()

  await api.rejectCollectionPiece(funder, id, HELD_PIECE)

  assert.deepEqual(reviewed.rejected, [HELD_PIECE], 'the funder’s rejection reaches rejectAndRevive')
})

test('post-fire rejection: a non-funder team member is refused, and no replacement is dispatched', async () => {
  const { api, reviewed, id } = await firedTeamCollection()

  // The teammate passes the owner check — the team overlay owns the collection…
  assert.equal((await api.getCollection(teammate, id)).id, id)

  // …but a rejection raises `numerus + reiectae` and generates another piece on the funder’s
  // balance, so it is refused for the same reason an extend is.
  await assert.rejects(() => api.rejectCollectionPiece(teammate, id, HELD_PIECE), isForbidden)

  assert.deepEqual(reviewed.rejected, [], 'the budget-raising call never reached the cursor')
})

test('post-fire rejection: APPROVAL stays open to the team — it dispatches nothing', async () => {
  const { api, reviewed, id } = await firedTeamCollection()

  await api.approveCollectionPiece(teammate, id, HELD_PIECE)

  assert.deepEqual(reviewed.approved, [HELD_PIECE], 'a teammate may still accept a piece')
  assert.deepEqual(reviewed.rejected, [], 'and accepting one costs the funder nothing')
})

test('post-fire rejection: a dispute-frozen funder is refused before the collection is read', async () => {
  const { api, reviewed, frozen, id } = await firedTeamCollection()
  frozen.add('anima-funder')

  await assert.rejects(() => api.rejectCollectionPiece(funder, id, HELD_PIECE), isForbidden)

  assert.deepEqual(reviewed.rejected, [], 'a frozen account dispatches no replacement piece')
})
