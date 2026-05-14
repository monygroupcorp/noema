import { test } from 'node:test'
import assert from 'node:assert/strict'
import { MemoryVestigiorum } from '../../../src/rag/MemoryVestigiorum.js'

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

// Predictable unit vectors for cosine similarity testing.
// v1 · v2 ≈ 0.994 (nearly identical); v1 · v3 = 0 (orthogonal).
const v1 = [1, 0, 0, 0]
const v2 = [0.9, 0.1, 0, 0]
const v3 = [0, 1, 0, 0]

function embedder(map: Record<string, number[]>) {
  return async (text: string): Promise<number[]> => map[text] ?? [0, 0, 0, 0]
}

function imageEmbedder(map: Record<string, number[]>) {
  return async (url: string): Promise<number[]> => map[url] ?? [0, 0, 0, 0]
}

// ── create() ─────────────────────────────────────────────────────────────────

test('create returns vestigium with id, natum, mutatum', async () => {
  const store = new MemoryVestigiorum()
  const v = await store.create(makeVestigium())
  assert.ok(v.id)
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

test('create does not set any embeddings', async () => {
  const store = new MemoryVestigiorum()
  const v = await store.create(makeVestigium())
  assert.equal(v.embeddingPromptum, undefined)
  assert.equal(v.embeddingImago, undefined)
  assert.equal(v.embeddingIntella, undefined)
})

// ── findById() ───────────────────────────────────────────────────────────────

test('findById returns null for unknown id', async () => {
  const store = new MemoryVestigiorum()
  assert.equal(await store.findById('nope'), null)
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
  assert.equal(results[0].id, c.id)
  assert.equal(results[1].id, b.id)
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

test('setAuctorImpressio clears impression when passed null', async () => {
  const store = new MemoryVestigiorum()
  const v = await store.create(makeVestigium({ auctorKey: ANIMA_KEY }))
  await store.setAuctorImpressio(v.id, ANIMA_KEY, 'amor')
  const updated = await store.setAuctorImpressio(v.id, ANIMA_KEY, null)
  assert.equal(updated.impressio.auctorImpressio, undefined)
})

test('setAuctorImpressio throws when auctorKey does not match', async () => {
  const store = new MemoryVestigiorum()
  const v = await store.create(makeVestigium({ auctorKey: ANIMA_KEY }))
  await assert.rejects(() => store.setAuctorImpressio(v.id, OTHER_KEY, 'amor'), /auctorKey/)
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
  await assert.rejects(() => store.rate(v.id, ANIMA_KEY, 'amor'), /setAuctorImpressio/)
})

test('rate prevents double-rating', async () => {
  const store = new MemoryVestigiorum()
  const v = await store.create(makeVestigium({ auctorKey: ANIMA_KEY }))
  await store.rate(v.id, OTHER_KEY, 'amor')
  await assert.rejects(() => store.rate(v.id, OTHER_KEY, 'risus'), /already rated/)
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

// ── indexPromptum() ──────────────────────────────────────────────────────────

test('indexPromptum embeds promptum and sets embeddingPromptum', async () => {
  const store = new MemoryVestigiorum(embedder({ 'a portrait in soft light': v1 }))
  const v = await store.create(makeVestigium())
  assert.equal(v.embeddingPromptum, undefined)
  await store.indexPromptum(v.id)
  const updated = await store.findById(v.id)
  assert.deepEqual(updated?.embeddingPromptum, v1)
})

test('indexPromptum appends negativum when present', async () => {
  const store = new MemoryVestigiorum(embedder({ 'a portrait blurry ugly': v2 }))
  const v = await store.create(makeVestigium({ promptum: 'a portrait', negativum: 'blurry ugly' }))
  await store.indexPromptum(v.id)
  const updated = await store.findById(v.id)
  assert.deepEqual(updated?.embeddingPromptum, v2)
})

test('indexPromptum throws when no embed function configured', async () => {
  const store = new MemoryVestigiorum()
  const v = await store.create(makeVestigium())
  await assert.rejects(() => store.indexPromptum(v.id), /embed/)
})

// ── indexImago() ─────────────────────────────────────────────────────────────

test('indexImago embeds imagoUrl and sets embeddingImago', async () => {
  const store = new MemoryVestigiorum(undefined, imageEmbedder({ 'https://cdn.example.com/img.png': v1 }))
  const v = await store.create(makeVestigium({ imagoUrl: 'https://cdn.example.com/img.png' }))
  await store.indexImago(v.id)
  const updated = await store.findById(v.id)
  assert.deepEqual(updated?.embeddingImago, v1)
})

test('indexImago is a no-op when imagoUrl is absent', async () => {
  const store = new MemoryVestigiorum(undefined, imageEmbedder({}))
  const v = await store.create(makeVestigium())  // no imagoUrl
  await store.indexImago(v.id)
  const updated = await store.findById(v.id)
  assert.equal(updated?.embeddingImago, undefined)
})

test('indexImago throws when no embedImage function configured', async () => {
  const store = new MemoryVestigiorum()
  const v = await store.create(makeVestigium({ imagoUrl: 'https://cdn.example.com/img.png' }))
  await assert.rejects(() => store.indexImago(v.id), /embedImage/)
})

// ── indexIntella() ───────────────────────────────────────────────────────────

test('indexIntella embeds intellaDescription and sets embeddingIntella', async () => {
  const store = new MemoryVestigiorum(embedder({ 'FLUX.1 Schnell — fast latent diffusion': v1 }))
  const v = await store.create(makeVestigium({ intellaDescription: 'FLUX.1 Schnell — fast latent diffusion' }))
  await store.indexIntella(v.id)
  const updated = await store.findById(v.id)
  assert.deepEqual(updated?.embeddingIntella, v1)
})

test('indexIntella is a no-op when intellaDescription is absent', async () => {
  const store = new MemoryVestigiorum(embedder({}))
  const v = await store.create(makeVestigium())  // no intellaDescription
  await store.indexIntella(v.id)
  const updated = await store.findById(v.id)
  assert.equal(updated?.embeddingIntella, undefined)
})

test('indexIntella throws when no embed function configured', async () => {
  const store = new MemoryVestigiorum()
  const v = await store.create(makeVestigium({ intellaDescription: 'FLUX Schnell' }))
  await assert.rejects(() => store.indexIntella(v.id), /embed/)
})

// ── search() — per: 'promptum' (default) ─────────────────────────────────────

test('search by promptum returns results ordered by similarity', async () => {
  const queryText = 'soft portrait'
  const store = new MemoryVestigiorum(embedder({
    [queryText]: v1,
    'a portrait in soft light': v2,
    'dark landscape at night': v3,
  }))
  const portrait = await store.create(makeVestigium({ promptum: 'a portrait in soft light', visibilitas: 'publica' }))
  const landscape = await store.create(makeVestigium({ promptum: 'dark landscape at night', visibilitas: 'publica' }))
  await store.indexPromptum(portrait.id)
  await store.indexPromptum(landscape.id)

  const results = await store.search({ quaerendum: queryText, visibilitas: ['publica'] })
  assert.ok(results.length >= 1)
  assert.equal(results[0].vestigium.id, portrait.id)
  assert.ok(results[0].similaritas > 0.9)
})

test('search excludes vestigia with no embedding for the chosen dimension', async () => {
  const store = new MemoryVestigiorum(embedder({ 'query': v1 }))
  await store.create(makeVestigium({ visibilitas: 'publica' }))  // never indexed
  const results = await store.search({ quaerendum: 'query', visibilitas: ['publica'] })
  assert.equal(results.length, 0)
})

test('search filters by auctorKey', async () => {
  const store = new MemoryVestigiorum(embedder({ 'q': v1, 'my prompt': v1 }))
  const mine = await store.create(makeVestigium({ auctorKey: ANIMA_KEY, promptum: 'my prompt', visibilitas: 'publica' }))
  const theirs = await store.create(makeVestigium({ auctorKey: OTHER_KEY, promptum: 'my prompt', visibilitas: 'publica' }))
  await store.indexPromptum(mine.id)
  await store.indexPromptum(theirs.id)
  const results = await store.search({ quaerendum: 'q', auctorKey: ANIMA_KEY })
  assert.ok(results.every(r => 'animaId' in r.vestigium.auctorKey && r.vestigium.auctorKey.animaId === 'anima-1'))
  assert.ok(!results.some(r => r.vestigium.id === theirs.id))
})

test('search without auctorKey only returns publica vestigia', async () => {
  const store = new MemoryVestigiorum(embedder({ 'q': v1, 'prompt': v1 }))
  const pub = await store.create(makeVestigium({ promptum: 'prompt', visibilitas: 'publica' }))
  const priv = await store.create(makeVestigium({ promptum: 'prompt', visibilitas: 'privata' }))
  await store.indexPromptum(pub.id)
  await store.indexPromptum(priv.id)
  const results = await store.search({ quaerendum: 'q' })
  assert.ok(results.some(r => r.vestigium.id === pub.id))
  assert.ok(!results.some(r => r.vestigium.id === priv.id))
})

test('search filters by auctorImpressio', async () => {
  const store = new MemoryVestigiorum(embedder({ 'q': v1, 'prompt': v1 }))
  const loved = await store.create(makeVestigium({ promptum: 'prompt', visibilitas: 'privata', auctorKey: ANIMA_KEY }))
  const unrated = await store.create(makeVestigium({ promptum: 'prompt', visibilitas: 'privata', auctorKey: ANIMA_KEY }))
  await store.indexPromptum(loved.id)
  await store.indexPromptum(unrated.id)
  await store.setAuctorImpressio(loved.id, ANIMA_KEY, 'amor')
  const results = await store.search({ quaerendum: 'q', auctorKey: ANIMA_KEY, auctorImpressio: ['amor'] })
  assert.ok(results.some(r => r.vestigium.id === loved.id))
  assert.ok(!results.some(r => r.vestigium.id === unrated.id))
})

test('search filters by modusId', async () => {
  const store = new MemoryVestigiorum(embedder({ 'q': v1, 'prompt': v1 }))
  const flux = await store.create(makeVestigium({ promptum: 'prompt', modusId: 'flux', visibilitas: 'publica' }))
  const sdxl = await store.create(makeVestigium({ promptum: 'prompt', modusId: 'sdxl', visibilitas: 'publica' }))
  await store.indexPromptum(flux.id)
  await store.indexPromptum(sdxl.id)
  const results = await store.search({ quaerendum: 'q', modusId: 'flux', visibilitas: ['publica'] })
  assert.ok(results.some(r => r.vestigium.id === flux.id))
  assert.ok(!results.some(r => r.vestigium.id === sdxl.id))
})

test('search filters by genus', async () => {
  const store = new MemoryVestigiorum(embedder({ 'q': v1, 'prompt': v1 }))
  const img = await store.create(makeVestigium({ promptum: 'prompt', genus: 'image', visibilitas: 'publica' }))
  const vid = await store.create(makeVestigium({ promptum: 'prompt', genus: 'video', visibilitas: 'publica' }))
  await store.indexPromptum(img.id)
  await store.indexPromptum(vid.id)
  const results = await store.search({ quaerendum: 'q', genus: 'image', visibilitas: ['publica'] })
  assert.ok(results.some(r => r.vestigium.id === img.id))
  assert.ok(!results.some(r => r.vestigium.id === vid.id))
})

test('search respects limit', async () => {
  const store = new MemoryVestigiorum(embedder({ 'q': v1, 'prompt': v1 }))
  for (let i = 0; i < 5; i++) {
    const v = await store.create(makeVestigium({ promptum: 'prompt', visibilitas: 'publica' }))
    await store.indexPromptum(v.id)
  }
  const results = await store.search({ quaerendum: 'q', visibilitas: ['publica'], limit: 3 })
  assert.equal(results.length, 3)
})

test('search enforces minSimilaritas cutoff', async () => {
  const store = new MemoryVestigiorum(embedder({ 'q': v1, 'prompt': v3 }))
  const v = await store.create(makeVestigium({ promptum: 'prompt', visibilitas: 'publica' }))
  await store.indexPromptum(v.id)
  const results = await store.search({ quaerendum: 'q', visibilitas: ['publica'], minSimilaritas: 0.5 })
  assert.equal(results.length, 0)
})

// ── search() — per: 'imago' ───────────────────────────────────────────────────

test('search per imago uses embeddingImago', async () => {
  const store = new MemoryVestigiorum(
    embedder({ 'dark scene': v1 }),
    imageEmbedder({ 'https://cdn.example.com/a.png': v1, 'https://cdn.example.com/b.png': v3 }),
  )
  const a = await store.create(makeVestigium({ imagoUrl: 'https://cdn.example.com/a.png', visibilitas: 'publica' }))
  const b = await store.create(makeVestigium({ imagoUrl: 'https://cdn.example.com/b.png', visibilitas: 'publica' }))
  await store.indexImago(a.id)
  await store.indexImago(b.id)
  const results = await store.search({ quaerendum: 'dark scene', per: 'imago', visibilitas: ['publica'] })
  assert.ok(results.some(r => r.vestigium.id === a.id))
  assert.ok(!results.some(r => r.vestigium.id === b.id))
})

// ── search() — per: 'intella' ─────────────────────────────────────────────────

test('search per intella uses embeddingIntella', async () => {
  const store = new MemoryVestigiorum(embedder({
    'portrait model': v1,
    'FLUX Schnell portrait': v1,
    'landscape diffusion model': v3,
  }))
  const a = await store.create(makeVestigium({ intellaDescription: 'FLUX Schnell portrait', visibilitas: 'publica' }))
  const b = await store.create(makeVestigium({ intellaDescription: 'landscape diffusion model', visibilitas: 'publica' }))
  await store.indexIntella(a.id)
  await store.indexIntella(b.id)
  const results = await store.search({ quaerendum: 'portrait model', per: 'intella', visibilitas: ['publica'] })
  assert.ok(results.some(r => r.vestigium.id === a.id))
  assert.ok(!results.some(r => r.vestigium.id === b.id))
})
