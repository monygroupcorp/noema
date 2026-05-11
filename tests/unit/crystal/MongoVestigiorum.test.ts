import { test, before, after, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { MongoClient, Collection } from 'mongodb'
import { MongoVestigiorum } from '../../../src/crystal/MongoVestigiorum.js'
import type { Vestigium } from '../../../src/types/vestigium.js'

const URI = process.env.MONGO_PASS ?? process.env.MONGODB_URI ?? 'mongodb://localhost:27017'
const DB = 'noemaplane_test'
const COL = 'vestigia_unit'

let client: MongoClient
let col: Collection
let store: MongoVestigiorum
// Deterministic embed: maps text → [1,0,0], except 'unrelated' → [0,0,1]
const mockEmbed = async (text: string): Promise<number[]> => {
  if (text.includes('unrelated')) return [0, 0, 1]
  if (text.includes('other')) return [0, 1, 0]
  return [1, 0, 0]
}

function makeInput(overrides: Partial<Omit<Vestigium, 'id' | 'natum' | 'mutatum' | 'embedding' | 'impressio'>> = {}) {
  return {
    modusId: 'modus-flux',
    promptum: 'a portrait of a cat',
    summarium: 'generated image',
    genus: 'image' as const,
    visibilitas: 'privata' as const,
    auctorKey: { animaId: 'anima-abc' } as { animaId: string },
    ...overrides,
  }
}

before(async () => {
  client = new MongoClient(URI)
  await client.connect()
  col = client.db(DB).collection(COL)
  await col.createIndex({ id: 1 }, { unique: true })
  store = new MongoVestigiorum(col, mockEmbed)
})

afterEach(async () => {
  await col.deleteMany({})
})

after(async () => {
  await client.db(DB).dropCollection(COL).catch(() => {})
  await client.close()
})

// ── create ────────────────────────────────────────────────────────────────────

test('create returns vestigium with id, natum, mutatum', async () => {
  const v = await store.create(makeInput())
  assert.ok(v.id)
  assert.ok(v.natum instanceof Date)
  assert.ok(v.mutatum instanceof Date)
})

test('create initialises impressio to zero counts', async () => {
  const v = await store.create(makeInput())
  assert.deepEqual(v.impressio, { amor: 0, risus: 0, maeror: 0 })
})

test('create stores all fields correctly', async () => {
  const v = await store.create(makeInput({
    promptum: 'futuristic city',
    summarium: 'neon lights',
    genus: 'image',
    visibilitas: 'publica',
    modusId: 'modus-sdxl',
    signacula: ['city', 'neon'],
  }))
  assert.equal(v.promptum, 'futuristic city')
  assert.equal(v.summarium, 'neon lights')
  assert.equal(v.genus, 'image')
  assert.equal(v.visibilitas, 'publica')
  assert.deepEqual(v.signacula, ['city', 'neon'])
})

test('create with animaId auctorKey round-trips correctly', async () => {
  const v = await store.create(makeInput({ auctorKey: { animaId: 'anima-xyz' } }))
  assert.deepEqual(v.auctorKey, { animaId: 'anima-xyz' })
})

test('create with arcanumHash auctorKey round-trips correctly', async () => {
  const v = await store.create(makeInput({ auctorKey: { arcanumHash: 'myhash' } }))
  assert.deepEqual(v.auctorKey, { arcanumHash: 'myhash' })
})

test('create has no embedding initially', async () => {
  const v = await store.create(makeInput())
  assert.equal(v.embedding, undefined)
})

// ── findById ──────────────────────────────────────────────────────────────────

test('findById returns null for unknown id', async () => {
  const v = await store.findById('nope')
  assert.equal(v, null)
})

test('findById returns the vestigium by id', async () => {
  const created = await store.create(makeInput({ promptum: 'find me' }))
  const found = await store.findById(created.id)
  assert.ok(found)
  assert.equal(found.id, created.id)
  assert.equal(found.promptum, 'find me')
})

// ── forIdentity ───────────────────────────────────────────────────────────────

test('forIdentity returns vestigia for animaId', async () => {
  await store.create(makeInput({ auctorKey: { animaId: 'anima-a' } }))
  await store.create(makeInput({ auctorKey: { animaId: 'anima-a' } }))
  const results = await store.forIdentity({ animaId: 'anima-a' })
  assert.equal(results.length, 2)
})

test('forIdentity returns vestigia for arcanumHash', async () => {
  await store.create(makeInput({ auctorKey: { arcanumHash: 'hash1' } }))
  const results = await store.forIdentity({ arcanumHash: 'hash1' })
  assert.equal(results.length, 1)
})

test('forIdentity excludes other identities', async () => {
  await store.create(makeInput({ auctorKey: { animaId: 'anima-a' } }))
  await store.create(makeInput({ auctorKey: { animaId: 'anima-b' } }))
  const results = await store.forIdentity({ animaId: 'anima-a' })
  assert.equal(results.length, 1)
  assert.deepEqual(results[0].auctorKey, { animaId: 'anima-a' })
})

test('forIdentity returns most recent first', async () => {
  const a = await store.create(makeInput({ promptum: 'first' }))
  await new Promise(r => setTimeout(r, 5))
  const b = await store.create(makeInput({ promptum: 'second' }))
  const results = await store.forIdentity({ animaId: 'anima-abc' })
  assert.equal(results[0].id, b.id)
  assert.equal(results[1].id, a.id)
})

test('forIdentity respects limit', async () => {
  await store.create(makeInput())
  await store.create(makeInput())
  await store.create(makeInput())
  const results = await store.forIdentity({ animaId: 'anima-abc' }, 2)
  assert.equal(results.length, 2)
})

// ── update ────────────────────────────────────────────────────────────────────

test('update changes visibilitas', async () => {
  const v = await store.create(makeInput({ visibilitas: 'privata' }))
  const updated = await store.update(v.id, { visibilitas: 'publica' })
  assert.equal(updated.visibilitas, 'publica')
})

test('update changes signacula', async () => {
  const v = await store.create(makeInput())
  const updated = await store.update(v.id, { signacula: ['portrait', 'oil'] })
  assert.deepEqual(updated.signacula, ['portrait', 'oil'])
})

test('update stamps mutatum later than natum', async () => {
  const v = await store.create(makeInput())
  await new Promise(r => setTimeout(r, 5))
  const updated = await store.update(v.id, { visibilitas: 'communis' })
  assert.ok(updated.mutatum > updated.natum)
})

// ── setAuctorImpressio ────────────────────────────────────────────────────────

test('setAuctorImpressio sets impressio on own vestigium', async () => {
  const v = await store.create(makeInput({ auctorKey: { animaId: 'anima-me' } }))
  const updated = await store.setAuctorImpressio(v.id, { animaId: 'anima-me' }, 'amor')
  assert.equal(updated.impressio.auctorImpressio, 'amor')
})

test('setAuctorImpressio changes impressio to different kind', async () => {
  const v = await store.create(makeInput({ auctorKey: { animaId: 'anima-me' } }))
  await store.setAuctorImpressio(v.id, { animaId: 'anima-me' }, 'amor')
  const updated = await store.setAuctorImpressio(v.id, { animaId: 'anima-me' }, 'risus')
  assert.equal(updated.impressio.auctorImpressio, 'risus')
})

test('setAuctorImpressio null clears the impressio', async () => {
  const v = await store.create(makeInput({ auctorKey: { animaId: 'anima-me' } }))
  await store.setAuctorImpressio(v.id, { animaId: 'anima-me' }, 'amor')
  const cleared = await store.setAuctorImpressio(v.id, { animaId: 'anima-me' }, null)
  assert.equal(cleared.impressio.auctorImpressio, undefined)
})

test('setAuctorImpressio rejects wrong auctorKey', async () => {
  const v = await store.create(makeInput({ auctorKey: { animaId: 'anima-me' } }))
  await assert.rejects(
    () => store.setAuctorImpressio(v.id, { animaId: 'anima-impostor' }, 'amor'),
    /auctorKey/i
  )
})

// ── rate ──────────────────────────────────────────────────────────────────────

test('rate increments amor count', async () => {
  const v = await store.create(makeInput({ auctorKey: { animaId: 'anima-creator' } }))
  await store.rate(v.id, { animaId: 'anima-viewer' }, 'amor')
  const found = await store.findById(v.id)
  assert.equal(found!.impressio.amor, 1)
})

test('rate increments maeror count', async () => {
  const v = await store.create(makeInput({ auctorKey: { animaId: 'anima-creator' } }))
  await store.rate(v.id, { animaId: 'anima-viewer' }, 'maeror')
  const found = await store.findById(v.id)
  assert.equal(found!.impressio.maeror, 1)
})

test('rate rejects author rating their own vestigium', async () => {
  const v = await store.create(makeInput({ auctorKey: { animaId: 'anima-creator' } }))
  await assert.rejects(
    () => store.rate(v.id, { animaId: 'anima-creator' }, 'amor'),
    /setAuctorImpressio/
  )
})

test('rate rejects double-rating from same rater', async () => {
  const v = await store.create(makeInput({ auctorKey: { animaId: 'anima-creator' } }))
  await store.rate(v.id, { animaId: 'anima-viewer' }, 'amor')
  await assert.rejects(
    () => store.rate(v.id, { animaId: 'anima-viewer' }, 'amor'),
    /double-rating/
  )
})

test('rate allows multiple raters', async () => {
  const v = await store.create(makeInput({ auctorKey: { animaId: 'anima-creator' } }))
  await store.rate(v.id, { animaId: 'anima-a' }, 'amor')
  await store.rate(v.id, { animaId: 'anima-b' }, 'amor')
  const found = await store.findById(v.id)
  assert.equal(found!.impressio.amor, 2)
})

// ── index + search ────────────────────────────────────────────────────────────

test('index stores embedding on the vestigium', async () => {
  const v = await store.create(makeInput({ promptum: 'cat portrait' }))
  assert.equal(v.embedding, undefined)
  await store.index(v.id)
  const indexed = await store.findById(v.id)
  assert.ok(Array.isArray(indexed!.embedding))
  assert.equal(indexed!.embedding!.length, 3)
})

test('search returns vestigium with similar embedding above threshold', async () => {
  const v = await store.create(makeInput({ visibilitas: 'publica' }))
  await store.index(v.id)
  // mockEmbed('cat portrait') = [1,0,0], query 'portrait' also = [1,0,0]
  const results = await store.search({ quaerendum: 'portrait', minSimilaritas: 0.9 })
  assert.equal(results.length, 1)
  assert.equal(results[0].vestigium.id, v.id)
  assert.ok(results[0].similaritas > 0.9)
})

test('search excludes vestigium below minSimilaritas', async () => {
  const v = await store.create(makeInput({ visibilitas: 'publica' }))
  await store.index(v.id)
  // 'unrelated' → [0,0,1], cosine([1,0,0],[0,0,1]) = 0
  const results = await store.search({ quaerendum: 'unrelated', minSimilaritas: 0.5 })
  assert.equal(results.length, 0)
})

test('search filters by auctorKey', async () => {
  const mine = await store.create(makeInput({ auctorKey: { animaId: 'anima-me' }, visibilitas: 'privata' }))
  const theirs = await store.create(makeInput({ auctorKey: { animaId: 'anima-other' }, visibilitas: 'publica' }))
  await store.index(mine.id)
  await store.index(theirs.id)
  const results = await store.search({ quaerendum: 'portrait', auctorKey: { animaId: 'anima-me' }, minSimilaritas: 0.5 })
  assert.equal(results.length, 1)
  assert.equal(results[0].vestigium.id, mine.id)
})

test('search without auctorKey returns only publica', async () => {
  const pub = await store.create(makeInput({ visibilitas: 'publica' }))
  const priv = await store.create(makeInput({ visibilitas: 'privata' }))
  await store.index(pub.id)
  await store.index(priv.id)
  const results = await store.search({ quaerendum: 'portrait', minSimilaritas: 0.5 })
  assert.equal(results.length, 1)
  assert.equal(results[0].vestigium.id, pub.id)
})
