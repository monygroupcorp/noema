import { test, before, after, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { MongoClient, Collection } from 'mongodb'
import { MongoPetitio } from '../../../src/crystal/MongoPetitio.js'

const URI = process.env.MONGO_PASS ?? process.env.MONGODB_URI ?? 'mongodb://localhost:27017'
const DB = 'noemaplane_test'
const COL = 'petitiones_unit'

let client: MongoClient, col: Collection, store: MongoPetitio

before(async () => {
  client = new MongoClient(URI)
  await client.connect()
  col = client.db(DB).collection(COL)
  await col.createIndex({ id: 1 }, { unique: true })
  store = new MongoPetitio(col)
})
afterEach(async () => { await col.deleteMany({}) })
after(async () => {
  await client.db(DB).dropCollection(COL).catch(() => {})
  await client.close()
})

function makeBase(overrides = {}) {
  return {
    animaId: 'anima-abc',
    chainId: 1,
    valuta: 37_000_000_000_000n,
    ad: '0xvault',
    status: 'expectans' as const,
    expirat: new Date(Date.now() + 3_600_000),
    ...overrides,
  }
}

test('create returns petitio with id and natum', async () => {
  const p = await store.create(makeBase())
  assert.ok(p.id)
  assert.ok(p.natum instanceof Date)
})

test('valuta round-trips as bigint', async () => {
  const p = await store.create(makeBase())
  const found = await store.find(p.id)
  assert.equal(found!.valuta, 37_000_000_000_000n)
  assert.equal(typeof found!.valuta, 'bigint')
})

test('find returns null for unknown', async () => {
  assert.equal(await store.find('nope'), null)
})

test('findExpectans returns active expectans petitio for animaId', async () => {
  const p = await store.create(makeBase())
  const found = await store.findExpectans('anima-abc')
  assert.equal(found?.id, p.id)
})

test('findExpectans returns null for unknown animaId', async () => {
  assert.equal(await store.findExpectans('nobody'), null)
})

test('findExpectans excludes non-expectans petitiones', async () => {
  const p = await store.create(makeBase())
  await store.update(p.id, { status: 'confirmata', walletAddress: '0xw', confirmata: new Date() })
  assert.equal(await store.findExpectans('anima-abc'), null)
})

test('update changes status and sets walletAddress', async () => {
  const p = await store.create(makeBase())
  const updated = await store.update(p.id, { status: 'confirmata', walletAddress: '0xwallet', confirmata: new Date() })
  assert.equal(updated.status, 'confirmata')
  assert.equal(updated.walletAddress, '0xwallet')
})

test('expireStale expires expectans petitiones past expirat', async () => {
  const past = new Date(Date.now() - 3_600_000)
  await store.create(makeBase({ expirat: past }))
  await store.create(makeBase({ expirat: past, animaId: 'anima-xyz' }))
  const count = await store.expireStale(new Date())
  assert.equal(count, 2)
  assert.equal(await store.findExpectans('anima-abc'), null)
})

test('expireStale does not expire future petitiones', async () => {
  await store.create(makeBase()) // expirat = future
  const count = await store.expireStale(new Date())
  assert.equal(count, 0)
})
