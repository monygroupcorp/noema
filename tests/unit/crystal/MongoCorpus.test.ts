import { test, before, after, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { MongoClient, Collection } from 'mongodb'
import { MongoCorpus } from '../../../src/crystal/MongoCorpus.js'

const URI = process.env.MONGO_PASS ?? process.env.MONGODB_URI ?? 'mongodb://localhost:27017'
const DB = 'noemaplane_test'
const COL = 'corpora_unit'

let client: MongoClient, col: Collection, store: MongoCorpus

before(async () => {
  client = new MongoClient(URI)
  await client.connect()
  col = client.db(DB).collection(COL)
  await col.createIndex({ id: 1 }, { unique: true })
  store = new MongoCorpus(col)
})
afterEach(async () => { await col.deleteMany({}) })
after(async () => {
  await client.db(DB).dropCollection(COL).catch(() => {})
  await client.close()
})

test('create returns corpus with id, natum, mutatum', async () => {
  const c = await store.create({ nomen: 'Portraits', genus: 'imagines', auctor: 'anima-a', exemplaria: [], numerus: 0, status: 'nascens' })
  assert.ok(c.id)
  assert.ok(c.natum instanceof Date)
  assert.ok(c.mutatum instanceof Date)
})

test('find returns null for unknown id', async () => {
  assert.equal(await store.find('nope'), null)
})

test('find returns the corpus', async () => {
  const c = await store.create({ nomen: 'Test', genus: 'textus', auctor: 'anima-a', exemplaria: [], numerus: 0, status: 'nascens' })
  const found = await store.find(c.id)
  assert.equal(found?.id, c.id)
  assert.equal(found?.nomen, 'Test')
})

test('list returns all when no filter', async () => {
  await store.create({ nomen: 'A', genus: 'imagines', auctor: 'anima-a', exemplaria: [], numerus: 0, status: 'nascens' })
  await store.create({ nomen: 'B', genus: 'textus', auctor: 'anima-b', exemplaria: [], numerus: 0, status: 'nascens' })
  assert.equal((await store.list()).length, 2)
})

test('list filters by auctor', async () => {
  await store.create({ nomen: 'Mine', genus: 'imagines', auctor: 'anima-a', exemplaria: [], numerus: 0, status: 'nascens' })
  await store.create({ nomen: 'Theirs', genus: 'imagines', auctor: 'anima-b', exemplaria: [], numerus: 0, status: 'nascens' })
  const mine = await store.list({ auctor: 'anima-a' })
  assert.equal(mine.length, 1)
  assert.equal(mine[0].auctor, 'anima-a')
})

test('update changes status and stamps mutatum', async () => {
  const c = await store.create({ nomen: 'X', genus: 'imagines', auctor: 'anima-a', exemplaria: [], numerus: 0, status: 'nascens' })
  await new Promise(r => setTimeout(r, 5))
  const updated = await store.update(c.id, { status: 'validatus' })
  assert.equal(updated.status, 'validatus')
  assert.ok(updated.mutatum > updated.natum)
})

test('update changes exemplaria and numerus', async () => {
  const c = await store.create({ nomen: 'X', genus: 'imagines', auctor: 'anima-a', exemplaria: [], numerus: 0, status: 'nascens' })
  const ex = [{ ref: 'r2://img/1.png', genus: 'image/png' }]
  const updated = await store.update(c.id, { exemplaria: ex, numerus: 1 })
  assert.equal(updated.exemplaria.length, 1)
  assert.equal(updated.numerus, 1)
})
