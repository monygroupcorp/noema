import { test, before, after, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { MongoClient, Collection } from 'mongodb'
import { MongoTestimoniorum } from '../../../src/crystal/MongoTestimoniorum.js'

const URI = process.env.MONGO_PASS ?? process.env.MONGODB_URI ?? 'mongodb://localhost:27017'
const DB = 'noemaplane_test'
const COL = 'testimonia_unit'

let client: MongoClient, col: Collection, store: MongoTestimoniorum

before(async () => {
  client = new MongoClient(URI)
  await client.connect()
  col = client.db(DB).collection(COL)
  await col.createIndex({ id: 1 }, { unique: true })
  store = new MongoTestimoniorum(col)
})
afterEach(async () => { await col.deleteMany({}) })
after(async () => {
  await client.db(DB).dropCollection(COL).catch(() => {})
  await client.close()
})

const base = {
  chainId: 1,
  contractus: '0xNFT',
  tokenId: '42',
  possessor: '0xwallet',
  animaId: 'anima-abc',
  genus: 'signature' as const,
  testis: '0xsig',
  status: 'pendente' as const,
}

test('create returns testimonium with id and natum', async () => {
  const t = await store.create(base)
  assert.ok(t.id)
  assert.ok(t.natum instanceof Date)
})

test('find returns null for unknown', async () => {
  assert.equal(await store.find('nope'), null)
})

test('find returns the testimonium', async () => {
  const t = await store.create(base)
  const found = await store.find(t.id)
  assert.equal(found?.contractus, '0xNFT')
})

test('findByPossessor returns null for unknown', async () => {
  const t = await store.findByPossessor('0xunknown', '0xNFT')
  assert.equal(t, null)
})

test('findByPossessor returns matching attestation', async () => {
  const created = await store.create(base)
  const found = await store.findByPossessor('0xwallet', '0xNFT')
  assert.equal(found?.id, created.id)
})

test('findByPossessor does not match different contract', async () => {
  await store.create(base)
  const found = await store.findByPossessor('0xwallet', '0xOTHER')
  assert.equal(found, null)
})

test('listByAnima returns all confirmed attestations for an anima', async () => {
  await store.create({ ...base, tokenId: '1', status: 'confirmatum' })
  await store.create({ ...base, tokenId: '2', status: 'confirmatum' })
  await store.create({ ...base, tokenId: '3', status: 'pendente' })
  const list = await store.listByAnima('anima-abc')
  assert.equal(list.length, 2)
  assert.ok(list.every(t => t.status === 'confirmatum'))
})

test('listByAnima returns empty for unknown anima', async () => {
  assert.deepEqual(await store.listByAnima('ghost'), [])
})

test('update changes status and sets confirmatum', async () => {
  const t = await store.create(base)
  const now = new Date()
  const updated = await store.update(t.id, { status: 'confirmatum', confirmatum: now })
  assert.equal(updated.status, 'confirmatum')
  assert.ok(updated.confirmatum instanceof Date)
})
