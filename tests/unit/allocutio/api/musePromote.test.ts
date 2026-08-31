// =============================================================================
// MUSE → COLLECTION — promotion is a mapping, not a second authoring surface
// =============================================================================
//
// A muse session is a collection played transiently: a floor of decomposed prompt
// fragments, a model stack, a standing affix and a flow. Promotion says so — the
// garden as the user left it becomes a DRAFT collection's trait grid, and the flow,
// the affix and the stacked trigger words become the base prompt that grid expands.
//
// What these tests pin, in the order a reader meets the feature:
//
//   1. the mapping, field by field, through the real API;
//   2. the request body reaches exactly one field, and nothing in it can name an
//      owner, a team or a grid (the ownership half is in
//      tests/unit/invariants/authz.invariants.test.ts, which drives two identities);
//   3. a fragment turned off on the cutting floor does not cross — darkening it IS
//      the curation;
//   4. a session that names no supply promotes anyway, and the EXISTING fire gate is
//      what refuses to dispatch it;
//   5. the model stack travels as trigger words, in stack order, and no trait option
//      is given a rarity — the default spread applies;
//   6. a name is derived from the mother when the body sends none;
//   7. the session is read and never written.
//
// Hermetic: in-memory stores + a recording cursor. No DB, no network.
// =============================================================================

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'

import { CrystalApi, type CrystalApiDeps } from '../../../../src/allocutio/api/CrystalApi.js'
import { promotionFrom, promotionNote, BASE_PROMPT_KEY } from '../../../../src/allocutio/api/musePromote.js'
import { ApiError } from '../../../../src/allocutio/api/errors.js'
import { setFragmentEnabled, spawnSession, withSetup, type MuseSession } from '../../../../src/crystal/muse/session.js'
import type { Fragment } from '../../../../src/crystal/muse/taxonomy.js'
import type { Collectio, Collectiones, Collectionum, CollectioStatus } from '../../../../src/types/collectio.js'
import type { Dataset } from '../../../../src/types/dataset.js'
import type { CreateMuseSessionInput, MuseSessions, StoredMuseSession } from '../../../../src/types/museSession.js'
import type { Modus } from '../../../../src/types/modus.js'
import type { AuctorKey } from '../../../../src/flow/types.js'

const ANIMA_ID = 'anima-1'
const auctor: AuctorKey = { animaId: ANIMA_ID }
const FLOW_ID = 'test-flow'
const MOTHER_ID = 'dataset-mother'
const MOTHER_NAME = 'a moodboard'

/** A floor spanning three categories, two of them with more than one option, so the
 *  grouping this maps through is observable rather than incidental. */
const FRAGMENTS: Fragment[] = [
  { category: 'outfit', text: 'a long grey coat', source: 'ref-1', trigger: 'trigword' },
  { category: 'setting', text: 'a wet street at night', source: 'ref-1', trigger: 'trigword' },
  { category: 'outfit', text: 'heavy boots', source: 'ref-2', trigger: 'trigword' },
  { category: 'style', text: 'ink wash', source: 'ref-2', trigger: 'trigword' },
]

function makeModus(id: string = FLOW_ID): Modus {
  return {
    id,
    nomen: id,
    genus: 'atomicus',
    versio: '1.0.0',
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
    async find(id: string) { return store.get(id) ?? null },
    async list(filter?: Partial<Pick<Collectio, 'status'>>): Promise<Collectiones> {
      const all = [...store.values()]
      return filter?.status ? all.filter((c) => c.status === filter.status) : all
    },
    async listByStatus(status: CollectioStatus) {
      return [...store.values()].filter((c) => c.status === status)
    },
    async create(input) {
      const c = {
        ...input, id: randomUUID(), natum: new Date(),
        acta: [], completae: 0, fractae: 0, pendentes: 0, reiectae: 0, impetusTotal: 0n,
      } as Collectio
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

function makeMuseSessions(): MuseSessions & { store: Map<string, StoredMuseSession> } {
  const store = new Map<string, StoredMuseSession>()
  return {
    store,
    async create(input: CreateMuseSessionInput) {
      const now = new Date()
      const full: StoredMuseSession = { id: randomUUID(), owner: input.owner, session: input.session, natum: now, mutatum: now }
      store.set(full.id, full)
      return full
    },
    async find(id: string) { return store.get(id) ?? null },
    async listByOwner(owner: string, motherDatasetId: string) {
      return [...store.values()].filter((s) => s.owner === owner && s.session.motherDatasetId === motherDatasetId)
    },
    async save(id: string, session: MuseSession) {
      const stored = store.get(id)
      if (!stored) return null
      const next: StoredMuseSession = { ...stored, session, mutatum: new Date() }
      store.set(id, next)
      return next
    },
  }
}

/** The mother the session was broken off, and the only dataset this suite needs. */
function motherDataset(): Dataset {
  return {
    id: MOTHER_ID,
    owner: ANIMA_ID,
    name: MOTHER_NAME,
    modality: 'image',
    custody: 'sealed',
    media: [],
    captionsets: [],
    versions: [],
    natum: new Date('2026-01-01T00:00:00Z'),
    mutatum: new Date('2026-01-01T00:00:00Z'),
  } as unknown as Dataset
}

/** A CrystalApi wired with only what promotion touches, plus a recording cursor. */
function makeApi() {
  const collectiones = makeCollectionum()
  const museSessions = makeMuseSessions()
  const datasets = new Map<string, Dataset>([[MOTHER_ID, motherDataset()]])
  const started: string[] = []
  const deps = {
    collectiones,
    museSessions,
    datasets: { async find(id: string) { return datasets.get(id) ?? null } },
    collectioCursor: { async start(c: Collectio) { started.push(c.id) } },
    modorum: { async find(id: string) { return id === FLOW_ID ? makeModus() : null } },
    animae: { async find() { return { id: ANIMA_ID } } },
  } as unknown as CrystalApiDeps
  return { api: new CrystalApi(deps), collectiones, museSessions, started }
}

/** A session with the full floor and a setup: a flow, a batched cap, a two-model stack
 *  and a standing affix — everything the mapping has to carry across. */
function seededSession(over: Record<string, unknown> = {}): MuseSession {
  return withSetup(spawnSession(MOTHER_ID, FRAGMENTS), {
    modusId: FLOW_ID,
    mode: 'batched',
    cap: 12,
    nozzle: [
      { intellaId: 'intella-a', nomen: 'first', trigger: 'trigword-a' },
      { intellaId: 'intella-b', nomen: 'second', trigger: 'trigword-b', weight: 0.6 },
    ],
    prefix: 'a portrait of',
    suffix: 'high detail',
    ...over,
  })
}

async function seed(over: Record<string, unknown> = {}) {
  const kit = makeApi()
  const stored = await kit.museSessions.create({ owner: ANIMA_ID, session: seededSession(over) })
  return { ...kit, stored }
}

// ── 1. The mapping, field by field ───────────────────────────────────────────

test('promote: a session becomes a DRAFT collection carrying its flow, supply, grid and base prompt', async () => {
  const { api, collectiones, started, stored } = await seed()

  const c = await api.promoteMuseSession(auctor, stored.id, { nomen: 'the set' })
  const row = collectiones.store.get(c.id)
  assert.ok(row, 'the promotion persisted a collection')

  assert.equal(c.status, 'draft', 'promotion mints a draft — the funnel finishes it')
  assert.deepEqual(started, [], 'a draft must NOT be dispatched — nothing is spent by promoting')
  assert.equal(c.nomen, 'the set')
  assert.equal(c.modusId, FLOW_ID, 'the flow travels — "it even includes the workflow"')
  assert.equal(c.total, 12, 'a batched cap becomes the supply')
  assert.deepEqual(row.by, { animaId: ANIMA_ID }, 'the funding identity is the caller, resolved by collect')
  assert.equal(row.descriptio, promotionNote(stored.id), 'the draft carries where it came from')

  // The grid: one axis per category still in the draw, in the order muse composes a
  // prompt in (style, then the figure, then the world) rather than in floor order.
  assert.deepEqual(
    (c.tractus ?? []).map((t) => t.porta), ['style', 'outfit', 'setting'],
    'one axis per category present, in template order — dropping the grouping collapses this',
  )
  assert.deepEqual(
    (c.tractus ?? []).map((t) => t.valores.map((v) => v.promptFragment)),
    [['ink wash'], ['a long grey coat', 'heavy boots'], ['a wet street at night']],
    'each surviving fragment is one option on its category\'s axis',
  )
  assert.deepEqual(
    (c.tractus ?? []).map((t) => t.valores.map((v) => v.value)),
    [['ink wash'], ['a long grey coat', 'heavy boots'], ['a wet street at night']],
    'and the fragment text is the aditus value spliced into the port, as the garden authors one',
  )
})

// ── 2. The body reaches one field ────────────────────────────────────────────

test('promote: nothing in the request body can name an owner, a team or a grid', async () => {
  const { api, collectiones, stored } = await seed()

  const c = await api.promoteMuseSession(auctor, stored.id, {
    nomen: 'the set',
    by: { animaId: 'someone-else' },
    owners: [{ animaId: 'someone-else', weight: 1 }],
    teamId: 'a-team-the-caller-is-not-in',
    tractus: [{ porta: 'smuggled', valores: [{ value: 'from the body' }] }],
    total: 9999,
    numerus: 9999,
    draft: false,
  } as unknown)

  const row = collectiones.store.get(c.id)!
  assert.deepEqual(row.by, { animaId: ANIMA_ID }, 'the funder is the authenticated caller, never the body')
  assert.equal(row.sodalitasId, undefined, 'a teamId in the body did not layer team ownership on')
  assert.equal(row.owners, undefined, 'and did not snapshot an ownership split')
  assert.equal(c.status, 'draft', 'a body cannot turn a promotion into an immediate spend')
  assert.equal(c.total, 12, 'the supply comes off the session, not the body')
  assert.ok(
    !(c.tractus ?? []).some((t) => t.porta === 'smuggled'),
    'a grid sent in the body reached the collection',
  )
})

// ── 3. The cutting floor is the curation ─────────────────────────────────────

test('promote: a fragment turned off on the cutting floor does not reach the grid', async () => {
  const kit = makeApi()
  // Darken one of the two outfit options and the only style option: the surviving grid
  // must lose the option, and lose the axis that has nothing left on it.
  let session = seededSession()
  session = setFragmentEnabled(session, FRAGMENTS[2], false)
  session = setFragmentEnabled(session, FRAGMENTS[3], false)
  const stored = await kit.museSessions.create({ owner: ANIMA_ID, session })

  const c = await kit.api.promoteMuseSession(auctor, stored.id, {})

  assert.deepEqual(
    (c.tractus ?? []).map((t) => t.porta), ['outfit', 'setting'],
    'a category whose every option was darkened is not an axis of variation',
  )
  assert.deepEqual(
    (c.tractus ?? []).flatMap((t) => t.valores.map((v) => v.promptFragment)),
    ['a long grey coat', 'a wet street at night'],
    'a darkened fragment crossed into the collection',
  )
})

// ── 4. A session that names no supply, and the gate that already exists ──────

test('promote: an infinite session promotes with no supply, and firing is what refuses it', async () => {
  const { api, stored, started } = await seed({ mode: 'infinite', cap: undefined })

  const c = await api.promoteMuseSession(auctor, stored.id, {})
  assert.equal(c.total, 0, 'an infinite sitting names no supply, so the draft is given none')
  assert.equal(c.modusId, FLOW_ID, 'the flow still travels')

  await assert.rejects(
    () => api.fireCollection(auctor, c.id),
    (e: unknown) => e instanceof ApiError && /supply/.test(e.message),
    'the existing fire gate is what asks for the supply a session could not give',
  )
  assert.deepEqual(started, [], 'and nothing dispatched on the way')
})

// ── 5. The model stack, and the rarity that is left alone ────────────────────

test('promote: the model stack travels as trigger words leading the base prompt, in stack order', async () => {
  const { api, collectiones, stored } = await seed()

  const c = await api.promoteMuseSession(auctor, stored.id, {})
  const base = collectiones.store.get(c.id)!.aditusBase as Record<string, unknown>

  assert.equal(
    base[BASE_PROMPT_KEY],
    'trigword-a, trigword-b:0.6, a portrait of, high detail',
    'the stack leads in the order it was stacked, then the standing prefix and suffix',
  )
})

test('promote: no trait option is given a rarity, so the default spread applies', async () => {
  const { api, stored } = await seed()

  const c = await api.promoteMuseSession(auctor, stored.id, {})
  const valores = (c.tractus ?? []).flatMap((t) => t.valores)
  assert.ok(valores.length > 0, 'there are options to check')
  for (const v of valores) {
    assert.equal(v.rarity, undefined, 'a floor weight is not a rarity table and must not be copied into one')
  }
})

// ── 6. The derived name ──────────────────────────────────────────────────────

test('promote: with no name in the body, one is derived from the mother and the session', async () => {
  const { api, stored } = await seed()

  const derived = await api.promoteMuseSession(auctor, stored.id)
  assert.equal(derived.nomen, `${MOTHER_NAME} · muse ${stored.id.slice(0, 8)}`)

  // A blank string is not a name: it falls back the same way an absent one does.
  const blank = await api.promoteMuseSession(auctor, stored.id, { nomen: '   ' })
  assert.equal(blank.nomen, derived.nomen)
})

// ── 7. The session survives the promotion ────────────────────────────────────

test('promote: the session is read and never written, so it can be promoted again', async () => {
  const { api, museSessions, stored } = await seed()

  const before = JSON.stringify([...museSessions.store.entries()], (_k, v) =>
    v instanceof Date ? v.toISOString() : v instanceof Map ? [...v.entries()] : v)

  const first = await api.promoteMuseSession(auctor, stored.id, {})
  const second = await api.promoteMuseSession(auctor, stored.id, {})

  assert.notEqual(first.id, second.id, 'a second promotion is a second collection')
  const after = JSON.stringify([...museSessions.store.entries()], (_k, v) =>
    v instanceof Date ? v.toISOString() : v instanceof Map ? [...v.entries()] : v)
  assert.equal(after, before, 'promotion wrote to the session — the sitting must survive it untouched')
})

// ── The mapping as a pure function ───────────────────────────────────────────
//
// The cases above drive the real API, which is the honest surface. These two assert the
// mapping directly, where the empty edges are cheap to state.

test('promotionFrom: a session with no setup maps to a grid with no base prompt, flow or supply', () => {
  const promotion = promotionFrom(spawnSession(MOTHER_ID, FRAGMENTS), { sessionId: 'session-1-and-more', nomen: 'bare' })

  assert.equal(promotion.modusId, undefined)
  assert.equal(promotion.total, undefined)
  assert.deepEqual(promotion.aditusBase, {}, 'no stack and no affix compose no standing prompt')
  assert.deepEqual(promotion.tractus.map((t) => t.porta), ['style', 'outfit', 'setting'])
  assert.equal(promotion.descriptio, 'promoted from muse session session-')
})

test('promotionFrom: an empty draw maps to an empty grid rather than a fabricated axis', () => {
  let session = spawnSession(MOTHER_ID, FRAGMENTS)
  for (const f of FRAGMENTS) session = setFragmentEnabled(session, f, false)

  assert.deepEqual(promotionFrom(session, { sessionId: 'session-1-and-more', nomen: 'bare' }).tractus, [])
})
