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

// ── Captionset write + edit seam ─────────────────────────────────────────────
//
// NOT hermetic: this file opens a MongoClient in `before`, so it is not in the
// `test:hermetic` glob and must not be added to it. The hermetic proof of this
// behaviour lives in tests/unit/allocutio/api/datasetsRoutes.test.ts.

const twoMedia = {
  ...base,
  media: [
    { id: 'm1', url: 'https://r2.example/m1.png', source: 'upload' as const, addedAt: new Date() },
    { id: 'm2', url: 'https://r2.example/m2.png', source: 'upload' as const, addedAt: new Date() },
  ],
  captionsets: [],
}

test('addCaptionset attaches a captionset, derives coverage, and bumps mutatum', async () => {
  const d = await store.create(twoMedia)
  await new Promise((r) => setTimeout(r, 5))
  const updated = await store.addCaptionset(d.id, {
    id: 'c1', name: 'natural language', method: 'manual', coverage: '2/2', captions: { m1: 'one' },
  })
  assert.equal(updated?.captionsets.length, 1)
  assert.equal(updated?.captionsets[0].captions?.m1, 'one')
  // Coverage is derived from the captions present, not echoed from the argument.
  assert.equal(updated?.captionsets[0].coverage, '1/2')
  assert.ok(new Date(updated!.mutatum).getTime() > new Date(d.mutatum).getTime())

  const reread = await store.find(d.id)
  assert.equal(reread?.captionsets[0].captions?.m1, 'one')
})

test('addCaptionset replaces a captionset carrying the same id rather than duplicating it', async () => {
  const d = await store.create(twoMedia)
  await store.addCaptionset(d.id, { id: 'c1', name: 'nl', method: 'manual', coverage: '', captions: { m1: 'one' } })
  const updated = await store.addCaptionset(d.id, { id: 'c1', name: 'nl', method: 'manual', coverage: '', captions: { m1: 'one', m2: 'two' } })
  assert.equal(updated?.captionsets.length, 1)
  assert.equal(updated?.captionsets[0].coverage, '2/2')
})

test('addCaptionset returns null for an unknown dataset', async () => {
  assert.equal(await store.addCaptionset('nope', { id: 'c1', name: 'nl', method: 'manual', coverage: '' }), null)
})

test('setCaption sets one key, recounts coverage, and bumps mutatum', async () => {
  const d = await store.create(twoMedia)
  await store.addCaptionset(d.id, { id: 'c1', name: 'nl', method: 'manual', coverage: '' })
  await new Promise((r) => setTimeout(r, 5))

  const one = await store.setCaption(d.id, 'c1', 'm1', 'first')
  assert.equal(one?.captionsets[0].captions?.m1, 'first')
  assert.equal(one?.captionsets[0].coverage, '1/2')

  const two = await store.setCaption(d.id, 'c1', 'm2', 'second')
  assert.equal(two?.captionsets[0].coverage, '2/2')
  assert.ok(new Date(two!.mutatum).getTime() > new Date(d.mutatum).getTime())

  // Re-editing an existing key moves the text, not the count.
  const again = await store.setCaption(d.id, 'c1', 'm2', 'second, revised')
  assert.equal(again?.captionsets[0].coverage, '2/2')
  const reread = await store.find(d.id)
  assert.equal(reread?.captionsets[0].captions?.m2, 'second, revised')
})

test('setCaption leaves sibling captionsets untouched', async () => {
  const d = await store.create(twoMedia)
  await store.addCaptionset(d.id, { id: 'c1', name: 'nl', method: 'manual', coverage: '' })
  await store.addCaptionset(d.id, { id: 'c2', name: 'tags', method: 'manual', coverage: '' })
  const updated = await store.setCaption(d.id, 'c1', 'm1', 'first')
  const c2 = updated?.captionsets.find((c) => c.id === 'c2')
  assert.equal(c2?.captions, undefined)
  assert.equal(c2?.coverage, '0/2')
})

test('setCaption returns null for an unknown dataset or an unknown captionset', async () => {
  const d = await store.create(twoMedia)
  assert.equal(await store.setCaption('nope', 'c1', 'm1', 'x'), null)
  assert.equal(await store.setCaption(d.id, 'no-such-set', 'm1', 'x'), null)
})
