import { test } from 'node:test'
import assert from 'node:assert/strict'
import { MemoryVestigiorum } from '../../../src/rag/MemoryVestigiorum.js'

// ── Helpers ──────────────────────────────────────────────────────────────────

const ANIMA_KEY = { animaId: 'anima-1' } as const
const ARCANUM_KEY = { arcanumHash: 'hash-abc' } as const
const OTHER_KEY = { animaId: 'anima-2' } as const

function makeVestigium(overrides: Record<string, unknown> = {}) {
  return {
    modusId: 'modus-flux',
    auctorKey: ANIMA_KEY,
    promptum: 'a portrait in soft light',
    summarium: 'A warm portrait with bokeh background',
    genus: 'image' as const,
    visibilitas: 'privata' as const,
    signacula: ['portrait'],
    ...overrides,
  }
}

// Predictable embeddings for similarity testing.
// Vectors are unit-normalised in 4D so cosine similarity is exact.
// v1 and v2 are nearly identical (high similarity); v1 and v3 are orthogonal.
const v1 = [1, 0, 0, 0]
const v2 = [0.9, 0.1, 0, 0]    // cosine ≈ 0.994 with v1
const v3 = [0, 1, 0, 0]        // cosine = 0 with v1

function embedder(map: Record<string, number[]>) {
  return async (text: string): Promise<number[]> => map[text] ?? [0, 0, 0, 0]
}

// ── create() ─────────────────────────────────────────────────────────────────

test('create returns vestigium with id, natum, mutatum', async () => {
  const store = new MemoryVestigiorum()
  const v = await store.create(makeVestigium())

  assert.ok(v.id, 'id must be set')
  assert.ok(v.natum instanceof Date)
  assert.ok(v.mutatum instanceof Date)
})

test('create initialises impressio with zero counts and no auctorImpressio', async () => {
  const store = new MemoryVestigiorum()
  const v = await store.create(makeVestigium())

  assert.equal(v.impressio.amor, 0)
  assert.equal(v.impressio.risus, 0)
  assert.equal(v.impressio.maeror, 0)
  assert.equal(v.impressio.auctorImpressio, undefined)
})

test('create does not set embedding', async () => {
  const store = new MemoryVestigiorum()
  const v = await store.create(makeVestigium())
  assert.equal(v.embedding, undefined)
})

// ── findById() ───────────────────────────────────────────────────────────────

test('findById returns null for unknown id', async () => {
  const store = new MemoryVestigiorum()
  const v = await store.findById('nope')
  assert.equal(v, null)
})

test('findById returns stored vestigium', async () => {
  const store = new MemoryVestigiorum()
  const created = await store.create(makeVestigium())
  const found = await store.findById(created.id)
  assert.equal(found?.id, created.id)
  assert.equal(found?.promptum, created.promptum)
})

// ── forIdentity() ────────────────────────────────────────────────────────────

test('forIdentity returns vestigia for matching animaId', async () => {
  const store = new MemoryVestigiorum()
  await store.create(makeVestigium({ auctorKey: ANIMA_KEY }))
  await store.create(makeVestigium({ auctorKey: ANIMA_KEY }))
  await store.create(makeVestigium({ auctorKey: OTHER_KEY }))

  const results = await store.forIdentity(ANIMA_KEY)
  assert.equal(results.length, 2)
  assert.ok(results.every(v => 'animaId' in v.auctorKey && v.auctorKey.animaId === 'anima-1'))
})

test('forIdentity returns vestigia for matching arcanumHash', async () => {
  const store = new MemoryVestigiorum()
  await store.create(makeVestigium({ auctorKey: ARCANUM_KEY }))
  await store.create(makeVestigium({ auctorKey: ANIMA_KEY }))

  const results = await store.forIdentity(ARCANUM_KEY)
  assert.equal(results.length, 1)
  assert.ok('arcanumHash' in results[0].auctorKey)
})

test('forIdentity returns most recent first and respects limit', async () => {
  const store = new MemoryVestigiorum()
  const a = await store.create(makeVestigium())
  const b = await store.create(makeVestigium())
  const c = await store.create(makeVestigium())

  const results = await store.forIdentity(ANIMA_KEY, 2)
  assert.equal(results.length, 2)
  // c was created last — should be first
  assert.equal(results[0].id, c.id)
  assert.equal(results[1].id, b.id)
  // a is excluded by limit
  assert.ok(results.every(v => v.id !== a.id))
})

// ── setAuctorImpressio() ──────────────────────────────────────────────────────

test('setAuctorImpressio sets the author impression', async () => {
  const store = new MemoryVestigiorum()
  const v = await store.create(makeVestigium({ auctorKey: ANIMA_KEY }))
  const updated = await store.setAuctorImpressio(v.id, ANIMA_KEY, 'amor')
  assert.equal(updated.impressio.auctorImpressio, 'amor')
})

test('setAuctorImpressio overwrites a previous impression', async () => {
  const store = new MemoryVestigiorum()
  const v = await store.create(makeVestigium({ auctorKey: ANIMA_KEY }))
  await store.setAuctorImpressio(v.id, ANIMA_KEY, 'amor')
  const updated = await store.setAuctorImpressio(v.id, ANIMA_KEY, 'risus')
  assert.equal(updated.impressio.auctorImpressio, 'risus')
})

test('setAuctorImpressio clears the impression when passed null', async () => {
  const store = new MemoryVestigiorum()
  const v = await store.create(makeVestigium({ auctorKey: ANIMA_KEY }))
  await store.setAuctorImpressio(v.id, ANIMA_KEY, 'amor')
  const updated = await store.setAuctorImpressio(v.id, ANIMA_KEY, null)
  assert.equal(updated.impressio.auctorImpressio, undefined)
})

test('setAuctorImpressio throws when auctorKey does not match', async () => {
  const store = new MemoryVestigiorum()
  const v = await store.create(makeVestigium({ auctorKey: ANIMA_KEY }))
  await assert.rejects(
    () => store.setAuctorImpressio(v.id, OTHER_KEY, 'amor'),
    /auctorKey/
  )
})

// ── rate() ───────────────────────────────────────────────────────────────────

test('rate increments the correct community count', async () => {
  const store = new MemoryVestigiorum()
  const v = await store.create(makeVestigium({ auctorKey: ANIMA_KEY }))
  await store.rate(v.id, OTHER_KEY, 'amor')
  const updated = await store.findById(v.id)
  assert.equal(updated?.impressio.amor, 1)
  assert.equal(updated?.impressio.risus, 0)
  assert.equal(updated?.impressio.maeror, 0)
})

test('rate throws when raterKey matches auctorKey', async () => {
  const store = new MemoryVestigiorum()
  const v = await store.create(makeVestigium({ auctorKey: ANIMA_KEY }))
  await assert.rejects(
    () => store.rate(v.id, ANIMA_KEY, 'amor'),
    /setAuctorImpressio/
  )
})

test('rate prevents double-rating — second call from same rater throws', async () => {
  const store = new MemoryVestigiorum()
  const v = await store.create(makeVestigium({ auctorKey: ANIMA_KEY }))
  await store.rate(v.id, OTHER_KEY, 'amor')
  await assert.rejects(
    () => store.rate(v.id, OTHER_KEY, 'risus'),
    /already rated/
  )
  // count should still be 1
  const updated = await store.findById(v.id)
  assert.equal(updated?.impressio.amor, 1)
})

// ── update() ─────────────────────────────────────────────────────────────────

test('update patches visibilitas and signacula', async () => {
  const store = new MemoryVestigiorum()
  const v = await store.create(makeVestigium({ visibilitas: 'privata' }))
  const now = new Date()
  const updated = await store.update(v.id, { visibilitas: 'publica', signacula: ['forest', 'portrait'], mutatum: now })
  assert.equal(updated.visibilitas, 'publica')
  assert.deepEqual(updated.signacula, ['forest', 'portrait'])
  assert.equal(updated.mutatum, now)
})

// ── index() ───────────────────────────────────────────────────────────────────

test('index sets the embedding on the vestigium', async () => {
  const store = new MemoryVestigiorum(embedder({ 'a portrait in soft light A warm portrait with bokeh background': v1 }))
  const v = await store.create(makeVestigium())
  assert.equal(v.embedding, undefined)
  await store.index(v.id)
  const updated = await store.findById(v.id)
  assert.deepEqual(updated?.embedding, v1)
})

test('index throws when no embed function is configured', async () => {
  const store = new MemoryVestigiorum()
  const v = await store.create(makeVestigium())
  await assert.rejects(() => store.index(v.id), /embed/)
})

// ── search() ─────────────────────────────────────────────────────────────────

test('search returns results ordered by similarity', async () => {
  const queryText = 'soft portrait'
  const store = new MemoryVestigiorum(
    embedder({
      [queryText]: v1,
      'a portrait in soft light A warm portrait with bokeh background': v2,
      'dark landscape at night Moody forest scene': v3,
    })
  )
  const portrait = await store.create(makeVestigium({ promptum: 'a portrait in soft light', summarium: 'A warm portrait with bokeh background', visibilitas: 'publica' }))
  const landscape = await store.create(makeVestigium({ promptum: 'dark landscape at night', summarium: 'Moody forest scene', visibilitas: 'publica' }))
  await store.index(portrait.id)
  await store.index(landscape.id)

  const results = await store.search({ quaerendum: queryText, visibilitas: ['publica'] })
  assert.ok(results.length >= 1)
  assert.equal(results[0].vestigium.id, portrait.id)
  assert.ok(results[0].similaritas > 0.9)
})

test('search excludes vestigia with no embedding', async () => {
  const store = new MemoryVestigiorum(embedder({ 'query': v1 }))
  await store.create(makeVestigium({ visibilitas: 'publica' }))  // no index() call

  const results = await store.search({ quaerendum: 'query', visibilitas: ['publica'] })
  assert.equal(results.length, 0)
})

test('search filters by auctorKey', async () => {
  const queryText = 'q'
  const store = new MemoryVestigiorum(
    embedder({ [queryText]: v1, 'p sA warm': v1 })
  )
  const mine = await store.create(makeVestigium({ auctorKey: ANIMA_KEY, promptum: 'p', summarium: 'sA warm', visibilitas: 'publica' }))
  const theirs = await store.create(makeVestigium({ auctorKey: OTHER_KEY, promptum: 'p', summarium: 'sA warm', visibilitas: 'publica' }))
  await store.index(mine.id)
  await store.index(theirs.id)

  const results = await store.search({ quaerendum: queryText, auctorKey: ANIMA_KEY })
  assert.ok(results.every(r => 'animaId' in r.vestigium.auctorKey && r.vestigium.auctorKey.animaId === 'anima-1'))
  assert.ok(results.some(r => r.vestigium.id === mine.id))
  assert.ok(!results.some(r => r.vestigium.id === theirs.id))
})

test('search with no auctorKey only returns publica vestigia', async () => {
  const queryText = 'q'
  const store = new MemoryVestigiorum(embedder({ [queryText]: v1, 'p s': v1 }))
  const pub = await store.create(makeVestigium({ promptum: 'p', summarium: 's', visibilitas: 'publica' }))
  const priv = await store.create(makeVestigium({ promptum: 'p', summarium: 's', visibilitas: 'privata' }))
  await store.index(pub.id)
  await store.index(priv.id)

  const results = await store.search({ quaerendum: queryText })
  assert.ok(results.some(r => r.vestigium.id === pub.id))
  assert.ok(!results.some(r => r.vestigium.id === priv.id))
})

test('search filters by auctorImpressio', async () => {
  const queryText = 'q'
  const store = new MemoryVestigiorum(embedder({ [queryText]: v1, 'p s': v1 }))
  const loved = await store.create(makeVestigium({ promptum: 'p', summarium: 's', visibilitas: 'privata', auctorKey: ANIMA_KEY }))
  const unrated = await store.create(makeVestigium({ promptum: 'p', summarium: 's', visibilitas: 'privata', auctorKey: ANIMA_KEY }))
  await store.index(loved.id)
  await store.index(unrated.id)
  await store.setAuctorImpressio(loved.id, ANIMA_KEY, 'amor')

  const results = await store.search({ quaerendum: queryText, auctorKey: ANIMA_KEY, auctorImpressio: ['amor'] })
  assert.ok(results.some(r => r.vestigium.id === loved.id))
  assert.ok(!results.some(r => r.vestigium.id === unrated.id))
})

test('search filters by modusId', async () => {
  const queryText = 'q'
  const store = new MemoryVestigiorum(embedder({ [queryText]: v1, 'p s': v1 }))
  const flux = await store.create(makeVestigium({ promptum: 'p', summarium: 's', modusId: 'flux', visibilitas: 'publica' }))
  const sdxl = await store.create(makeVestigium({ promptum: 'p', summarium: 's', modusId: 'sdxl', visibilitas: 'publica' }))
  await store.index(flux.id)
  await store.index(sdxl.id)

  const results = await store.search({ quaerendum: queryText, modusId: 'flux', visibilitas: ['publica'] })
  assert.ok(results.some(r => r.vestigium.id === flux.id))
  assert.ok(!results.some(r => r.vestigium.id === sdxl.id))
})

test('search filters by genus', async () => {
  const queryText = 'q'
  const store = new MemoryVestigiorum(embedder({ [queryText]: v1, 'p s': v1 }))
  const img = await store.create(makeVestigium({ promptum: 'p', summarium: 's', genus: 'image', visibilitas: 'publica' }))
  const vid = await store.create(makeVestigium({ promptum: 'p', summarium: 's', genus: 'video', visibilitas: 'publica' }))
  await store.index(img.id)
  await store.index(vid.id)

  const results = await store.search({ quaerendum: queryText, genus: 'image', visibilitas: ['publica'] })
  assert.ok(results.some(r => r.vestigium.id === img.id))
  assert.ok(!results.some(r => r.vestigium.id === vid.id))
})

test('search respects limit', async () => {
  const queryText = 'q'
  const store = new MemoryVestigiorum(embedder({ [queryText]: v1, 'p s': v1 }))
  for (let i = 0; i < 5; i++) {
    const v = await store.create(makeVestigium({ promptum: 'p', summarium: 's', visibilitas: 'publica' }))
    await store.index(v.id)
  }
  const results = await store.search({ quaerendum: queryText, visibilitas: ['publica'], limit: 3 })
  assert.equal(results.length, 3)
})

test('search enforces minSimilaritas cutoff', async () => {
  const queryText = 'q'
  const store = new MemoryVestigiorum(embedder({
    [queryText]: v1,
    'p s': v3,  // orthogonal — cosine = 0
  }))
  const v = await store.create(makeVestigium({ promptum: 'p', summarium: 's', visibilitas: 'publica' }))
  await store.index(v.id)

  const results = await store.search({ quaerendum: queryText, visibilitas: ['publica'], minSimilaritas: 0.5 })
  assert.equal(results.length, 0)
})
