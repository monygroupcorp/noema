import { test, before, after, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { MongoClient, Collection } from 'mongodb'
import { MongoDictum } from '../../../src/crystal/MongoDictum.js'
import type { Dictum } from '../../../src/types/colloquium.js'

const URI = process.env.MONGO_PASS ?? process.env.MONGODB_URI ?? 'mongodb://localhost:27017'
const DB = 'noemaplane_test'
const COL = 'dicta_unit'

let client: MongoClient
let col: Collection
let store: MongoDictum

function makeInput(overrides: Partial<Omit<Dictum, 'id' | 'natum'>> = {}) {
  return {
    colloquiumId: 'coll-abc',
    genus: 'user' as const,
    corpus: 'Hello, world!',
    signaIds: [],
    ...overrides,
  }
}

before(async () => {
  client = new MongoClient(URI)
  await client.connect()
  col = client.db(DB).collection(COL)
  await col.deleteMany({})
  await col.createIndex({ id: 1 }, { unique: true })
  store = new MongoDictum(col)
})

afterEach(async () => { await col.deleteMany({}) })
after(async () => {
  await client.db(DB).dropCollection(COL).catch(() => {})
  await client.close()
})

test('create returns dictum with id and natum', async () => {
  const d = await store.create(makeInput())
  assert.ok(d.id)
  assert.ok(d.natum instanceof Date)
})

test('create stores colloquiumId, genus, corpus, signaIds', async () => {
  const d = await store.create(makeInput())
  assert.equal(d.colloquiumId, 'coll-abc')
  assert.equal(d.genus, 'user')
  assert.equal(d.corpus, 'Hello, world!')
  assert.deepEqual(d.signaIds, [])
})

test('create stores optional actumId when provided', async () => {
  const d = await store.create(makeInput({ actumId: 'actum-1' }))
  assert.equal(d.actumId, 'actum-1')
})

test('findById returns null for unknown id', async () => {
  assert.equal(await store.findById('nope'), null)
})

test('findById returns created dictum', async () => {
  const created = await store.create(makeInput())
  const found = await store.findById(created.id)
  assert.equal(found?.id, created.id)
  assert.equal(found?.corpus, 'Hello, world!')
})

test('listByColloquium returns all dicta for colloquiumId', async () => {
  await store.create(makeInput({ colloquiumId: 'coll-abc' }))
  await store.create(makeInput({ colloquiumId: 'coll-abc', genus: 'agent', corpus: 'I am an agent.' }))
  await store.create(makeInput({ colloquiumId: 'coll-xyz' }))
  const results = await store.listByColloquium('coll-abc')
  assert.equal(results.length, 2)
  assert.ok(results.every(d => d.colloquiumId === 'coll-abc'))
})

test('listByColloquium returns empty array for unknown colloquiumId', async () => {
  const results = await store.listByColloquium('unknown-coll')
  assert.deepEqual(results, [])
})

test('update actumId on dictum', async () => {
  const d = await store.create(makeInput())
  const updated = await store.update(d.id, { actumId: 'actum-99' })
  assert.equal(updated.actumId, 'actum-99')
})

test('update signaIds on dictum', async () => {
  const d = await store.create(makeInput())
  const updated = await store.update(d.id, { signaIds: ['signum-1', 'signum-2'] })
  assert.deepEqual(updated.signaIds, ['signum-1', 'signum-2'])
})
