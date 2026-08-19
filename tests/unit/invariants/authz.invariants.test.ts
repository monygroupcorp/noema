// =============================================================================
// AUTHORIZATION INVARIANTS — two identities, one API
// =============================================================================
//
// Every other suite in this repo drives ONE identity, or drives a router against a
// faked facade. Neither shape can observe an ownership check that lives inside
// `CrystalApi`, which is where every real one lives. This suite constructs the REAL
// `CrystalApi` over in-memory stores, gives it two distinct identities, and asserts
// that identity B can neither read nor mutate identity A's resources — along both
// axes an owner-scoped surface can be widened:
//
//   BY ID     — B passes A's resource id as `:id`. The call must throw `not_found`,
//               must never return A's body, and must be INDISTINGUISHABLE from the
//               error for an id that does not exist (no existence leak). Mutating
//               methods must additionally leave A's record untouched.
//
//   BY FILTER — a caller passes a scope/visibility filter that would widen the result
//               set past their own rows. The data layer must clamp it to their scope.
//
// A failure in this file is a cross-tenant authorization regression, not a style nit.
// Treat a red here as a production-impacting defect and stop.
//
// A coverage guard at the bottom reads `CrystalApi.ts` and keys on the RESOURCE rather
// than on the name of the helper guarding it: every `not_found.<resource>` the facade can
// report must be either smoked here or allowlisted with a reason, so adding an
// owner-scoped resource without a smoke case is a deliberate, visible act however its
// helper is named. The resource token is the honest signal because reporting a stranger's
// resource as absent is the shape owner scoping takes on this surface — a helper can be
// called anything, but it cannot skip the 404, and a new code is also a new entry in the
// published error taxonomy (`apiContract.ts`), which the guard cross-checks.
// =============================================================================

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { CrystalApi, type CrystalApiDeps } from '../../../src/allocutio/api/CrystalApi.js'
import { ApiError } from '../../../src/allocutio/api/errors.js'
import { MemoryActorum } from '../../../src/execution/MemoryActorum.js'
import { MemorySignorum } from '../../../src/ledger/MemorySignorum.js'
import { MemoryVestigiorum } from '../../../src/rag/MemoryVestigiorum.js'
import type { Provincia, Provinciae, ProvinciaPatch, Provinciarum } from '../../../src/types/provincia.js'
import type { Sodalitas, Sodalitates, Sodalitatum } from '../../../src/types/sodalitas.js'
import type { Tabula, Tabulae, Tabularum } from '../../../src/types/tabula.js'
import type { Collectio, Collectiones, Collectionum, CollectioStatus } from '../../../src/types/collectio.js'
import type { Vestigium } from '../../../src/types/vestigium.js'
import type {
  Captionset, Dataset, DatasetListOpts, DatasetListPage, Datasets,
  DatasetSummaryListPage,
} from '../../../src/types/dataset.js'
import type {
  CreateMuseSessionInput, MuseSessions, StoredMuseSession,
} from '../../../src/types/museSession.js'
import type { MuseSession } from '../../../src/crystal/muse/session.js'
import type { Fragment } from '../../../src/crystal/muse/taxonomy.js'
import { captionCoverage } from '../../../src/types/dataset.js'
import { API_CONTRACT } from '../../../src/allocutio/api/apiContract.js'

// The two identities. A owns everything seeded; B owns nothing and may reach nothing.
const A = { animaId: 'anima-1' } as const
const B = { animaId: 'anima-2' } as const

/** An id that has never existed — the control every foreign-id error is compared against. */
const ABSENT = 'id-that-does-not-exist'

// ── In-memory stores (only the store surface CrystalApi touches) ──────────────

class MemProvinciarum implements Provinciarum {
  store = new Map<string, Provincia>()
  async find(id: string) { return this.store.get(id) ?? null }
  async create(input: Omit<Provincia, 'id' | 'natum' | 'mutatum'>) {
    const now = new Date()
    const full: Provincia = { ...input, id: randomUUID(), natum: now, mutatum: now }
    this.store.set(full.id, full)
    return full
  }
  async update(id: string, patch: ProvinciaPatch) {
    const p: Provincia = { ...this.store.get(id)!, mutatum: new Date() }
    for (const [k, v] of Object.entries(patch)) {
      if (v === undefined) delete (p as Record<string, unknown>)[k]
      else (p as Record<string, unknown>)[k] = v
    }
    this.store.set(id, p)
    return p
  }
  async remove(id: string) { this.store.delete(id) }
  async listByOwner(animaId: string): Promise<Provinciae> {
    return [...this.store.values()].filter((p) => p.animaId === animaId)
  }
}

class MemSodalitatum implements Sodalitatum {
  store = new Map<string, Sodalitas>()
  async find(id: string) { return this.store.get(id) ?? null }
  async create(s: Omit<Sodalitas, 'id' | 'natum'>) {
    const full: Sodalitas = { ...s, id: randomUUID(), natum: new Date() }
    this.store.set(full.id, full)
    return full
  }
  async update(id: string, patch: Partial<Pick<Sodalitas, 'membra' | 'nomen'>>) {
    const s = { ...this.store.get(id)!, ...patch }
    this.store.set(id, s)
    return s
  }
  async listByMember(animaId: string): Promise<Sodalitates> {
    return [...this.store.values()].filter((s) => s.membra.includes(animaId))
  }
}

class MemTabularum implements Tabularum {
  store = new Map<string, Tabula>()
  async find(id: string) { return this.store.get(id) ?? null }
  async list(filter: Partial<Pick<Tabula, 'auctor' | 'status' | 'visibilitas'>> = {}): Promise<Tabulae> {
    return [...this.store.values()].filter((t) => {
      if (filter.status && t.status !== filter.status) return false
      if (filter.visibilitas && t.visibilitas !== filter.visibilitas) return false
      if (filter.auctor) return ownerToken(t.auctor) === ownerToken(filter.auctor)
      return true
    })
  }
  async create(input: Omit<Tabula, 'id' | 'natum' | 'mutatum' | 'nodi' | 'vincula'>) {
    const now = new Date()
    const full: Tabula = { ...input, id: randomUUID(), nodi: [], vincula: [], natum: now, mutatum: now }
    this.store.set(full.id, full)
    return full
  }
  async update(id: string, patch: Partial<Tabula>) {
    const t: Tabula = { ...this.store.get(id)!, ...patch, mutatum: new Date() }
    this.store.set(id, t)
    return t
  }
  async remove(id: string) { this.store.delete(id) }
  async fork(): Promise<Tabula> { throw new Error('fork is not exercised by this suite') }
  async listDerived(): Promise<Tabulae> { return [] }
}

class MemCollectionum implements Collectionum {
  store = new Map<string, Collectio>()
  async find(id: string) { return this.store.get(id) ?? null }
  async list(filter: Partial<Pick<Collectio, 'status'>> = {}): Promise<Collectiones> {
    const all = [...this.store.values()]
    return filter.status ? all.filter((c) => c.status === filter.status) : all
  }
  async listByStatus(status: CollectioStatus): Promise<Collectiones> {
    return [...this.store.values()].filter((c) => c.status === status)
  }
  async create(input: Omit<Collectio, 'id' | 'natum' | 'acta' | 'completae' | 'fractae' | 'reiectae' | 'impetusTotal'>) {
    const full: Collectio = {
      ...input,
      id: randomUUID(),
      acta: [], completae: 0, fractae: 0, reiectae: 0, impetusTotal: 0n,
      natum: new Date(),
    }
    this.store.set(full.id, full)
    return full
  }
  async update(id: string, patch: Partial<Collectio>) {
    const c: Collectio = { ...this.store.get(id)!, ...patch }
    this.store.set(id, c)
    return c
  }
}

class MemDatasets implements Datasets {
  store = new Map<string, Dataset>()
  async find(id: string) { return this.store.get(id) ?? null }
  async create(input: Omit<Dataset, 'id' | 'natum' | 'mutatum'>): Promise<Dataset> {
    const now = new Date()
    const full: Dataset = { ...input, id: randomUUID(), natum: now, mutatum: now }
    this.store.set(full.id, full)
    return full
  }
  private _owned(owner: string): Dataset[] {
    return [...this.store.values()].filter((d) => d.owner === owner)
  }
  async list(opts: DatasetListOpts): Promise<DatasetListPage> {
    return { entries: this._owned(opts.owner) }
  }
  async listSummaries(opts: DatasetListOpts): Promise<DatasetSummaryListPage> {
    return { entries: this._owned(opts.owner).map((d) => ({ id: d.id, name: d.name, images: d.media.length })) }
  }
  async addCaptionset(datasetId: string, captionset: Captionset): Promise<Dataset | null> {
    const d = this.store.get(datasetId)
    if (!d) return null
    const captionsets = [...d.captionsets.filter((c) => c.id !== captionset.id), captionset]
    const next: Dataset = { ...d, captionsets, mutatum: new Date() }
    this.store.set(datasetId, next)
    return next
  }
  async setCaption(datasetId: string, captionsetId: string, mediaId: string, caption: string): Promise<Dataset | null> {
    const d = this.store.get(datasetId)
    const target = d?.captionsets.find((c) => c.id === captionsetId)
    if (!d || !target) return null
    const captions = { ...(target.captions ?? {}), [mediaId]: caption }
    const updated: Captionset = { ...target, captions, coverage: captionCoverage(captions, d.media.length) }
    const next: Dataset = {
      ...d,
      captionsets: d.captionsets.map((c) => (c.id === captionsetId ? updated : c)),
      mutatum: new Date(),
    }
    this.store.set(datasetId, next)
    return next
  }
  async setFragments(datasetId: string, mediaId: string, fragments: Fragment[]): Promise<Dataset | null> {
    const d = this.store.get(datasetId)
    if (!d || !d.media.some((m) => m.id === mediaId)) return null
    const next: Dataset = {
      ...d,
      media: d.media.map((m) => (m.id === mediaId ? { ...m, fragments } : m)),
      mutatum: new Date(),
    }
    this.store.set(datasetId, next)
    return next
  }
}

class MemMuseSessions implements MuseSessions {
  store = new Map<string, StoredMuseSession>()
  async create(input: CreateMuseSessionInput): Promise<StoredMuseSession> {
    const now = new Date()
    const full: StoredMuseSession = { id: randomUUID(), owner: input.owner, session: input.session, natum: now, mutatum: now }
    this.store.set(full.id, full)
    return full
  }
  async find(id: string) { return this.store.get(id) ?? null }
  async save(id: string, session: MuseSession): Promise<StoredMuseSession | null> {
    const stored = this.store.get(id)
    if (!stored) return null
    const next: StoredMuseSession = { ...stored, session, mutatum: new Date() }
    this.store.set(id, next)
    return next
  }
}

function ownerToken(k: { animaId: string } | { commitment: string }): string {
  return 'animaId' in k ? `animaId:${k.animaId}` : `commitment:${k.commitment}`
}

/**
 * A CollectioCursor double that records every side-effecting call. Several collection
 * methods mutate through the cursor rather than the store, so "unchanged" for those
 * means "the cursor was never reached".
 */
function recordingCursor() {
  const calls: string[] = []
  const rec = (name: string) => async (...args: unknown[]) => { calls.push(`${name}(${args.join(',')})`) }
  return {
    calls,
    cursor: {
      start: rec('start'), extend: rec('extend'), approveActum: rec('approveActum'),
      rejectAndRevive: rec('rejectAndRevive'), pause: rec('pause'), resume: rec('resume'),
    },
  }
}

function makeApi() {
  const provinciarum = new MemProvinciarum()
  const sodalitatum = new MemSodalitatum()
  const tabulae = new MemTabularum()
  const collectiones = new MemCollectionum()
  const datasets = new MemDatasets()
  const museSessions = new MemMuseSessions()
  const actorum = new MemoryActorum()
  const signorum = new MemorySignorum()
  const { calls, cursor } = recordingCursor()
  const api = new CrystalApi({
    provinciarum, sodalitatum, tabulae, collectiones, datasets, museSessions, actorum, signorum,
    collectioCursor: cursor,
  } as unknown as CrystalApiDeps)
  return {
    api, provinciarum, sodalitatum, tabulae, collectiones, datasets, museSessions,
    actorum, signorum, cursorCalls: calls,
  }
}

// ── Assertion helpers ────────────────────────────────────────────────────────

/**
 * bigints, Dates and Maps are not JSON-native; normalize all three so a store can be
 * snapshotted. A Map matters here rather than being defensive: a Muse session's floor IS
 * a Map, and `JSON.stringify` renders one as `{}` — a snapshot that skipped it would
 * compare equal no matter what a steer call did to the weights.
 */
function snapshot(store: Map<string, unknown>): string {
  return JSON.stringify([...store.entries()], (_k, v) =>
    typeof v === 'bigint' ? `${v}n` : v instanceof Date ? v.toISOString() : v instanceof Map ? [...v.entries()] : v)
}

/**
 * Run a call that must reject with an `ApiError`, and return its identifying shape with
 * the resource id blanked out — so a foreign-id rejection and an absent-id rejection are
 * directly comparable. Any difference between the two IS the existence leak.
 */
async function rejection(label: string, id: string, call: () => Promise<unknown>) {
  try {
    const out = await call()
    assert.fail(`${label}: expected a rejection, but the call resolved with ${JSON.stringify(out ?? null)}`)
  } catch (err) {
    assert.ok(err instanceof ApiError, `${label}: expected an ApiError, got ${String(err)}`)
    assert.ok(err.code.startsWith('not_found.'), `${label}: expected a not_found.* code, got '${err.code}'`)
    assert.equal(err.httpStatus, 404, `${label}: a foreign resource must read as 404`)
    return { code: err.code, httpStatus: err.httpStatus, message: err.message.split(id).join('<id>') }
  }
}

type Case = { name: string; call: (id: string) => Promise<unknown> }

/**
 * The core assertion. For every listed public method: B calls it with A's id and with an
 * id that never existed; both must reject identically. The caller supplies `snapshotNow`
 * so the resource's persisted state can be compared before and after the whole sweep.
 */
async function assertOwnerScoped(family: string, cases: Case[], snapshotNow: () => string) {
  const before = snapshotNow()
  for (const { name, call } of cases) {
    const foreign = await rejection(`${family}.${name} (foreign id)`, FOREIGN_ID.value, () => call(FOREIGN_ID.value))
    const absent = await rejection(`${family}.${name} (absent id)`, ABSENT, () => call(ABSENT))
    assert.deepEqual(
      foreign, absent,
      `${family}.${name}: a resource owned by another identity must be indistinguishable from one that ` +
        `does not exist — same code, same status, same message shape. Got ${JSON.stringify(foreign)} vs ` +
        `${JSON.stringify(absent)}.`,
    )
  }
  assert.equal(
    snapshotNow(), before,
    `${family}: a rejected cross-identity call must not have mutated the owner's record`,
  )
}

/** Set by each family before it calls `assertOwnerScoped` (keeps the Case list terse). */
const FOREIGN_ID = { value: '' }

// ── BY ID: Provincia (_ownedProject) ─────────────────────────────────────────

test('INVARIANT: identity B cannot read or mutate identity A\'s Provincia by id', async () => {
  const { api, provinciarum } = makeApi()
  const mine = await api.createProject(A, { name: 'A project', desc: 'owned by A' })
  FOREIGN_ID.value = mine.id

  await assertOwnerScoped('project', [
    { name: 'getProject', call: (id) => api.getProject(B, id) },
    { name: 'updateProject', call: (id) => api.updateProject(B, id, { name: 'renamed by B' }) },
    { name: 'deleteProject', call: (id) => api.deleteProject(B, id) },
    { name: 'fileAsset', call: (id) => api.fileAsset(B, id, 'model', 'intella-of-b') },
    { name: 'unfileAsset', call: (id) => api.unfileAsset(B, id, 'model', 'intella-of-b') },
  ], () => snapshot(provinciarum.store))

  // A's own read still works — without this the assertions above would also pass if the
  // whole project surface were simply broken.
  const stillThere = await api.getProject(A, mine.id)
  assert.equal(stillThere.name, 'A project')
  assert.deepEqual(stillThere.modelIds, [], 'B\'s fileAsset attempt left no trace in A\'s holdings')
})

// ── BY ID: Tabula (_ownedTabula) ─────────────────────────────────────────────

test('INVARIANT: identity B cannot read or mutate identity A\'s Tabula by id', async () => {
  const { api, tabulae } = makeApi()
  const mine = await api.createTabula(A, { nomen: 'A canvas' })
  FOREIGN_ID.value = mine.id

  await assertOwnerScoped('tabula', [
    { name: 'getTabula', call: (id) => api.getTabula(B, id) },
    { name: 'updateTabula', call: (id) => api.updateTabula(B, id, { nomen: 'renamed by B' }) },
    { name: 'deleteTabula', call: (id) => api.deleteTabula(B, id) },
    { name: 'publishTabula', call: (id) => api.publishTabula(B, id) },
  ], () => snapshot(tabulae.store))

  const stillThere = await api.getTabula(A, mine.id)
  assert.equal(stillThere.nomen, 'A canvas')
  assert.equal((await api.listTabulae(B)).length, 0, 'B\'s own list stays empty')
})

// ── BY ID: Collectio (_ownedCollection) ──────────────────────────────────────

test('INVARIANT: identity B cannot read or mutate identity A\'s Collectio by id', async () => {
  const { api, collectiones, cursorCalls } = makeApi()
  const mine = await collectiones.create({
    modusId: 'modus-1', aditusBase: {}, tractus: [], numerus: 4,
    provenanceHash: '', by: { animaId: A.animaId }, concurrentia: 1, status: 'draft',
  })
  FOREIGN_ID.value = mine.id

  await assertOwnerScoped('collection', [
    { name: 'getCollection', call: (id) => api.getCollection(B, id) },
    { name: 'getCollectionRarity', call: (id) => api.getCollectionRarity(B, id) },
    { name: 'listCollectionPieces', call: (id) => api.listCollectionPieces(B, id) },
    { name: 'patchCollectionDraft', call: (id) => api.patchCollectionDraft(B, id, { numerus: 99 }) },
    { name: 'patchCollectionTractus', call: (id) => api.patchCollectionTractus(B, id, []) },
    { name: 'fireCollection', call: (id) => api.fireCollection(B, id) },
    { name: 'extendCollection', call: (id) => api.extendCollection(B, id, 5) },
    { name: 'pauseCollection', call: (id) => api.pauseCollection(B, id) },
    { name: 'resumeCollection', call: (id) => api.resumeCollection(B, id) },
    { name: 'cancelCollection', call: (id) => api.cancelCollection(B, id) },
    { name: 'approveCollectionPiece', call: (id) => api.approveCollectionPiece(B, id, 'actum-1') },
    { name: 'rejectCollectionPiece', call: (id) => api.rejectCollectionPiece(B, id, 'actum-1') },
  ], () => snapshot(collectiones.store))

  // Several of those mutate through the cursor rather than the store — none may be reached.
  assert.deepEqual(cursorCalls, [], 'no dispatch/review side effect may fire for a foreign collection')
  assert.equal((await api.listCollections(B)).length, 0, 'B\'s own list stays empty')
  assert.equal((await api.listCollections(A)).length, 1, 'A still sees their own collection')
})

// ── BY ID: Sodalitas (_memberTeam) ───────────────────────────────────────────

test('INVARIANT: a non-member cannot read or mutate a Sodalitas by id', async () => {
  const { api, sodalitatum } = makeApi()
  const team = await api.createTeam(A, { nomen: 'A team' })
  FOREIGN_ID.value = team.id

  await assertOwnerScoped('team', [
    { name: 'getTeam', call: (id) => api.getTeam(B, id) },
    { name: 'addTeamMember', call: (id) => api.addTeamMember(B, id, B.animaId) },
    { name: 'removeTeamMember', call: (id) => api.removeTeamMember(B, id, A.animaId) },
  ], () => snapshot(sodalitatum.store))

  const stillMembers = (await api.getTeam(A, team.id)).members
  assert.deepEqual(stillMembers, [A.animaId], 'B neither joined nor evicted the founder')
  assert.equal((await api.listTeams(B)).length, 0, 'B\'s own list stays empty')

  // A project may only reference a team the caller belongs to — the same helper, reached
  // through a different public method.
  await assert.rejects(
    () => api.createProject(B, { name: 'B project on A\'s team', teamId: team.id }),
    (e: unknown) => e instanceof ApiError && e.code === 'not_found.team',
  )
})

// ── BY ID: Actum (_owns) ─────────────────────────────────────────────────────

test('INVARIANT: identity B cannot read identity A\'s Actum by id', async () => {
  const { api, actorum, signorum } = makeApi()
  const signum = await signorum.issue({ animaId: A.animaId, forma: 'minted', valor: 1000n, auctor: 'test' })
  const run = await actorum.create({
    id: 'actum-of-a', modusId: 'modus-1', modusVersiono: '1.0.0', impetus: 100n,
    signaConsumed: [signum.id], aditus: { prompt: 'a private prompt' },
    status: 'completus', expirat: new Date(Date.now() + 60_000),
  })
  FOREIGN_ID.value = run.id

  await assertOwnerScoped('run', [
    { name: 'getRun', call: (id) => api.getRun(B, id) },
  ], () => snapshot(actorum['store'] as Map<string, unknown>))

  const own = await api.getRun(A, run.id)
  assert.equal(own.id, run.id, 'A still reads their own run')
})

// ── BY ID: Dataset (owner resolved in getDataset) ────────────────────────────

/** Neutral, invented fragments — the floor a spawned session starts from. */
const FRAGMENTS: Fragment[] = [
  { category: 'subject', text: 'a lantern-keeper', source: 'board-a', trigger: 'trigword' },
  { category: 'lighting', text: 'dusk glow', source: 'board-a', trigger: 'trigword' },
]

const MEDIA_URL = 'https://example.invalid/media/one.png'

async function seedDataset(api: CrystalApi, datasets: MemDatasets): Promise<Dataset> {
  const d = await api.createDataset(A, {
    source: 'upload', name: 'A dataset', modality: 'image', mediaUrls: [MEDIA_URL],
  })
  // Fragments are written by the decompose run, which this suite does not drive; seed
  // them through the store so a session spawned off this dataset has a floor.
  await datasets.setFragments(d.id, d.media[0].id, FRAGMENTS)
  return (await api.getDataset(A, d.id))
}

test('INVARIANT: identity B cannot read or mutate identity A\'s Dataset by id', async () => {
  const { api, datasets } = makeApi()
  const mine = await seedDataset(api, datasets)
  const mediaId = mine.media[0].id
  await api.addCaptionset(A, mine.id, {
    id: 'pass-1', name: 'first pass', method: 'manual', captions: { [mediaId]: 'a caption' },
  })
  FOREIGN_ID.value = mine.id

  await assertOwnerScoped('dataset', [
    { name: 'getDataset', call: (id) => api.getDataset(B, id) },
    { name: 'addCaptionset', call: (id) => api.addCaptionset(B, id, { id: 'pass-b', name: 'B pass', method: 'manual' }) },
    { name: 'setCaption', call: (id) => api.setCaption(B, id, 'pass-1', mediaId, 'rewritten by B') },
    // The spawn reaches the dataset through the same resolution, so a stranger cannot
    // break a session off someone else's mother either.
    { name: 'spawnMuseSession', call: (id) => api.spawnMuseSession(B, id) },
  ], () => snapshot(datasets.store))

  const stillThere = await api.getDataset(A, mine.id)
  assert.equal(stillThere.captionsets.length, 1, 'B\'s captionset attempt left no trace')
  assert.equal(stillThere.captionsets[0].captions?.[mediaId], 'a caption', 'A\'s caption text is unchanged')
  assert.equal((await api.listDatasets(B)).datasets.length, 0, 'B\'s own list stays empty')
  assert.equal((await api.listDatasets(A)).datasets.length, 1, 'A still sees their own dataset')
})

// ── BY ID: Muse session (owner resolved in _museSession) ─────────────────────

test('INVARIANT: identity B cannot read or steer identity A\'s Muse session by id', async () => {
  const { api, datasets, museSessions } = makeApi()
  const mother = await seedDataset(api, datasets)
  const session = await api.spawnMuseSession(A, mother.id)
  assert.equal(session.floor.length, FRAGMENTS.length, 'the session spawned with the mother\'s floor')
  FOREIGN_ID.value = session.id

  const held = { category: FRAGMENTS[0].category, text: FRAGMENTS[0].text }
  await assertOwnerScoped('museSession', [
    { name: 'getMuseSession', call: (id) => api.getMuseSession(B, id) },
    { name: 'setMuseFragmentEnabled', call: (id) => api.setMuseFragmentEnabled(B, id, held, false) },
    { name: 'setMuseFragmentWeight', call: (id) => api.setMuseFragmentWeight(B, id, held, 4) },
    {
      name: 'recordMusePiece',
      call: (id) => api.recordMusePiece(B, id, { runId: 'run-of-b', rollIndex: 0, fragments: [held] }),
    },
  ], () => snapshot(museSessions.store))

  const own = await api.getMuseSession(A, session.id)
  assert.deepEqual(own.floor, session.floor, 'A\'s floor is exactly as it was spawned')
  assert.deepEqual(own.pieces, [], 'no piece from B reached A\'s ledger')
  assert.equal(own.motherDatasetId, mother.id, 'A still reads their own session')
})

// ── BY FILTER: vestigia search scope clamp ───────────────────────────────────
//
// The filter axis: a caller supplies `visibilitas` and (optionally) an `auctorKey`. The
// store must never let the requested visibility widen the row set beyond the caller's own
// scope. `tests/unit/api/vestigiaRouter.test.ts` covers the router half of this; here it is
// the data-layer clamp, the defense-in-depth layer, asserted directly against the store.

const SAME = [1, 0, 0, 0]

function seedVestigium(over: Partial<Vestigium> = {}) {
  return {
    modusId: 'modus-1',
    auctorKey: A,
    promptum: 'a portrait in soft light',
    summarium: 'a portrait',
    genus: 'image' as const,
    visibilitas: 'privata' as const,
    signacula: [],
    ...over,
  } as Parameters<MemoryVestigiorum['create']>[0]
}

async function seededVestigiorum() {
  const store = new MemoryVestigiorum(async () => SAME)
  const aPrivateOne = await store.create(seedVestigium())
  const aPrivateTwo = await store.create(seedVestigium({ promptum: 'a second private trace' }))
  const aPublic = await store.create(seedVestigium({ visibilitas: 'publica', promptum: 'a public trace' }))
  const bPrivate = await store.create(seedVestigium({ auctorKey: B, promptum: 'B\'s own private trace' }))
  for (const v of [aPrivateOne, aPrivateTwo, aPublic, bPrivate]) await store.indexPromptum(v.id)
  return { store, aPrivateIds: [aPrivateOne.id, aPrivateTwo.id], aPublicId: aPublic.id, bPrivateId: bPrivate.id }
}

test('INVARIANT: an UNSCOPED vestigia search cannot widen its scope past publica', async () => {
  const { store, aPrivateIds, aPublicId } = await seededVestigiorum()

  const widened = await store.search({ quaerendum: 'portrait', visibilitas: ['privata'] })
  const returned = widened.map((r) => r.vestigium.id)
  assert.deepEqual(
    returned.filter((id) => aPrivateIds.includes(id)), [],
    'an unscoped caller asking for privata must receive none of another identity\'s private rows',
  )
  assert.deepEqual(
    returned, [],
    'the requested visibility is intersected with publica, so an unscoped privata request selects nothing',
  )

  // Control: the same unscoped search WITHOUT a visibility filter still returns the public
  // row — the clamp narrows scope, it does not break search.
  const unfiltered = await store.search({ quaerendum: 'portrait' })
  assert.deepEqual(unfiltered.map((r) => r.vestigium.id), [aPublicId], 'an unscoped search sees publica rows')
})

test('INVARIANT: a vestigia search scoped to B never returns A\'s privata rows', async () => {
  const { store, aPrivateIds } = await seededVestigiorum()

  const results = await store.search({ quaerendum: 'portrait', auctorKey: B, visibilitas: ['privata'] })
  const returned = results.map((r) => r.vestigium.id)
  assert.deepEqual(
    returned.filter((id) => aPrivateIds.includes(id)), [],
    'a caller scoped to their own key must not receive another identity\'s private rows',
  )
  assert.ok(
    results.every((r) => ownerToken(r.vestigium.auctorKey) === ownerToken(B)),
    'every row returned to B belongs to B',
  )
})

test('CONTROL: A\'s own scoped search DOES return A\'s privata rows', async () => {
  // Without this control the two assertions above would still pass if search were simply
  // broken and returned nothing at all.
  const { store, aPrivateIds } = await seededVestigiorum()

  const results = await store.search({ quaerendum: 'portrait', auctorKey: A, visibilitas: ['privata'] })
  const returned = results.map((r) => r.vestigium.id).sort()
  assert.deepEqual(returned, [...aPrivateIds].sort(), 'A reads their own private traces')
})

// ── Coverage guard ───────────────────────────────────────────────────────────
//
// Same trick as tests/unit/architecture/testEnrolment.test.ts, pointed at CrystalApi —
// but keyed on the RESOURCE a check protects, not on the name of the helper doing the
// checking. A guard whose trigger is a helper-name prefix is satisfied by choosing a
// different prefix, which makes its green a statement about the naming convention rather
// than about coverage.
//
// The signal it keys on instead: an owner-scoped resource on this surface reports a
// stranger's record as ABSENT — `not_found.<resource>`, 404, indistinguishable from an id
// that never existed. That code is the resource's identity, it is declared once in the
// published taxonomy (`apiContract.ts`), and it cannot be renamed away without changing
// the wire contract. So the guard reads every `not_found.*` CrystalApi can report and
// requires each resource to be either smoked above or allowlisted with a reason.
//
// Three assertions, each catching a different way coverage can rot:
//   1. a resource nobody listed          — a new owner-scoped surface with no smoke case
//   2. a listed resource nobody reports  — a stale entry, silently shrinking the reach
//   3. a reported code off the contract  — a 404 the published error taxonomy omits

const API_SOURCE = path.join(process.cwd(), 'src/allocutio/api/CrystalApi.ts')
const ERRORS_SOURCE = path.join(process.cwd(), 'src/allocutio/api/errors.ts')

/**
 * The two ways CrystalApi.ts names a not-found code: the shared constructors in
 * `errors.ts` (`Errors.notFoundTeam(id)`) and a literal passed straight to `ApiError`
 * (`new ApiError('not_found.dataset', …)`). Both resolve to the same resource token.
 */
const ERRORS_DECL = /(notFound[A-Za-z]+):\s*\([^)]*\)\s*=>\s*new ApiError\('(not_found\.[a-z_]+)'/g
const ERRORS_CALL = /Errors\.(notFound[A-Za-z]+)\(/g
const CODE_LITERAL = /'(not_found\.[a-z_]+)'/g

/** `notFoundTeam` -> `not_found.team`, read off `errors.ts` rather than restated here. */
function codeByConstructor(errorsSource: string): Map<string, string> {
  return new Map([...errorsSource.matchAll(ERRORS_DECL)].map((m) => [m[1], m[2]]))
}

/** Every resource token the given source can report as not-found, deduped and sorted. */
function reportedResources(source: string, codes: Map<string, string>): string[] {
  const found = new Set<string>()
  for (const m of source.matchAll(CODE_LITERAL)) found.add(m[1])
  for (const m of source.matchAll(ERRORS_CALL)) {
    const code = codes.get(m[1])
    assert.ok(code, `CrystalApi.ts calls Errors.${m[1]}(), which errors.ts does not declare`)
    found.add(code as string)
  }
  return [...found].sort()
}

/**
 * Resources with a two-identity case in this file, mapped to the members that enforce the
 * scoping. The members are named so a rename is caught here rather than quietly detaching
 * a case from the code it covers — the guard asserts each still exists in the source.
 */
const COVERED_RESOURCES: Record<string, string[]> = {
  'not_found.collection': ['_ownedCollection', '_ownsCollection'],
  'not_found.dataset': ['_datasetOwner', 'getDataset'],
  'not_found.muse_session': ['_museSessionOwner', '_museSession'],
  'not_found.project': ['_ownedProject'],
  'not_found.run': ['_owns'],
  'not_found.tabula': ['_ownedTabula'],
  'not_found.team': ['_memberTeam'],
}

/**
 * Deliberate exclusions. Each entry is a reason, not a TODO — adding one is the visible
 * act this guard exists to force.
 */
const UNCOVERED_ALLOWLIST: Record<string, string> = {
  'not_found.studio':
    'covered behaviourally by the studio-binding regression tests in ' +
    'tests/unit/allocutio/api/CrystalApi.test.ts (a studioId the caller does not host, and the ' +
    'fail-closed no-conductor case) — not duplicated here.',
  'not_found.edition':
    'author-scoped, and covered behaviourally by the publication tests in ' +
    'tests/unit/crystal/publish.test.ts (only the publishing author may read or retract, and the ' +
    'review queue shows an author only their own held items) — not duplicated here.',
  'not_found.model':
    'the model registry is owner-scoped through `_ownedIntella`, and no in-memory Intelligens ' +
    'store exists in src/ (only MongoIntella), so a case here needs a fake that does not yet ' +
    'exist. The remaining model 404s are registry/admin paths, not owner scope. Wave 3.',
  'not_found.flow':
    'the flow catalog is a global registry, not an owner-scoped resource — a two-identity smoke ' +
    'is the wrong shape for it.',
  'not_found.fundamentum':
    'a base-model record in the shared catalog, not an owner-scoped resource.',
  'not_found.adapter':
    'a publication destination that is not wired, not a record with an owner.',
}

/** The resources that are in neither list — i.e. the guard's failure set. */
function unlistedResources(source: string, codes: Map<string, string>): string[] {
  return reportedResources(source, codes)
    .filter((r) => !(r in COVERED_RESOURCES) && !(r in UNCOVERED_ALLOWLIST))
}

test('COVERAGE GUARD: every owner-scoped CrystalApi resource is either smoked here or allowlisted', () => {
  const source = readFileSync(API_SOURCE, 'utf8')
  const codes = codeByConstructor(readFileSync(ERRORS_SOURCE, 'utf8'))
  assert.ok(codes.size > 0, 'the errors.ts scan matched nothing — the constructor pattern has drifted')

  const reported = reportedResources(source, codes)
  assert.ok(reported.length > 0, 'the not-found scan matched nothing — the code pattern has drifted')

  assert.deepEqual(
    unlistedResources(source, codes), [],
    'A resource CrystalApi.ts can report as not-found has no two-identity coverage. If it is ' +
      'owner-scoped, add a case to this suite driving the PUBLIC methods that resolve it (identity ' +
      'B passing identity A\'s id, asserting an identical not_found to an absent id and no ' +
      'mutation) and list it in COVERED_RESOURCES. If it is not owner-scoped, add it to ' +
      'UNCOVERED_ALLOWLIST in this file with a reason. Renaming the helper does not remove the ' +
      'obligation — the guard keys on the resource.',
  )
})

test('COVERAGE GUARD: no listed resource has gone stale', () => {
  const source = readFileSync(API_SOURCE, 'utf8')
  const codes = codeByConstructor(readFileSync(ERRORS_SOURCE, 'utf8'))
  const reported = new Set(reportedResources(source, codes))

  for (const resource of [...Object.keys(COVERED_RESOURCES), ...Object.keys(UNCOVERED_ALLOWLIST)]) {
    assert.ok(
      reported.has(resource),
      `'${resource}' is listed here but CrystalApi.ts no longer reports it — remove the entry`,
    )
  }

  // A covered resource names the members that enforce its scoping; if one is gone, the
  // case above may no longer be reaching an ownership check at all.
  for (const [resource, members] of Object.entries(COVERED_RESOURCES)) {
    for (const member of members) {
      assert.ok(
        new RegExp(`\\b${member}\\s*\\(`).test(source),
        `COVERED_RESOURCES lists '${member}' for ${resource}, which CrystalApi.ts no longer declares ` +
          '— re-point the entry at the member that enforces the scoping now',
      )
    }
  }
})

test('COVERAGE GUARD: every reported not-found code is declared in the API contract', () => {
  const source = readFileSync(API_SOURCE, 'utf8')
  const codes = codeByConstructor(readFileSync(ERRORS_SOURCE, 'utf8'))
  const declared = new Set(API_CONTRACT.errorCodes.map((e) => e.code))

  for (const resource of reportedResources(source, codes)) {
    assert.ok(
      declared.has(resource),
      `CrystalApi.ts can report '${resource}' but apiContract.ts's errorCodes does not declare it — ` +
        'a client reading the published taxonomy would meet a 404 code that does not exist there. ' +
        'Add it to errorCodes and regenerate the docs (npm run gen:api-docs).',
    )
  }
})

test('COVERAGE GUARD self-check: a new, unlisted resource is reported', () => {
  // The guard is only worth its runtime if it goes red on a resource nobody listed. Prove
  // it against fabricated source rather than trusting the real file to stay incomplete.
  const codes = new Map([['notFoundSomethingNew', 'not_found.something_new']])

  assert.deepEqual(
    unlistedResources("    throw new ApiError('not_found.something_new', 'nope', 404)", codes),
    ['not_found.something_new'],
    'a literal code nobody listed must be reported',
  )
  assert.deepEqual(
    unlistedResources('    throw Errors.notFoundSomethingNew(id)', codes),
    ['not_found.something_new'],
    'the same code reached through an errors.ts constructor must be reported too',
  )
  // And it must stay quiet on a listed one, however the helper guarding it is named.
  assert.deepEqual(
    unlistedResources("    private async _whateverIWantToCallIt() { throw new ApiError('not_found.dataset', '', 404) }", codes),
    [],
  )
})
