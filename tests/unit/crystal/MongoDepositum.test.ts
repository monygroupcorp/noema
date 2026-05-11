import { test, before, after, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { MongoClient, Collection } from 'mongodb'
import { MongoDepositum } from '../../../src/crystal/MongoDepositum.js'

const URI = process.env.MONGO_PASS ?? process.env.MONGODB_URI ?? 'mongodb://localhost:27017'
const DB = 'noemaplane_test'
const COL = 'deposita_unit'

let client: MongoClient, col: Collection, store: MongoDepositum

before(async () => {
  client = new MongoClient(URI)
  await client.connect()
  col = client.db(DB).collection(COL)
  await col.createIndex({ id: 1 }, { unique: true })
  await col.createIndex({ transactioHash: 1, chainId: 1 }, { unique: true })
  store = new MongoDepositum(col)
})
afterEach(async () => { await col.deleteMany({}) })
after(async () => {
  await client.db(DB).dropCollection(COL).catch(() => {})
  await client.close()
})

const base = {
  chainId: 1,
  transactioHash: '0xabc123',
  ab: '0xsender',
  ad: '0xvault',
  valor: 1_000_000_000_000_000n,
  confirmationes: 0,
  status: 'detectum' as const,
}

test('create returns depositum with id and natum', async () => {
  const d = await store.create(base)
  assert.ok(d.id)
  assert.ok(d.natum instanceof Date)
})

test('valor round-trips as bigint', async () => {
  const d = await store.create(base)
  const found = await store.find(d.id)
  assert.equal(found!.valor, 1_000_000_000_000_000n)
  assert.equal(typeof found!.valor, 'bigint')
})

test('find returns null for unknown', async () => {
  assert.equal(await store.find('nope'), null)
})

test('findByHash returns matching deposit', async () => {
  const d = await store.create(base)
  const found = await store.findByHash('0xabc123', 1)
  assert.equal(found?.id, d.id)
})

test('findByHash returns null for unknown hash', async () => {
  assert.equal(await store.findByHash('0xunknown', 1), null)
})

test('list filters by status', async () => {
  await store.create(base)
  const d2 = await store.create({ ...base, transactioHash: '0xdef456' })
  await store.update(d2.id, { status: 'confirmatum' })
  const confirmed = await store.list({ status: 'confirmatum' })
  assert.equal(confirmed.length, 1)
})

test('update changes status and sets signumId', async () => {
  const d = await store.create(base)
  const updated = await store.update(d.id, { status: 'processatum', signumId: 'sig-1', processatum: new Date() })
  assert.equal(updated.status, 'processatum')
  assert.equal(updated.signumId, 'sig-1')
  assert.ok(updated.processatum instanceof Date)
})
