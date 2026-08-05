import { test, before, after, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { MongoClient, Collection } from 'mongodb'
import { MongoSolutio } from '../../../src/crystal/MongoSolutio.js'

const URI = process.env.MONGO_PASS ?? process.env.MONGODB_URI ?? 'mongodb://localhost:27017'
const DB = 'noemaplane_test'
const COL = 'solutiones_unit'

let client: MongoClient, col: Collection, store: MongoSolutio

before(async () => {
  client = new MongoClient(URI)
  await client.connect()
  col = client.db(DB).collection(COL)
  await col.createIndex({ id: 1 }, { unique: true })
  store = new MongoSolutio(col)
})
afterEach(async () => { await col.deleteMany({}) })
after(async () => {
  await client.db(DB).dropCollection(COL).catch(() => {})
  await client.close()
})

const base = {
  schema: 'exact',
  network: 'base',
  payload: '0xpayload',
  authoritas: '0xauthority',
  valor: 1_000_000n,
  status: 'recepta' as const,
}

test('create returns solutio with id and natum', async () => {
  const s = await store.create(base)
  assert.ok(s.id)
  assert.ok(s.natum instanceof Date)
})

test('valor round-trips as bigint', async () => {
  const s = await store.create(base)
  const found = await store.find(s.id)
  assert.equal(found!.valor, 1_000_000n)
  assert.equal(typeof found!.valor, 'bigint')
})

test('find returns null for unknown', async () => {
  assert.equal(await store.find('nope'), null)
})

test('find returns the solutio', async () => {
  const s = await store.create(base)
  const found = await store.find(s.id)
  assert.equal(found?.network, 'base')
})

test('update changes status and sets signumId', async () => {
  const s = await store.create(base)
  const updated = await store.update(s.id, { status: 'processata', signumId: 'sig-x', processata: new Date() })
  assert.equal(updated.status, 'processata')
  assert.equal(updated.signumId, 'sig-x')
  assert.ok(updated.processata instanceof Date)
})
