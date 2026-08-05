import { test, before, after, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { MongoClient, Collection } from 'mongodb'
import { MongoCollectionum } from '../../../src/crystal/MongoCollectionum.js'

const URI = process.env.MONGO_PASS ?? process.env.MONGODB_URI ?? 'mongodb://localhost:27017'
const DB = 'noemaplane_test'
const COL = 'collectiones_unit2'

let client: MongoClient
let col: Collection
let store: MongoCollectionum

const base = {
  modusId: 'modus-flux',
  aditusBase: { steps: 20 },
  tractus: [{ porta: 'seed', valores: [{ value: 1 }, { value: 2 }, { value: 3 }] }],
  numerus: 3,
  by: { animaId: 'anima-abc' } as { animaId: string },
  concurrentia: 2,
  status: 'nascens' as const,
}

before(async () => {
  client = new MongoClient(URI)
  await client.connect()
  col = client.db(DB).collection(COL)
  await col.createIndex({ id: 1 }, { unique: true })
  store = new MongoCollectionum(col)
})

afterEach(async () => {
  await col.deleteMany({})
})

after(async () => {
  await client.db(DB).dropCollection(COL).catch(() => {})
  await client.close()
})

// ── Test 1: create returns Collectio with generated id and natum set ──────────

test('create returns collectio with generated id and natum set', async () => {
  const before = new Date()
  const c = await store.create(base)
  assert.ok(c.id, 'id should be set')
  assert.ok(c.natum instanceof Date, 'natum should be a Date')
  assert.ok(c.natum >= before, 'natum should be >= test start time')
  assert.deepEqual(c.acta, [])
  assert.equal(c.completae, 0)
  assert.equal(c.fractae, 0)
  assert.equal(c.impetusTotal, 0n)
})

// ── Test 2: find returns null for unknown id ──────────────────────────────────

test('find returns null for unknown id', async () => {
  const result = await store.find('no-such-id')
  assert.equal(result, null)
})

// ── Test 3: find returns created Collectio with impetusTotal as bigint ────────

test('find returns created collectio with impetusTotal as bigint', async () => {
  const c = await store.create(base)
  const found = await store.find(c.id)
  assert.ok(found, 'should find created collectio')
  assert.equal(found.id, c.id)
  assert.equal(typeof found.impetusTotal, 'bigint')
  assert.equal(found.impetusTotal, 0n)
  assert.ok(found.natum instanceof Date)
})

// ── Test 4: update patches status ────────────────────────────────────────────

test('update patches status', async () => {
  const c = await store.create(base)
  const updated = await store.update(c.id, { status: 'agens' })
  assert.equal(updated.status, 'agens')
  const found = await store.find(c.id)
  assert.equal(found?.status, 'agens')
})

// ── Test 5: update patches acta, completae, fractae ──────────────────────────

test('update patches acta, completae, fractae', async () => {
  const c = await store.create(base)
  const updated = await store.update(c.id, {
    acta: ['actum-1', 'actum-2'],
    completae: 1,
    fractae: 1,
  })
  assert.deepEqual(updated.acta, ['actum-1', 'actum-2'])
  assert.equal(updated.completae, 1)
  assert.equal(updated.fractae, 1)
})

// ── Test 6: update patches impetusTotal (bigint round-trip through DB) ────────

test('update patches impetusTotal and round-trips as bigint', async () => {
  const c = await store.create(base)
  await store.update(c.id, { impetusTotal: 999_000_000_000n })
  const found = await store.find(c.id)
  assert.ok(found)
  assert.equal(typeof found.impetusTotal, 'bigint')
  assert.equal(found.impetusTotal, 999_000_000_000n)
})

// ── Test 7: list returns all collectiones ─────────────────────────────────────

test('list returns all collectiones', async () => {
  await store.create(base)
  await store.create({ ...base, modusId: 'modus-sdxl' })
  const all = await store.list()
  assert.equal(all.length, 2)
})

// ── Test 8: list filters by status ───────────────────────────────────────────

test('list with status filter returns only matching collectiones', async () => {
  await store.create(base)
  const c2 = await store.create({ ...base, modusId: 'modus-sdxl' })
  await store.update(c2.id, { status: 'agens' })

  const agens = await store.list({ status: 'agens' })
  assert.equal(agens.length, 1)
  assert.equal(agens[0].id, c2.id)

  const nascens = await store.list({ status: 'nascens' })
  assert.equal(nascens.length, 1)
})
