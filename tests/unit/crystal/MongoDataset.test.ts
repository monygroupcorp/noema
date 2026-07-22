import { test, before, after, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { MongoClient, Collection } from 'mongodb'
import { MongoDataset } from '../../../src/crystal/MongoDataset.js'

const URI = process.env.MONGO_PASS ?? process.env.MONGODB_URI ?? 'mongodb://localhost:27017'
const DB = 'noemaplane_test'
const COL = 'datasets_unit'

let client: MongoClient, col: Collection, store: MongoDataset

before(async () => {
  client = new MongoClient(URI)
  await client.connect()
  col = client.db(DB).collection(COL)
  await col.createIndex({ id: 1 }, { unique: true })
  store = new MongoDataset(col)
})
afterEach(async () => { await col.deleteMany({}) })
after(async () => {
  await client.db(DB).dropCollection(COL).catch(() => {})
  await client.close()
})

const base = {
  owner: 'anima-abc',
  name: 'frost-knight set',
  modality: 'image' as const,
  custody: 'sealed' as const,
  media: [{ id: 'm1', url: 'https://r2.example/m1.png', source: 'upload' as const, addedAt: new Date() }],
  captionsets: [{ id: 'c1', name: 'natural language', method: 'Florence-2', coverage: '1/1' }],
  versions: [{ v: '1.0.0', count: 1, when: new Date() }],
}

test('create returns a dataset with id, natum, mutatum', async () => {
  const d = await store.create(base)
  assert.ok(d.id)
  assert.ok(d.natum instanceof Date)
  assert.ok(d.mutatum instanceof Date)
  assert.equal(d.name, base.name)
})

test('find returns null for unknown', async () => {
  assert.equal(await store.find('nope'), null)
})

test('find returns the dataset', async () => {
  const d = await store.create(base)
  const found = await store.find(d.id)
  assert.equal(found?.id, d.id)
  assert.equal(found?.media.length, 1)
  assert.equal(found?.captionsets.length, 1)
})

test('list is owner-scoped — a caller never sees another owner\'s datasets', async () => {
  await store.create(base)
  await store.create({ ...base, owner: 'anima-stranger', name: 'not mine' })
  const page = await store.list({ owner: base.owner })
  assert.equal(page.entries.length, 1)
  assert.equal(page.entries[0].owner, base.owner)
})

test('listSummaries projects the same owner-scoped rows down to the thin shape', async () => {
  const d = await store.create(base)
  await store.create({ ...base, owner: 'anima-stranger', name: 'not mine' })
  const page = await store.listSummaries({ owner: base.owner })
  assert.equal(page.entries.length, 1)
  assert.deepEqual(Object.keys(page.entries[0]).sort(), ['id', 'images', 'name', 'updatedAt'].sort())
  assert.equal(page.entries[0].id, d.id)
  assert.equal(page.entries[0].images, 1)
})

test('list paginates with cursor, newest first', async () => {
  const a = await store.create(base)
  await new Promise((r) => setTimeout(r, 5))
  const b = await store.create({ ...base, name: 'second' })
  const page1 = await store.list({ owner: base.owner, limit: 1 })
  assert.equal(page1.entries.length, 1)
  assert.equal(page1.entries[0].id, b.id)
  assert.ok(page1.nextCursor)
  const page2 = await store.list({ owner: base.owner, limit: 1, cursor: page1.nextCursor })
  assert.equal(page2.entries.length, 1)
  assert.equal(page2.entries[0].id, a.id)
})
