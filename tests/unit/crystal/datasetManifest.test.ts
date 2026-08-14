// Slice E step 1 — the dataset→manifest resolver is the one pure seam between a
// stored dataset and what the pod pulls. Pin: image-only projection, caption
// passthrough, inline-manifest fast path, and the loud failures (missing corpus,
// no images) so a remote train never launches against an empty dataset.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { corpusToManifest, parseManifest, makeDatasetResolver, datasetToManifest } from '../../../src/crystal/datasetManifest.js'
import type { Corpus, Corpora, Corporum } from '../../../src/types/corpus.js'
import type { Dataset, Captionset } from '../../../src/types/dataset.js'

const corpus = (exemplaria: Corpus['exemplaria']): Corpus =>
  ({ id: 'c1', nomen: 'koh', genus: 'paria', auctor: 'a1', exemplaria, numerus: exemplaria.length,
     status: 'validatus', natum: new Date(0), mutatum: new Date(0) })

class FakeCorpora implements Corporum {
  constructor(private readonly byId: Record<string, Corpus>) {}
  async find(id: string): Promise<Corpus | null> { return this.byId[id] ?? null }
  async list(): Promise<Corpora> { return Object.values(this.byId) }
  async create(): Promise<Corpus> { throw new Error('not used') }
  async update(): Promise<Corpus> { throw new Error('not used') }
}

test('corpusToManifest: projects image exemplaria with captions, in order', () => {
  const m = corpusToManifest(corpus([
    { ref: 'https://r2/a.png', titulus: 'a koh man', genus: 'image/png' },
    { ref: 'https://r2/b.jpg', genus: 'image/jpeg' },                       // no caption
  ]))
  assert.deepEqual(m, [
    { url: 'https://r2/a.png', caption: 'a koh man' },
    { url: 'https://r2/b.jpg' },
  ])
})

test('corpusToManifest: drops non-image exemplaria and blank captions', () => {
  const m = corpusToManifest(corpus([
    { ref: 'https://r2/a.png', titulus: '   ', genus: 'image/png' },        // blank → no caption key
    { ref: 'https://r2/notes.txt', titulus: 'ignore me', genus: 'text/plain' }, // dropped
  ]))
  assert.deepEqual(m, [{ url: 'https://r2/a.png' }])
})

test('parseManifest: accepts a JSON array of {url,caption?}', () => {
  assert.deepEqual(
    parseManifest('[{"url":"https://r2/a.png","caption":"x"},{"url":"https://r2/b.png"}]'),
    [{ url: 'https://r2/a.png', caption: 'x' }, { url: 'https://r2/b.png' }],
  )
})

test('parseManifest: returns null for non-manifest strings (so the resolver falls through to a corpus id)', () => {
  assert.equal(parseManifest('corpus-123'), null)
  assert.equal(parseManifest('{"url":"x"}'), null)           // object, not array
  assert.equal(parseManifest('[{"caption":"no url"}]'), null) // missing url
  assert.equal(parseManifest('not json ['), null)
})

test('resolver: an inline manifest passes through', async () => {
  const r = makeDatasetResolver({ corpora: new FakeCorpora({}) })
  assert.deepEqual(await r.resolve('[{"url":"https://r2/a.png"}]'), [{ url: 'https://r2/a.png' }])
})

test('resolver: a corpusId is looked up and projected', async () => {
  const r = makeDatasetResolver({ corpora: new FakeCorpora({ c1: corpus([
    { ref: 'https://r2/a.png', titulus: 'koh', genus: 'image/png' },
  ]) }) })
  assert.deepEqual(await r.resolve('c1'), [{ url: 'https://r2/a.png', caption: 'koh' }])
})

test('resolver: throws on a missing corpus', async () => {
  const r = makeDatasetResolver({ corpora: new FakeCorpora({}) })
  await assert.rejects(() => r.resolve('nope'), /dataset not found: nope/)
})

test('resolver: throws when a corpus has no image exemplaria', async () => {
  const r = makeDatasetResolver({ corpora: new FakeCorpora({ c1: corpus([
    { ref: 'https://r2/notes.txt', genus: 'text/plain' },
  ]) }) })
  await assert.rejects(() => r.resolve('c1'), /no image exemplaria/)
})

test('resolver: throws on an empty inline manifest', async () => {
  const r = makeDatasetResolver({ corpora: new FakeCorpora({}) })
  await assert.rejects(() => r.resolve('[]'), /manifest is empty/)
})

// ── The caption job's projection: a Dataset, not a Corpus ──────────────────────────────────
// `ManifestItem.id` is additive and OPTIONAL because both projectors and the parser are shared
// with the training launch, which has no media ids to supply. These pin both halves: the
// training path is unchanged by the field existing, and the caption path always carries it.

const dataset = (media: Array<{ id: string; url: string }>, captionsets: Captionset[] = []): Dataset => ({
  id: 'ds-1', owner: 'anima-abc', name: 'sample set', modality: 'image', custody: 'remote',
  media: media.map(m => ({ ...m, source: 'upload' as const, addedAt: new Date(0) })),
  captionsets, versions: [], natum: new Date(0), mutatum: new Date(0),
})

test('datasetToManifest: projects media in order, each carrying its id', () => {
  assert.deepEqual(
    datasetToManifest(dataset([
      { id: 'media-1', url: 'https://r2/a.png' },
      { id: 'media-2', url: 'https://r2/b.jpg' },
    ])),
    [
      { url: 'https://r2/a.png', id: 'media-1' },
      { url: 'https://r2/b.jpg', id: 'media-2' },
    ],
  )
})

test('datasetToManifest: emits no captions, even when the dataset already has a captionset', () => {
  const m = datasetToManifest(dataset(
    [{ id: 'media-1', url: 'https://r2/a.png' }],
    [{ id: 'captionset-old', name: 'first pass', method: 'manual', coverage: '1/1',
       captions: { 'media-1': 'an earlier caption' } }],
  ))
  // The pod captioner runs recaption:false and skips any image that arrives with a sidecar, so a
  // manifest carrying existing captions would make a re-caption return a copy of the old pass.
  assert.deepEqual(m, [{ url: 'https://r2/a.png', id: 'media-1' }])
})

test('parseManifest: an id-less manifest is unchanged (the training path)', () => {
  assert.deepEqual(
    parseManifest('[{"url":"https://r2/a.png","caption":"a koh man"},{"url":"https://r2/b.jpg"}]'),
    [{ url: 'https://r2/a.png', caption: 'a koh man' }, { url: 'https://r2/b.jpg' }],
  )
})

test('parseManifest: passes an id through when present, and still rejects a bad shape', () => {
  assert.deepEqual(
    parseManifest('[{"url":"https://r2/a.png","id":"media-1"}]'),
    [{ url: 'https://r2/a.png', id: 'media-1' }],
  )
  // An absent id is valid input, not an error; a missing url still rejects.
  assert.deepEqual(parseManifest('[{"id":"media-1"}]'), null)
  assert.deepEqual(parseManifest('[{"url":"https://r2/a.png","id":42}]'), [{ url: 'https://r2/a.png' }])
})
