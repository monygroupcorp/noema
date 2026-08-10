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
// A coverage guard at the bottom reads `CrystalApi.ts` and fails when a new private
// ownership helper appears with neither a case here nor an allowlist entry, so adding
// an owner-scoped resource without a smoke case is a deliberate, visible act.
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
  const actorum = new MemoryActorum()
  const signorum = new MemorySignorum()
  const { calls, cursor } = recordingCursor()
  const api = new CrystalApi({
    provinciarum, sodalitatum, tabulae, collectiones, actorum, signorum,
    collectioCursor: cursor,
  } as unknown as CrystalApiDeps)
  return { api, provinciarum, sodalitatum, tabulae, collectiones, actorum, signorum, cursorCalls: calls }
}

// ── Assertion helpers ────────────────────────────────────────────────────────

/** bigints and Dates are not JSON-native; normalize both so a store can be snapshotted. */
function snapshot(store: Map<string, unknown>): string {
  return JSON.stringify([...store.entries()], (_k, v) =>
    typeof v === 'bigint' ? `${v}n` : v instanceof Date ? v.toISOString() : v)
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
// Same trick as tests/unit/architecture/testEnrolment.test.ts, pointed at CrystalApi:
// scan the source for private ownership helpers and require each to be either covered
// behaviourally above or allowlisted with a reason.

/** Helpers exercised by the by-id cases above, through their public methods. */
const COVERED = ['_ownedProject', '_ownedTabula', '_ownedCollection', '_memberTeam', '_owns']

/**
 * Deliberate exclusions. Each entry is a reason, not a TODO — adding one is the visible
 * act this guard exists to force.
 *
 * `_assertPlatformAdmin` does not match the declaration pattern below (it is not an
 * owner-scope helper at all); it is listed so the decision is recorded rather than implied.
 */
const UNCOVERED_ALLOWLIST: Record<string, string> = {
  _ownedStudio:
    'covered behaviourally by the studio-binding regression tests in ' +
    'tests/unit/allocutio/api/CrystalApi.test.ts (a studioId the caller does not host, and the ' +
    'fail-closed no-conductor case) — not duplicated here.',
  _ownedIntella:
    'no in-memory Intelligens store exists in src/ (only MongoIntella), so a case here needs a ' +
    'fake that does not yet exist. Wave 3.',
  _ownsCollection:
    'internal predicate of _ownedCollection, which the collection cases above cover through the ' +
    'public surface.',
  _ownsCollectionWith:
    'internal predicate of _ownedCollection, which the collection cases above cover through the ' +
    'public surface.',
  _assertPlatformAdmin:
    'a role gate, not owner scope — a two-identity smoke is the wrong shape for it.',
}

const HELPER_DECL = /private (?:async )?(_(?:owned|owns|member)[A-Za-z]*)\(/g

/** Every private ownership helper declared in the given source, deduped and sorted. */
function declaredHelpers(source: string): string[] {
  return [...new Set([...source.matchAll(HELPER_DECL)].map((m) => m[1]))].sort()
}

/** The helpers that are in neither list — i.e. the guard's failure set. */
function unlistedHelpers(source: string): string[] {
  return declaredHelpers(source).filter((h) => !COVERED.includes(h) && !(h in UNCOVERED_ALLOWLIST))
}

test('COVERAGE GUARD: every CrystalApi ownership helper is either smoked here or allowlisted', () => {
  const source = readFileSync(path.join(process.cwd(), 'src/allocutio/api/CrystalApi.ts'), 'utf8')
  const declared = declaredHelpers(source)
  assert.ok(declared.length > 0, 'the helper scan matched nothing — the declaration pattern has drifted')

  assert.deepEqual(
    unlistedHelpers(source), [],
    'A private ownership helper in CrystalApi.ts has no two-identity coverage. Either add a case to ' +
      'this suite driving the PUBLIC methods that route through it (identity B passing identity A\'s ' +
      'id, asserting an identical not_found to an absent id and no mutation), or add it to ' +
      'UNCOVERED_ALLOWLIST in this file with a reason explaining why a two-identity smoke is the wrong ' +
      'shape for it.',
  )

  // Every allowlist entry must still name a real helper — a stale entry silently shrinks
  // the guard's reach.
  for (const name of Object.keys(UNCOVERED_ALLOWLIST)) {
    if (name === '_assertPlatformAdmin') continue // documented above: outside the scan pattern by design
    assert.ok(declared.includes(name), `UNCOVERED_ALLOWLIST names '${name}', which no longer exists — remove it`)
  }
})

test('COVERAGE GUARD self-check: a new, unlisted helper is reported', () => {
  // The guard is only worth its runtime if it goes red on a helper nobody listed. Prove it
  // against fabricated source rather than trusting the real file to stay incomplete.
  const fabricated = '  private async _ownedSomethingNew(auctor: AuctorKey, id: string): Promise<void> {}'
  assert.deepEqual(unlistedHelpers(fabricated), ['_ownedSomethingNew'])
  assert.deepEqual(unlistedHelpers('  private async _ownedProject(auctor: AuctorKey, id: string) {}'), [])
})
