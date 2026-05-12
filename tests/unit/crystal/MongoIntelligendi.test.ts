import { test, before, after, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { MongoClient, Collection } from 'mongodb'
import { MongoIntelligendi } from '../../../src/crystal/MongoIntelligendi.js'
import type { Intelligens } from '../../../src/types/intelligendi.js'

const URI = process.env.MONGO_PASS ?? process.env.MONGODB_URI ?? 'mongodb://localhost:27017'
const DB = 'noemaplane_test'
const COL = 'intelligendi_unit'

let client: MongoClient
let col: Collection
let store: MongoIntelligendi

function makeInput(overrides: Partial<Omit<Intelligens, 'id' | 'natum' | 'mutatum' | 'stellae'>> = {}): Omit<Intelligens, 'id' | 'natum' | 'mutatum' | 'stellae'> {
  return {
    nomen: 'Flux LoRA v1',
    genus: 'lora',
    basis: 'flux',
    canonica: false,
    privacy: 'public',
    notae: ['style', 'portrait'],
    locatio: 'r2://weights/flux-lora-v1.safetensors',
    ...overrides,
  }
}

before(async () => {
  client = new MongoClient(URI)
  await client.connect()
  col = client.db(DB).collection(COL)
  await col.createIndex({ id: 1 }, { unique: true })
  store = new MongoIntelligendi(col)
})

afterEach(async () => {
  await col.deleteMany({})
})

after(async () => {
  await client.db(DB).dropCollection(COL).catch(() => {})
  await client.close()
})

// ── create ────────────────────────────────────────────────────────────────────

test('create returns intelligens with id, natum, mutatum, stellae=0', async () => {
  const i = await store.create(makeInput())
  assert.ok(i.id)
  assert.ok(i.natum instanceof Date)
  assert.ok(i.mutatum instanceof Date)
  assert.equal(i.stellae, 0)
})

test('create stores nomen, genus, basis, locatio, canonica, privacy', async () => {
  const i = await store.create(makeInput())
  assert.equal(i.nomen, 'Flux LoRA v1')
  assert.equal(i.genus, 'lora')
  assert.equal(i.basis, 'flux')
  assert.equal(i.locatio, 'r2://weights/flux-lora-v1.safetensors')
  assert.equal(i.canonica, false)
  assert.equal(i.privacy, 'public')
})

// ── find ──────────────────────────────────────────────────────────────────────

test('find returns null for unknown id', async () => {
  const result = await store.find('no-such-id')
  assert.equal(result, null)
})

test('find returns created intelligens', async () => {
  const created = await store.create(makeInput())
  const found = await store.find(created.id)
  assert.ok(found)
  assert.equal(found.id, created.id)
  assert.equal(found.nomen, created.nomen)
})

// ── list ──────────────────────────────────────────────────────────────────────

test('list returns all when no filter', async () => {
  await store.create(makeInput({ nomen: 'LoRA A', locatio: 'r2://a' }))
  await store.create(makeInput({ nomen: 'LoRA B', locatio: 'r2://b', genus: 'checkpoint' }))
  const all = await store.list()
  assert.equal(all.length, 2)
})

test('list filters by genus', async () => {
  await store.create(makeInput({ nomen: 'LoRA A', locatio: 'r2://a', genus: 'lora' }))
  await store.create(makeInput({ nomen: 'Checkpoint B', locatio: 'r2://b', genus: 'checkpoint' }))
  const loras = await store.list({ genus: 'lora' })
  assert.equal(loras.length, 1)
  assert.equal(loras[0].nomen, 'LoRA A')
})

test('list filters by basis', async () => {
  await store.create(makeInput({ nomen: 'Flux LoRA', locatio: 'r2://a', basis: 'flux' }))
  await store.create(makeInput({ nomen: 'SDXL LoRA', locatio: 'r2://b', basis: 'sdxl' }))
  const fluxOnly = await store.list({ basis: 'flux' })
  assert.equal(fluxOnly.length, 1)
  assert.equal(fluxOnly[0].basis, 'flux')
})

test('list filters by canonica', async () => {
  await store.create(makeInput({ nomen: 'Canon', locatio: 'r2://a', canonica: true }))
  await store.create(makeInput({ nomen: 'Community', locatio: 'r2://b', canonica: false }))
  const canonical = await store.list({ canonica: true })
  assert.equal(canonical.length, 1)
  assert.equal(canonical[0].nomen, 'Canon')
})

test('list filters by privacy', async () => {
  await store.create(makeInput({ nomen: 'Public LoRA', locatio: 'r2://a', privacy: 'public' }))
  await store.create(makeInput({ nomen: 'Private LoRA', locatio: 'r2://b', privacy: 'private' }))
  const publicOnly = await store.list({ privacy: 'public' })
  assert.equal(publicOnly.length, 1)
  assert.equal(publicOnly[0].privacy, 'public')
})

test('list filters by auctor', async () => {
  await store.create(makeInput({ nomen: 'Mine', locatio: 'r2://a', auctor: 'anima-abc' }))
  await store.create(makeInput({ nomen: 'Theirs', locatio: 'r2://b', auctor: 'anima-xyz' }))
  const mine = await store.list({ auctor: 'anima-abc' })
  assert.equal(mine.length, 1)
  assert.equal(mine[0].nomen, 'Mine')
})

// ── update ────────────────────────────────────────────────────────────────────

test('update changes nomen and stamps mutatum', async () => {
  const created = await store.create(makeInput())
  const before = created.mutatum
  // small delay to ensure mutatum differs
  await new Promise(r => setTimeout(r, 2))
  const updated = await store.update(created.id, { nomen: 'Flux LoRA v2' })
  assert.equal(updated.nomen, 'Flux LoRA v2')
  assert.ok(updated.mutatum > before)
})

test('update adds verba (trigger words) to a LoRA', async () => {
  const created = await store.create(makeInput({ genus: 'lora' }))
  const updated = await store.update(created.id, { verba: ['flux-portrait', 'fp-v1'] })
  assert.deepEqual(updated.verba, ['flux-portrait', 'fp-v1'])
})

test('update throws for unknown id', async () => {
  await assert.rejects(
    () => store.update('no-such-id', { nomen: 'New Name' }),
    /not found/i
  )
})

// ── search ────────────────────────────────────────────────────────────────────

test('search matches by nomen substring', async () => {
  await store.create(makeInput({ nomen: 'Cinematic Portrait LoRA', locatio: 'r2://a', notae: [] }))
  await store.create(makeInput({ nomen: 'Landscape Sketch', locatio: 'r2://b', notae: [] }))
  const results = await store.search('Portrait')
  assert.equal(results.length, 1)
  assert.equal(results[0].nomen, 'Cinematic Portrait LoRA')
})

test('search matches by notae entry', async () => {
  await store.create(makeInput({ nomen: 'Anime LoRA', locatio: 'r2://a', notae: ['anime', 'cel-shading'] }))
  await store.create(makeInput({ nomen: 'Realism Lora', locatio: 'r2://b', notae: ['photo', 'realistic'] }))
  const results = await store.search('anime')
  assert.equal(results.length, 1)
  assert.equal(results[0].nomen, 'Anime LoRA')
})

test('search returns empty for no match', async () => {
  await store.create(makeInput({ nomen: 'Portrait LoRA', locatio: 'r2://a' }))
  const results = await store.search('xyznomatch')
  assert.equal(results.length, 0)
})
