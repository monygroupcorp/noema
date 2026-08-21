// Caption finality — a completed caption run becomes a captionset on the dataset. Pins the four
// things this seam owns: harvested ids bind to media by IDENTITY (never by position), an id that
// is not on the dataset fails the job instead of inflating coverage, a re-run under the same job
// replaces its captionset rather than appending a second, and the composed exitus resolver keeps
// BOTH the caption and the training path reachable through the router's single slot.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  makeCaptionFinalizer,
  makeCaptionExitusResolver,
  composeExitusResolvers,
  urlCaptionHarvestReader,
} from '../../../src/crystal/captionFinalizer.js'
import type { ExitusResolver } from '../../../src/crystal/captionFinalizer.js'
import { captionCoverage } from '../../../src/types/dataset.js'
import type { Dataset, Captionset } from '../../../src/types/dataset.js'
import type { Actum } from '../../../src/types/actum.js'
import type { Modus } from '../../../src/types/modus.js'
import type { MediaFetcher } from '../../../src/crystal/MediaFetcher.js'

/** A dataset store just rich enough for finality: find + the replace-by-id addCaptionset the
 *  Mongo store implements (coverage derived there, never caller-supplied). */
class FakeDatasets {
  constructor(private ds: Dataset | null) {}
  writes = 0
  async find(_id: string): Promise<Dataset | null> { return this.ds }
  async addCaptionset(_datasetId: string, captionset: Captionset): Promise<Dataset | null> {
    if (!this.ds) return null
    this.writes++
    const next: Captionset = { ...captionset, coverage: captionCoverage(captionset.captions, this.ds.media.length) }
    const captionsets = this.ds.captionsets.some(c => c.id === next.id)
      ? this.ds.captionsets.map(c => (c.id === next.id ? next : c))
      : [...this.ds.captionsets, next]
    this.ds = { ...this.ds, captionsets }
    return this.ds
  }
  /** The single-caption write the Mongo store implements: it writes into an EXISTING captionset
   *  and recomputes that set's coverage from the captions present, so coverage moves as a
   *  consequence of the write rather than being supplied. Null when the set is not there. */
  async setCaption(_datasetId: string, captionsetId: string, mediaId: string, caption: string): Promise<Dataset | null> {
    if (!this.ds) return null
    const set = this.ds.captionsets.find(c => c.id === captionsetId)
    if (!set) return null
    this.writes++
    const captions = { ...(set.captions ?? {}), [mediaId]: caption }
    const next: Captionset = { ...set, captions, coverage: captionCoverage(captions, this.ds.media.length) }
    this.ds = { ...this.ds, captionsets: this.ds.captionsets.map(c => (c.id === next.id ? next : c)) }
    return this.ds
  }
  get current(): Dataset | null { return this.ds }
}

const dataset = (ids: string[]): Dataset => ({
  id: 'ds-1', owner: 'anima-abc', name: 'sample set', modality: 'image', custody: 'remote',
  media: ids.map((id, i) => ({ id, url: `https://r2.example/${i}.png`, source: 'upload' as const, addedAt: new Date(0) })),
  captionsets: [], versions: [], natum: new Date(0), mutatum: new Date(0),
})

const actum = (aditus: Record<string, unknown>): Actum => ({ id: 'act-1', aditus } as unknown as Actum)

const reader = (harvest: Record<string, string>) => async () => harvest

test('a valid harvest writes a captionset keyed by media id, and reports what it covered', async () => {
  const datasets = new FakeDatasets(dataset(['media-1', 'media-2', 'media-3']))
  const finalize = makeCaptionFinalizer({
    datasets,
    reader: reader({ 'media-1': 'the first image', 'media-3': 'the third image' }),
  })

  const exitus = await finalize(actum({ dataset: 'ds-1', jobId: 'job-1', name: 'batch pass' }),
    { outputUrl: 'https://r2.example/captions/job-1/captions.json' })

  const written = datasets.current!.captionsets[0]
  assert.equal(written.id, 'captionset-job-1')
  assert.equal(written.name, 'batch pass')
  assert.equal(written.method, 'Qwen3-VL')
  assert.deepEqual(written.captions, { 'media-1': 'the first image', 'media-3': 'the third image' })
  // Coverage comes off the store's derivation, not a second computation here.
  assert.equal(written.coverage, '2/3')
  assert.deepEqual(exitus, { captionsetId: 'captionset-job-1', captioned: 2, coverage: '2/3' })
})

// NON-VACUITY: a caption keyed by manifest POSITION would resolve against a media list that is
// append-only and may have grown while the pod ran. Nothing here maps an index to an item — the
// harvest arrives already keyed by the id the manifest carried out.
test('a reordered/short manifest cannot mis-bind a caption — binding is by id, not position', async () => {
  // The harvest names the LAST media item; a positional reading of "the first harvested entry"
  // would bind this text to media-1.
  const datasets = new FakeDatasets(dataset(['media-1', 'media-2', 'media-3']))
  const finalize = makeCaptionFinalizer({ datasets, reader: reader({ 'media-3': 'text for the third item' }) })

  await finalize(actum({ dataset: 'ds-1', jobId: 'job-1' }), { outputUrl: 'https://r2.example/c.json' })

  const captions = datasets.current!.captionsets[0].captions!
  assert.deepEqual(Object.keys(captions), ['media-3'])
  assert.equal(captions['media-3'], 'text for the third item')
  assert.equal('media-1' in captions, false)
})

// NON-VACUITY: the store writes whatever keys it is handed and derives coverage from their
// COUNT, so a caption bound to nothing would still read as covered. Validation lives here.
test('an unknown media id fails the job rather than inflating coverage', async () => {
  const datasets = new FakeDatasets(dataset(['media-1', 'media-2']))
  const finalize = makeCaptionFinalizer({
    datasets,
    reader: reader({ 'media-1': 'fine', 'media-not-on-this-dataset': 'bound to nothing' }),
  })

  await assert.rejects(
    () => finalize(actum({ dataset: 'ds-1', jobId: 'job-1' }), { outputUrl: 'https://r2.example/c.json' }),
    /not on dataset/,
  )
  assert.equal(datasets.writes, 0, 'nothing is written when a key does not bind')
  assert.equal(datasets.current!.captionsets.length, 0)
})

test('a re-run under the same job replaces its captionset rather than appending a second', async () => {
  const datasets = new FakeDatasets(dataset(['media-1', 'media-2']))
  const first = makeCaptionFinalizer({ datasets, reader: reader({ 'media-1': 'first attempt' }) })
  await first(actum({ dataset: 'ds-1', jobId: 'job-1' }), { outputUrl: 'https://r2.example/c.json' })

  const second = makeCaptionFinalizer({
    datasets, reader: reader({ 'media-1': 'second attempt', 'media-2': 'and the other one' }),
  })
  const exitus = await second(actum({ dataset: 'ds-1', jobId: 'job-1' }), { outputUrl: 'https://r2.example/c.json' })

  assert.equal(datasets.current!.captionsets.length, 1)
  assert.equal(datasets.current!.captionsets[0].captions!['media-1'], 'second attempt')
  assert.deepEqual(exitus, { captionsetId: 'captionset-job-1', captioned: 2, coverage: '2/2' })
})

test('a missing dataset or a completion with no output URL fails the job', async () => {
  const finalize = makeCaptionFinalizer({ datasets: new FakeDatasets(null), reader: reader({}) })
  await assert.rejects(() => finalize(actum({ dataset: 'ds-1' }), { outputUrl: 'https://r2.example/c.json' }), /dataset not found/)

  const withDataset = makeCaptionFinalizer({ datasets: new FakeDatasets(dataset(['media-1'])), reader: reader({}) })
  await assert.rejects(() => withDataset(actum({ dataset: 'ds-1' }), {}), /no caption output URL/)
})

test('the exitus resolver declines any completion that is not a caption run', async () => {
  const resolve = makeCaptionExitusResolver(async () => ({ captionsetId: 'captionset-job-1' }))
  const caption = { ministerium: 'aitkcaption' } as Modus
  const training = { ministerium: 'aitoolkit' } as Modus

  assert.equal(await resolve(actum({}), training, [{ url: 'https://r2.example/x' }]), null)
  assert.equal(await resolve(actum({}), null, [{ url: 'https://r2.example/x' }]), null)
  assert.deepEqual(await resolve(actum({}), caption, [{ url: 'https://r2.example/x' }]), { captionsetId: 'captionset-job-1' })
})

// NON-VACUITY: the webhook router has ONE resolveExitus slot. Make the caption resolver REPLACE
// the training one rather than composing and this fails — a finished training run would fall
// through to the generic projection and never host its LoRA or register its Intella, while still
// reporting success.
test('a training completion still resolves its LoRA once a caption resolver is in the slot', async () => {
  const captionResolver: ExitusResolver = async (_a, modus) =>
    modus?.ministerium === 'aitkcaption' ? { captionsetId: 'captionset-job-1' } : null
  const trainingResolver: ExitusResolver = async (_a, modus) =>
    modus?.ministerium === 'aitoolkit' ? { trained: true, loraId: 'lora-1' } : null

  const composed = composeExitusResolvers(captionResolver, trainingResolver)!
  const items = [{ url: 'https://r2.example/x' }]

  assert.deepEqual(await composed(actum({}), { ministerium: 'aitoolkit' } as Modus, items), { trained: true, loraId: 'lora-1' })
  assert.deepEqual(await composed(actum({}), { ministerium: 'aitkcaption' } as Modus, items), { captionsetId: 'captionset-job-1' })
  // Neither owns a third ministerium — the router falls back to the generic projection.
  assert.equal(await composed(actum({}), { ministerium: 'openai' } as Modus, items), null)
})

test('composeExitusResolvers passes an unconfigured deployment through untouched', () => {
  assert.equal(composeExitusResolvers(undefined, undefined), undefined)
  const only: ExitusResolver = async () => null
  assert.equal(composeExitusResolvers(undefined, only), only)
})

test('the harvest reader parses a caption map and rejects anything that is not one', async () => {
  const fetcher = (body: string): MediaFetcher => ({ async fetch() { return Buffer.from(body, 'utf8') } })
  assert.deepEqual(await urlCaptionHarvestReader(fetcher('{"media-1":"a caption"}'))('https://r2.example/c.json'),
    { 'media-1': 'a caption' })
  await assert.rejects(() => urlCaptionHarvestReader(fetcher('not json'))('https://r2.example/c.json'), /not valid JSON/)
  await assert.rejects(() => urlCaptionHarvestReader(fetcher('["a caption"]'))('https://r2.example/c.json'), /not a \{mediaId: caption\} object/)
})

// ── Extending the captionset the run was given (noema-279) ────────────────────────────────────
//
// A caption pass adds to the layer instead of rebuilding it. `addCaptionset` REPLACES a
// captionset by id, so the extend path cannot use it — handing it this pass' harvest alone would
// drop every caption the set already carried. It writes one caption at a time through
// `setCaption`, which is also what moves the set's coverage without a second computation here.

const withSet = (ids: string[], captionset: Captionset): Dataset => {
  const d = dataset(ids)
  return { ...d, captionsets: [captionset] }
}

test('harvested captions land in the captionset the run was given, and no second captionset is created', async () => {
  const existing: Captionset = {
    id: 'captionset-1', name: 'first pass', method: 'Qwen3-VL', coverage: '1/3',
    captions: { 'media-1': 'the first image' },
  }
  const datasets = new FakeDatasets(withSet(['media-1', 'media-2', 'media-3'], existing))
  const finalize = makeCaptionFinalizer({
    datasets,
    reader: reader({ 'media-2': 'the second image', 'media-3': 'the third image' }),
  })

  const exitus = await finalize(
    actum({ dataset: 'ds-1', jobId: 'job-2', captionset: 'captionset-1' }),
    { outputUrl: 'https://r2.example/c.json' },
  )

  assert.equal(datasets.current!.captionsets.length, 1, 'the pass added to the layer, it did not make a second one')
  const written = datasets.current!.captionsets[0]
  assert.equal(written.id, 'captionset-1')
  assert.equal(written.name, 'first pass', 'extending does not rename the pass it extends')
  // The caption the set already carried is still there — extending is additive.
  assert.deepEqual(written.captions, {
    'media-1': 'the first image',
    'media-2': 'the second image',
    'media-3': 'the third image',
  })
  assert.equal(exitus.captionsetId, 'captionset-1')
  assert.equal(exitus.captioned, 2, 'the exitus counts what THIS pass captioned')
})

test('extending a captionset moves its coverage to include the new images', async () => {
  const existing: Captionset = {
    id: 'captionset-1', name: 'first pass', method: 'Qwen3-VL', coverage: '1/3',
    captions: { 'media-1': 'the first image' },
  }
  const datasets = new FakeDatasets(withSet(['media-1', 'media-2', 'media-3'], existing))
  const finalize = makeCaptionFinalizer({
    datasets,
    reader: reader({ 'media-2': 'the second image', 'media-3': 'the third image' }),
  })

  const exitus = await finalize(
    actum({ dataset: 'ds-1', jobId: 'job-2', captionset: 'captionset-1' }),
    { outputUrl: 'https://r2.example/c.json' },
  )

  // Coverage is read back off the record the store returned, not computed here — a pass that
  // covered one of three now covers all three.
  assert.equal(datasets.current!.captionsets[0].coverage, '3/3')
  assert.equal(exitus.coverage, '3/3')
})

test('a pass given no captionset still mints one and captions the whole set', async () => {
  // The fresh-set path is demoted from the default, never deleted: it is how a dataset gets its
  // first captionset, and it is the deliberate second pass when a different captioner produces it.
  const existing: Captionset = {
    id: 'captionset-1', name: 'first pass', method: 'Qwen3-VL', coverage: '1/2',
    captions: { 'media-1': 'the first image' },
  }
  const datasets = new FakeDatasets(withSet(['media-1', 'media-2'], existing))
  const finalize = makeCaptionFinalizer({
    datasets,
    reader: reader({ 'media-1': 'a fresh look at the first', 'media-2': 'and the second' }),
  })

  const exitus = await finalize(actum({ dataset: 'ds-1', jobId: 'job-2' }), { outputUrl: 'https://r2.example/c.json' })

  assert.equal(datasets.current!.captionsets.length, 2, 'a pass given no captionset mints its own')
  const minted = datasets.current!.captionsets[1]
  assert.equal(minted.id, 'captionset-job-2')
  assert.deepEqual(minted.captions, { 'media-1': 'a fresh look at the first', 'media-2': 'and the second' })
  assert.deepEqual(exitus, { captionsetId: 'captionset-job-2', captioned: 2, coverage: '2/2' })
  // And the pass it did NOT extend is untouched.
  assert.deepEqual(datasets.current!.captionsets[0].captions, { 'media-1': 'the first image' })
})

test('extending a captionset that is not on the dataset fails the job before any write', async () => {
  const datasets = new FakeDatasets(dataset(['media-1']))
  const finalize = makeCaptionFinalizer({ datasets, reader: reader({ 'media-1': 'a caption' }) })
  await assert.rejects(
    () => finalize(actum({ dataset: 'ds-1', jobId: 'job-2', captionset: 'captionset-nope' }),
      { outputUrl: 'https://r2.example/c.json' }),
    /is not on dataset/,
  )
  assert.equal(datasets.writes, 0)
})

test('an unknown media id fails an EXTENDING pass too, before it writes anything', async () => {
  // The validation loop runs before either write path, so the extend route cannot become the way
  // a caption bound to nothing gets counted.
  const existing: Captionset = { id: 'captionset-1', name: 'first pass', method: 'Qwen3-VL', coverage: '0/1', captions: {} }
  const datasets = new FakeDatasets(withSet(['media-1'], existing))
  const finalize = makeCaptionFinalizer({
    datasets, reader: reader({ 'media-1': 'fine', 'media-not-here': 'bound to nothing' }),
  })
  await assert.rejects(
    () => finalize(actum({ dataset: 'ds-1', jobId: 'job-2', captionset: 'captionset-1' }),
      { outputUrl: 'https://r2.example/c.json' }),
    /not on dataset/,
  )
  assert.equal(datasets.writes, 0)
})
