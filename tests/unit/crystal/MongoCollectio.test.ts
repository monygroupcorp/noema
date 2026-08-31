import { test, before, after, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { MongoClient, Collection } from 'mongodb'
import { MongoCollectio } from '../../../src/crystal/MongoCollectio.js'

const URI = process.env.MONGO_PASS ?? process.env.MONGODB_URI ?? 'mongodb://localhost:27017'
const DB = 'noemaplane_test'
const COL = 'collectiones_unit'

let client: MongoClient, col: Collection, store: MongoCollectio

before(async () => {
  client = new MongoClient(URI)
  await client.connect()
  col = client.db(DB).collection(COL)
  await col.createIndex({ id: 1 }, { unique: true })
  store = new MongoCollectio(col)
})
afterEach(async () => { await col.deleteMany({}) })
after(async () => {
  await client.db(DB).dropCollection(COL).catch(() => {})
  await client.close()
})

const base = {
  modusId: 'modus-flux',
  aditusBase: { steps: 20 },
  // `Tractus.valores` is `TraitValor[]` — each option is an object carrying `value`.
  tractus: [{ porta: 'seed', valores: [{ value: 1 }, { value: 2 }, { value: 3 }] }],
  numerus: 3,
  by: { animaId: 'anima-abc' } as { animaId: string },
  concurrentia: 2,
  status: 'nascens' as const,
  provenanceHash: `sha256:${'0'.repeat(64)}`,
}

test('create returns collectio with id, natum, acta=[], completae=0, fractae=0, reiectae=0, impetusTotal=0n', async () => {
  const c = await store.create(base)
  assert.ok(c.id)
  assert.ok(c.natum instanceof Date)
  assert.deepEqual(c.acta, [])
  assert.equal(c.completae, 0)
  assert.equal(c.fractae, 0)
  // The counters are the store's to seed — `reiectae` included. It is half of the
  // CollectioCursor's dispatch budget (`numerus + reiectae`), so an unseeded one makes that
  // sum NaN and the collection never dispatches a piece (noema-373).
  assert.equal(c.reiectae, 0)
  assert.equal(c.impetusTotal, 0n)
  const found = await store.find(c.id)
  assert.equal(found?.reiectae, 0)
})

test('impetusTotal round-trips as bigint', async () => {
  const c = await store.create(base)
  const updated = await store.update(c.id, { impetusTotal: 500n })
  const found = await store.find(c.id)
  assert.equal(found!.impetusTotal, 500n)
  assert.equal(typeof found!.impetusTotal, 'bigint')
})

test('find returns null for unknown', async () => {
  assert.equal(await store.find('nope'), null)
})

test('find returns the collectio', async () => {
  const c = await store.create(base)
  const found = await store.find(c.id)
  assert.equal(found?.id, c.id)
})

test('list filters by status', async () => {
  await store.create(base)
  const c2 = await store.create(base)
  await store.update(c2.id, { status: 'agens' })
  const agens = await store.list({ status: 'agens' })
  assert.equal(agens.length, 1)
})

test('update changes status and completae', async () => {
  const c = await store.create(base)
  const updated = await store.update(c.id, { status: 'agens', completae: 1, acta: ['actum-1'] })
  assert.equal(updated.status, 'agens')
  assert.equal(updated.completae, 1)
  assert.deepEqual(updated.acta, ['actum-1'])
})

test('update sets completum when completa', async () => {
  const c = await store.create(base)
  const now = new Date()
  const updated = await store.update(c.id, { status: 'completa', completum: now })
  assert.ok(updated.completum instanceof Date)
})
