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
import type { AuctorKey } from '../../../../src/flow/types.js'

const MINE: AuctorKey = { animaId: 'anima-mine' }
const OTHER_OWNER = 'anima-other'
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

/** `findOwned` only — the one seam the run entry point uses. Mirrors the Mongo store's
 *  query predicate: the owner, or a record whose access kind is public. */
function datasetStore(records: Dataset[]): Datasets {
  return {
    async findOwned(id: string, owner: string) {
      const d = records.find(r => r.id === id)
      if (!d) return null
      const access = (d as Dataset & { access?: unknown }).access
      const isPublic = access === 'public'
        || (typeof access === 'object' && access !== null && (access as { kind?: string }).kind === 'public')
      return d.owner === owner || isPublic ? d : null
    },
  } as unknown as Datasets
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

function harness(modi: Modus[], stores: { datasets?: Datasets; corpora?: Corporum } = {}): Harness {
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
async function assertRefused(h: Harness, modusId: string, aditus: Record<string, unknown>, field: string): Promise<void> {
  await assert.rejects(
    () => h.api.invokeFlow(MINE, { modusId }, aditus),
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
