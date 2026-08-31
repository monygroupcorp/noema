// =============================================================================
// noema-304 — declared owned-resource references are resolved for the CALLER
// =============================================================================
//
// A modus declares which of its aditus ports name a stored, owner-bearing record
// (`Porta.owned`), and `invokeFlow` resolves every declared reference against the calling
// anima BEFORE a run exists. These tests pin both halves:
//
//   the class     — a modus that is not a canon seed, carrying a declared reference on an
//                   arbitrarily named port, is refused for a foreign id by the declaration
//                   machinery alone. Nothing here knows the port is called `board`.
//   the live modi — the three that take a dataset/corpus reference today: a foreign id is
//                   refused and nothing is dispatched; an owned id runs exactly as before.
//
// REACHED-DISPATCH SENTINEL: the refusal lands above `dispatchInceptio`, whose first real act
// is `inceptor.initiate`. The inceptor double therefore records the inceptio and throws a
// sentinel, so "refused" and "ran unchanged" are two distinguishable outcomes without
// standing up a cursor, a ledger or a store. A test that asserts a refusal also asserts the
// inceptor was never called — a refusal that still reserved would pass the first assertion
// and fail the second.
// =============================================================================

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { CrystalApi, type CrystalApiDeps } from '../../../../src/allocutio/api/CrystalApi.js'
import { ApiError } from '../../../../src/allocutio/api/errors.js'
import { CANONICAL_MODI } from '../../../../src/crystal/seeds/modi.js'
import { hashModus } from '../../../../src/crystal/hashModus.js'
import type { Modus } from '../../../../src/types/modus.js'
import type { Inceptio } from '../../../../src/types/cursus.js'
import type { Corpus, Corpora, Corporum } from '../../../../src/types/corpus.js'
import type { Dataset, Datasets } from '../../../../src/types/dataset.js'
import type { Sodalitas, Sodalitates, Sodalitatum } from '../../../../src/types/sodalitas.js'
import type { AuctorKey } from '../../../../src/flow/types.js'

const MINE: AuctorKey = { animaId: 'anima-mine' }
const OTHER_OWNER = 'anima-other'
/** A caller in no team at all — the non-member the widened dataset gate must still refuse. */
const STRANGER: AuctorKey = { animaId: 'anima-stranger' }
/** An anonymous caller. Datasets and corpora both key their owner on an animaId. */
const ANON: AuctorKey = { commitment: '0xcommitment' }

const REACHED_DISPATCH = 'reached-dispatch'

// ── Doubles ─────────────────────────────────────────────────────────────────

function dataset(over: Partial<Dataset> & { id: string; owner: string }): Dataset {
  return {
    name: 'a set', modality: 'image', custody: 'remote',
    media: [], captionsets: [], versions: [],
    natum: new Date(0), mutatum: new Date(0),
    ...over,
  } as Dataset
}

function corpus(over: Partial<Corpus> & { id: string; auctor: string }): Corpus {
  return {
    nomen: 'a corpus', genus: 'imagines', exemplaria: [], numerus: 0, status: 'validatus',
    natum: new Date(0), mutatum: new Date(0),
    ...over,
  } as Corpus
}

/** A `Datasets` double that records what the run entry point asked it to resolve. */
type RecordingDatasets = Datasets & { lookups: string[] }

/** `findOwned` only — the one seam the run entry point uses. Mirrors the Mongo store's
 *  query predicate: the owner, a dataset shared with one of the CALLER's teams, or a record
 *  whose access kind is public. `lookups` records every id it was asked for, so a test can
 *  assert that a run already dispatched is never resolved a second time. */
function datasetStore(records: Dataset[]): RecordingDatasets {
  const lookups: string[] = []
  return {
    lookups,
    async findOwned(id: string, owner: string, sodalitasIds?: string[]) {
      lookups.push(id)
      const d = records.find(r => r.id === id)
      if (!d) return null
      const access = (d as Dataset & { access?: unknown }).access
      const isPublic = access === 'public'
        || (typeof access === 'object' && access !== null && (access as { kind?: string }).kind === 'public')
      const shared = d.sodalitasId !== undefined && (sodalitasIds ?? []).includes(d.sodalitasId)
      return d.owner === owner || shared || isPublic ? d : null
    },
  } as unknown as RecordingDatasets
}

/** The team primitive, unchanged — flat mutable membership, exactly `src/types/sodalitas.ts`.
 *  Nothing here is dataset-aware: the overlay is `Collectio`'s reused, so the team store cannot
 *  be the place a dataset test passes on a special case. */
class MemorySodalitatum implements Sodalitatum {
  constructor(private teams: Sodalitas[]) {}
  async find(id: string): Promise<Sodalitas | null> { return this.teams.find(t => t.id === id) ?? null }
  async listByMember(animaId: string): Promise<Sodalitates> {
    return this.teams.filter(t => t.membra.includes(animaId))
  }
  async create(): Promise<Sodalitas> { throw new Error('not used') }
  async update(id: string, patch: Partial<Pick<Sodalitas, 'membra' | 'nomen'>>): Promise<Sodalitas> {
    const i = this.teams.findIndex(t => t.id === id)
    assert.ok(i >= 0, `team ${id} exists`)
    const next = { ...this.teams[i]!, ...patch }
    this.teams[i] = next
    return next
  }
}

function team(id: string, membra: string[]): Sodalitas {
  return { id, nomen: `team ${id}`, membra, auctor: membra[0] ?? OTHER_OWNER, natum: new Date(0) }
}

function corpusStore(records: Corpus[]): Corporum {
  return {
    async find(id: string) { return records.find(r => r.id === id) ?? null },
    async findOwned(id: string, auctor: string) {
      const c = records.find(r => r.id === id)
      return c && c.auctor === auctor ? c : null
    },
    async list() { return [] as Corpora },
    async create() { throw new Error('not used') },
    async update() { throw new Error('not used') },
  }
}

interface Harness {
  api: CrystalApi
  /** The inceptio dispatch was reached with, or undefined when the run was refused. */
  dispatched: () => Inceptio | undefined
}

function harness(
  modi: Modus[],
  stores: { datasets?: Datasets; corpora?: Corporum; sodalitatum?: Sodalitatum } = {},
): Harness {
  let seen: Inceptio | undefined
  const deps = {
    modorum: { async find(id: string) { return modi.find(m => m.id === id) ?? null } },
    inceptor: {
      async initiate(inceptio: Inceptio) {
        seen = inceptio
        throw new Error(REACHED_DISPATCH)
      },
    },
    cursorum: { resolve() { throw new Error('cursor must not resolve on a refused run') } },
    completor: {},
    ...stores,
  }
  return { api: new CrystalApi(deps as unknown as CrystalApiDeps), dispatched: () => seen }
}

/** Assert the run was refused as bad input, naming `field`, with nothing dispatched. */
async function assertRefused(
  h: Harness, modusId: string, aditus: Record<string, unknown>, field: string, auctor: AuctorKey = MINE,
): Promise<void> {
  await assert.rejects(
    () => h.api.invokeFlow(auctor, { modusId }, aditus),
    (err: unknown) => {
      assert.ok(err instanceof ApiError, 'refused as a request error, not a 500')
      assert.equal(err.code, 'input.invalid_aditus')
      assert.equal(err.httpStatus, 422)
      assert.equal((err.toBody().details as { field?: string } | undefined)?.field, field)
      return true
    },
  )
  assert.equal(h.dispatched(), undefined, 'nothing was dispatched: no actum, no reservation, no pod')
}

/** Assert the run passed the check and reached dispatch unchanged. */
async function assertReachedDispatch(
  h: Harness, modusId: string, aditus: Record<string, unknown>, auctor: AuctorKey = MINE,
): Promise<Inceptio> {
  await assert.rejects(
    () => h.api.invokeFlow(auctor, { modusId }, aditus),
    (err: unknown) => err instanceof Error && err.message === REACHED_DISPATCH,
  )
  const inceptio = h.dispatched()
  assert.ok(inceptio, 'dispatch was reached')
  return inceptio
}

const modus = (id: string): Modus => {
  const found = CANONICAL_MODI.find(m => m.id === id)
  assert.ok(found, `seed ${id} is present`)
  return found
}

// ── The class: the declaration machinery alone, on a modus that is not a seed ──

const TEST_MODUS: Modus = (() => {
  const def: Omit<Modus, 'contentHash'> = {
    id: 'modus.test-owned-declaration',
    nomen: 'A modus with a declared reference on an arbitrary port',
    genus: 'atomicus',
    versio: '1.0.0',
    ministerium: 'test',
    canonica: false,
    aditus: {
      // Not a reserved resource name: the check has to be driven by the declaration.
      board: { type: 'text', required: true, owned: { genus: 'dataset' } },
      note: { type: 'text', required: false },
    },
    exitus: {},
    natum: new Date(0),
    mutatum: new Date(0),
  }
  return { ...def, contentHash: hashModus({ ...def, contentHash: '' }) }
})()

const THEIRS = dataset({ id: 'ds-theirs', owner: OTHER_OWNER })
const OURS = dataset({ id: 'ds-ours', owner: 'anima-mine' })

test('class: a declared reference to a foreign record is refused by the declaration alone', async () => {
  const h = harness([TEST_MODUS], { datasets: datasetStore([THEIRS, OURS]) })
  await assertRefused(h, TEST_MODUS.id, { board: THEIRS.id, note: 'hello' }, 'board')
})

test('class: the caller\'s own record on the same port runs unchanged', async () => {
  const h = harness([TEST_MODUS], { datasets: datasetStore([THEIRS, OURS]) })
  const inceptio = await assertReachedDispatch(h, TEST_MODUS.id, { board: OURS.id, note: 'hello' })
  assert.deepEqual(inceptio.aditus, { board: OURS.id, note: 'hello' }, 'the aditus reaches dispatch untouched')
})

test('class: an undeclared port carrying an id is not the check\'s business', async () => {
  const noDeclaration: Modus = { ...TEST_MODUS, id: 'modus.test-undeclared', aditus: { board: { type: 'text' } } }
  const h = harness([noDeclaration], { datasets: datasetStore([THEIRS, OURS]) })
  await assertReachedDispatch(h, noDeclaration.id, { board: THEIRS.id })
})

test('class: internal underscore-prefixed keys ride through a checked aditus untouched', async () => {
  const h = harness([TEST_MODUS], { datasets: datasetStore([OURS]) })
  const inceptio = await assertReachedDispatch(h, TEST_MODUS.id, { board: OURS.id, _attributes: { rarity: 'gold' } })
  assert.deepEqual(
    inceptio.aditus._attributes, { rarity: 'gold' },
    'the internal channel a child run rides is neither stripped nor refused',
  )
})

test('class: a record whose access kind is public may be named by anyone', async () => {
  const open = { ...dataset({ id: 'ds-open', owner: OTHER_OWNER }), access: { kind: 'public' } } as Dataset
  const h = harness([TEST_MODUS], { datasets: datasetStore([open]) })
  await assertReachedDispatch(h, TEST_MODUS.id, { board: open.id })
})

test('class: with no store wired the reference is refused, not admitted', async () => {
  const h = harness([TEST_MODUS])
  await assertRefused(h, TEST_MODUS.id, { board: OURS.id }, 'board')
})

test('class: an anonymous caller cannot name an owner-keyed record', async () => {
  const h = harness([TEST_MODUS], { datasets: datasetStore([OURS]) })
  await assert.rejects(
    () => h.api.invokeFlow(ANON, { modusId: TEST_MODUS.id }, { board: OURS.id }),
    (err: unknown) => err instanceof ApiError && err.code === 'input.invalid_aditus',
  )
  assert.equal(h.dispatched(), undefined, 'nothing was dispatched')
})

test('class: a non-string value on a declared reference port is refused', async () => {
  const h = harness([TEST_MODUS], { datasets: datasetStore([OURS]) })
  await assertRefused(h, TEST_MODUS.id, { board: { id: OURS.id } }, 'board')
})

// ── The live modi ───────────────────────────────────────────────────────────

const CAPTION = 'modus.dataset-caption'
const DECOMPOSE = 'modus.dataset-decompose'
const TRAINING = 'modus.aitoolkit-training'

const THEIR_CAPTIONED = dataset({
  id: 'ds-theirs-captioned', owner: OTHER_OWNER,
  captionsets: [{ id: 'cs-theirs', name: 'theirs', method: 'manual', coverage: '1/1' }],
})
const OUR_CAPTIONED = dataset({
  id: 'ds-ours-captioned', owner: 'anima-mine',
  captionsets: [{ id: 'cs-ours', name: 'ours', method: 'manual', coverage: '1/1' }],
})

function liveHarness(): Harness {
  return harness(
    [modus(CAPTION), modus(DECOMPOSE), modus(TRAINING)],
    {
      datasets: datasetStore([THEIR_CAPTIONED, OUR_CAPTIONED]),
      corpora: corpusStore([
        corpus({ id: 'corpus-theirs', auctor: OTHER_OWNER }),
        corpus({ id: 'corpus-ours', auctor: 'anima-mine' }),
      ]),
    },
  )
}

test('caption: a foreign dataset id is refused and nothing is dispatched', async () => {
  await assertRefused(liveHarness(), CAPTION, { dataset: THEIR_CAPTIONED.id }, 'dataset')
})

test('caption: the caller\'s own dataset runs unchanged', async () => {
  const inceptio = await assertReachedDispatch(liveHarness(), CAPTION, { dataset: OUR_CAPTIONED.id })
  assert.equal(inceptio.aditus.dataset, OUR_CAPTIONED.id)
})

test('caption: a captionset that is not on the named dataset is refused', async () => {
  await assertRefused(
    liveHarness(), CAPTION,
    { dataset: OUR_CAPTIONED.id, captionset: 'cs-theirs' },
    'captionset',
  )
})

test('caption: a captionset that IS on the caller\'s dataset runs unchanged', async () => {
  const inceptio = await assertReachedDispatch(
    liveHarness(), CAPTION, { dataset: OUR_CAPTIONED.id, captionset: 'cs-ours' },
  )
  assert.equal(inceptio.aditus.captionset, 'cs-ours')
})

test('decompose: a foreign dataset id is refused and nothing is dispatched', async () => {
  await assertRefused(
    liveHarness(), DECOMPOSE,
    { dataset: THEIR_CAPTIONED.id, captionset: 'cs-theirs' },
    'dataset',
  )
})

test('decompose: the caller\'s own dataset + its own captionset runs unchanged', async () => {
  const inceptio = await assertReachedDispatch(
    liveHarness(), DECOMPOSE, { dataset: OUR_CAPTIONED.id, captionset: 'cs-ours' },
  )
  assert.equal(inceptio.aditus.dataset, OUR_CAPTIONED.id)
})

test('training: a foreign corpus id is refused, so no manifest is resolved and no pod is launched', async () => {
  await assertRefused(
    liveHarness(), TRAINING,
    { dataset: 'corpus-theirs', triggerWord: 'trigword', baseModel: 'klein-4b', steps: 10 },
    'dataset',
  )
})

test('training: the caller\'s own corpus runs unchanged', async () => {
  const inceptio = await assertReachedDispatch(
    liveHarness(), TRAINING,
    { dataset: 'corpus-ours', triggerWord: 'trigword', baseModel: 'klein-4b', steps: 10 },
  )
  assert.equal(inceptio.aditus.dataset, 'corpus-ours')
})

test('training: an INLINE manifest names no stored record and passes through', async () => {
  const manifest = JSON.stringify([{ url: 'https://example.invalid/one.png', caption: 'a caption' }])
  const inceptio = await assertReachedDispatch(
    liveHarness(), TRAINING,
    { dataset: manifest, triggerWord: 'trigword', baseModel: 'klein-4b', steps: 10 },
  )
  assert.equal(inceptio.aditus.dataset, manifest)
})

test('training: an inline manifest still passes with no corpus store wired', async () => {
  const manifest = JSON.stringify([{ url: 'https://example.invalid/one.png' }])
  const h = harness([modus(TRAINING)])
  await assertReachedDispatch(
    h, TRAINING, { dataset: manifest, triggerWord: 'trigword', baseModel: 'klein-4b', steps: 10 },
  )
})

// ── noema-384: the team overlay on a run's DATASET reference ────────────────
//
// ADR-0014 question 2, ruled by rth 2026-08-31: a member may name a dataset shared with their
// team as a run's input. The gate is still `_assertOwnedAditus` at DISPATCH, closed over the
// dispatching caller — these tests pin that it widened exactly that far and no further.
//
// WHY THESE STAY IN THIS FILE: what widened is the declaration machinery's dataset lookup, not
// a dataset route. A second file would be a second place to decide what "may name" means.

const TEAM_ID = 'team-fellowship'
/** Owned by a team-mate, shared with the team the member belongs to. */
const SHARED = dataset({ id: 'ds-shared', owner: OTHER_OWNER, sodalitasId: TEAM_ID })
/** Owned by the same team-mate, shared with nobody — the overlay is per dataset, not per person. */
const UNSHARED = dataset({ id: 'ds-unshared', owner: OTHER_OWNER })
/** Shared with a team the caller is NOT in. */
const OTHER_TEAM = dataset({ id: 'ds-other-team', owner: OTHER_OWNER, sodalitasId: 'team-elsewhere' })

/** The member's world: they are in `TEAM_ID`, the owner is too, the stranger is in nothing. */
function teamHarness(): Harness & { datasets: RecordingDatasets } {
  const datasets = datasetStore([SHARED, UNSHARED, OTHER_TEAM, OURS])
  const sodalitatum = new MemorySodalitatum([
    team(TEAM_ID, [OTHER_OWNER, 'anima-mine']),
    team('team-elsewhere', [OTHER_OWNER]),
  ])
  return { ...harness([TEST_MODUS], { datasets, sodalitatum }), datasets }
}

test('team: a dataset shared with a team the caller belongs to resolves and dispatches', async () => {
  const h = teamHarness()
  const inceptio = await assertReachedDispatch(h, TEST_MODUS.id, { board: SHARED.id, note: 'hello' })
  assert.deepEqual(inceptio.aditus, { board: SHARED.id, note: 'hello' }, 'the aditus reaches dispatch untouched')
})

test('team: no team identity travels with the Actum — the gate is dispatch time, not run time', async () => {
  const h = teamHarness()
  const inceptio = await assertReachedDispatch(h, TEST_MODUS.id, { board: SHARED.id })
  const wire = JSON.stringify(inceptio)
  assert.ok(!wire.includes(TEAM_ID), 'the team id is not attached to the inceptio')
  assert.ok(!wire.toLowerCase().includes('sodalit'), 'nothing team-shaped is threaded through execution')
})

test('team: a non-member is refused, with the refusal an unshared dataset already gives', async () => {
  await assertRefused(teamHarness(), TEST_MODUS.id, { board: SHARED.id }, 'board', STRANGER)
  // Same code, same status, same field as an id that names nothing: a caller still cannot tell
  // "not yours" from "does not exist", so ids stay non-enumerable.
  await assertRefused(teamHarness(), TEST_MODUS.id, { board: 'ds-no-such-thing' }, 'board', STRANGER)
})

test('team: a team-mate\'s UNSHARED dataset stays owner-only', async () => {
  await assertRefused(teamHarness(), TEST_MODUS.id, { board: UNSHARED.id }, 'board')
})

test('team: a dataset shared with a team the caller is not in is refused', async () => {
  await assertRefused(teamHarness(), TEST_MODUS.id, { board: OTHER_TEAM.id }, 'board')
})

test('team: fail closed — with no team store wired a shared dataset is owner-only', async () => {
  await assertRefused(
    harness([TEST_MODUS], { datasets: datasetStore([SHARED, OURS]) }),
    TEST_MODUS.id, { board: SHARED.id }, 'board',
  )
  // ...and the caller's own dataset still resolves, so the absence closed nothing it should not.
  await assertReachedDispatch(
    harness([TEST_MODUS], { datasets: datasetStore([SHARED, OURS]) }), TEST_MODUS.id, { board: OURS.id },
  )
})

test('team: fail closed — an anonymous caller resolves no shared dataset either', async () => {
  const h = teamHarness()
  await assert.rejects(
    () => h.api.invokeFlow(ANON, { modusId: TEST_MODUS.id }, { board: SHARED.id }),
    (err: unknown) => err instanceof ApiError && err.code === 'input.invalid_aditus',
  )
  assert.equal(h.dispatched(), undefined, 'nothing was dispatched')
})

test('team: losing membership closes NEW dispatch; the run already dispatched is untouched', async () => {
  const datasets = datasetStore([SHARED])
  const teams = new MemorySodalitatum([team(TEAM_ID, [OTHER_OWNER, 'anima-mine'])])
  const h = harness([TEST_MODUS], { datasets, sodalitatum: teams })

  const dispatched = await assertReachedDispatch(h, TEST_MODUS.id, { board: SHARED.id })
  const before = JSON.stringify(dispatched)
  const lookupsAtDispatch = datasets.lookups.length

  // The member is removed from the team. Membership is read live off the team store and is
  // never snapshotted onto the dataset or onto the Actum, so this takes effect on the NEXT run
  // and only there.
  await teams.update(TEAM_ID, { membra: [OTHER_OWNER] })

  await assert.rejects(
    () => h.api.invokeFlow(MINE, { modusId: TEST_MODUS.id }, { board: SHARED.id }),
    (err: unknown) => {
      assert.ok(err instanceof ApiError, 'refused as a request error, not a 500')
      assert.equal(err.code, 'input.invalid_aditus')
      assert.equal(err.httpStatus, 422)
      return true
    },
  )

  // The refused run reached no dispatch of its own: `dispatched()` still holds the FIRST one,
  // byte for byte. Nothing revisited it, and nothing about the membership change reached it.
  assert.equal(h.dispatched(), dispatched, 'no second inceptio')
  assert.equal(JSON.stringify(h.dispatched()), before, 'the already-dispatched inceptio is unchanged')
  assert.equal(
    datasets.lookups.length, lookupsAtDispatch + 1,
    'the dataset was resolved once per invocation — the dispatched run was never re-resolved',
  )
})

// ── The live modi, on a shared dataset ──────────────────────────────────────

const SHARED_CAPTIONED = dataset({
  id: 'ds-shared-captioned', owner: OTHER_OWNER, sodalitasId: TEAM_ID,
  captionsets: [{ id: 'cs-shared', name: 'shared', method: 'manual', coverage: '1/1' }],
})

function liveTeamHarness(): Harness {
  return harness(
    [modus(CAPTION), modus(DECOMPOSE)],
    {
      datasets: datasetStore([SHARED_CAPTIONED, THEIR_CAPTIONED]),
      sodalitatum: new MemorySodalitatum([team(TEAM_ID, [OTHER_OWNER, 'anima-mine'])]),
    },
  )
}

test('caption: a member may name the team-shared dataset', async () => {
  const inceptio = await assertReachedDispatch(liveTeamHarness(), CAPTION, { dataset: SHARED_CAPTIONED.id })
  assert.equal(inceptio.aditus.dataset, SHARED_CAPTIONED.id)
})

test('caption: a dataset shared with nobody is still refused to the same member', async () => {
  await assertRefused(liveTeamHarness(), CAPTION, { dataset: THEIR_CAPTIONED.id }, 'dataset')
})

test('decompose: a captionset resolves through the WIDENED parent, not on its own', async () => {
  const inceptio = await assertReachedDispatch(
    liveTeamHarness(), DECOMPOSE, { dataset: SHARED_CAPTIONED.id, captionset: 'cs-shared' },
  )
  assert.equal(inceptio.aditus.captionset, 'cs-shared')
  // A captionset that is NOT on the shared dataset is still refused: the parent widened, the
  // sub-resource check did not.
  await assertRefused(
    liveTeamHarness(), DECOMPOSE,
    { dataset: SHARED_CAPTIONED.id, captionset: 'cs-theirs' },
    'captionset',
  )
})

test('corpus: the CORPUS reference did not widen — Corpus carries no team overlay', async () => {
  const h = harness([modus(TRAINING)], {
    corpora: corpusStore([corpus({ id: 'corpus-theirs', auctor: OTHER_OWNER })]),
    sodalitatum: new MemorySodalitatum([team(TEAM_ID, [OTHER_OWNER, 'anima-mine'])]),
  })
  await assertRefused(
    h, TRAINING,
    { dataset: 'corpus-theirs', triggerWord: 'trigword', baseModel: 'klein-4b', steps: 10 },
    'dataset',
  )
})
