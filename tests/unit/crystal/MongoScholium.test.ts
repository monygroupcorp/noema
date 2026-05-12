import { test, before, after, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { MongoClient, Collection } from 'mongodb'
import { MongoScholium } from '../../../src/crystal/MongoScholium.js'

const URI = process.env.MONGO_PASS ?? process.env.MONGODB_URI ?? 'mongodb://localhost:27017'
const DB = 'noemaplane_test'
const COL = 'scholia_unit'

let client: MongoClient, col: Collection, store: MongoScholium

before(async () => {
  client = new MongoClient(URI)
  await client.connect()
  col = client.db(DB).collection(COL)
  await col.createIndex({ id: 1 }, { unique: true })
  store = new MongoScholium(col)
})
afterEach(async () => { await col.deleteMany({}) })
after(async () => {
  await client.db(DB).dropCollection(COL).catch(() => {})
  await client.close()
})

function makeBase(overrides: Record<string, unknown> = {}) {
  return {
    animaId: 'anima-abc',
    targetType: 'modus' as const,
    targetId: 'modus-xyz',
    corpus: 'This tool crashes on empty input.',
    tag: 'bug' as const,
    ...overrides,
  }
}

// Test 1: create returns scholium with id and natum
test('create returns scholium with id and natum', async () => {
  const s = await store.create(makeBase())
  assert.ok(s.id)
  assert.ok(s.natum instanceof Date)
})

// Test 2: create stores animaId, targetType, targetId, corpus, tag
test('create stores animaId, targetType, targetId, corpus, tag', async () => {
  const s = await store.create(makeBase())
  assert.equal(s.animaId, 'anima-abc')
  assert.equal(s.targetType, 'modus')
  assert.equal(s.targetId, 'modus-xyz')
  assert.equal(s.corpus, 'This tool crashes on empty input.')
  assert.equal(s.tag, 'bug')
})

// Test 3: find returns null for unknown id
test('find returns null for unknown id', async () => {
  assert.equal(await store.find('no-such-id'), null)
})

// Test 4: find returns created scholium
test('find returns created scholium', async () => {
  const s = await store.create(makeBase())
  const found = await store.find(s.id)
  assert.ok(found)
  assert.equal(found.id, s.id)
  assert.equal(found.animaId, s.animaId)
  assert.equal(found.corpus, s.corpus)
})

// Test 5: listByTarget returns all scholia for that target
test('listByTarget returns all scholia for that target', async () => {
  await store.create(makeBase({ corpus: 'note one' }))
  await store.create(makeBase({ corpus: 'note two', tag: 'tip' as const }))
  const list = await store.listByTarget('modus', 'modus-xyz')
  assert.equal(list.length, 2)
})

// Test 6: listByTarget returns empty for unknown target
test('listByTarget returns empty for unknown target', async () => {
  await store.create(makeBase())
  const list = await store.listByTarget('modus', 'no-such-target')
  assert.equal(list.length, 0)
})

// Test 7: listByTarget does not return scholia for a different targetId
test('listByTarget does not return scholia for a different targetId', async () => {
  await store.create(makeBase({ targetId: 'modus-xyz' }))
  await store.create(makeBase({ targetId: 'modus-other' }))
  const list = await store.listByTarget('modus', 'modus-xyz')
  assert.equal(list.length, 1)
  assert.equal(list[0].targetId, 'modus-xyz')
})

// Test 8: listUnresolvedBugs returns only unresolved bug-tagged scholia for that target
test('listUnresolvedBugs returns only unresolved bug-tagged scholia for that target', async () => {
  await store.create(makeBase({ tag: 'bug' as const }))
  await store.create(makeBase({ tag: 'bug' as const, corpus: 'second bug' }))
  const list = await store.listUnresolvedBugs('modus', 'modus-xyz')
  assert.equal(list.length, 2)
  assert.ok(list.every(s => s.tag === 'bug'))
  assert.ok(list.every(s => !s.resoluta))
})

// Test 9: listUnresolvedBugs excludes resolved bugs
test('listUnresolvedBugs excludes resolved bugs', async () => {
  const s = await store.create(makeBase({ tag: 'bug' as const }))
  await store.resolve(s.id, new Date())
  const list = await store.listUnresolvedBugs('modus', 'modus-xyz')
  assert.equal(list.length, 0)
})

// Test 10: listUnresolvedBugs excludes non-bug tags (tip, fix, etc.)
test('listUnresolvedBugs excludes non-bug tags (tip, fix, etc.)', async () => {
  await store.create(makeBase({ tag: 'tip' as const }))
  await store.create(makeBase({ tag: 'fix' as const }))
  await store.create(makeBase({ tag: 'bug' as const }))
  const list = await store.listUnresolvedBugs('modus', 'modus-xyz')
  assert.equal(list.length, 1)
  assert.equal(list[0].tag, 'bug')
})

// Test 11: resolve sets resoluta and returns updated scholium
test('resolve sets resoluta and returns updated scholium', async () => {
  const s = await store.create(makeBase())
  const at = new Date()
  const updated = await store.resolve(s.id, at)
  assert.ok(updated.resoluta instanceof Date)
  assert.equal(updated.resoluta!.toISOString(), at.toISOString())
  assert.equal(updated.id, s.id)
})

// Test 12: resolve throws for unknown id
test('resolve throws for unknown id', async () => {
  await assert.rejects(
    () => store.resolve('no-such-id', new Date()),
    /not found/i
  )
})
