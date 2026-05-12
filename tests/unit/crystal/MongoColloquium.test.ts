import { test, before, after, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { MongoClient, Collection } from 'mongodb'
import { MongoColloquium } from '../../../src/crystal/MongoColloquium.js'
import type { Colloquium } from '../../../src/types/colloquium.js'

const URI = process.env.MONGO_PASS ?? process.env.MONGODB_URI ?? 'mongodb://localhost:27017'
const DB = 'noemaplane_test'
const COL = 'colloquia_unit'

let client: MongoClient
let col: Collection
let store: MongoColloquium

function makeInput(overrides: Partial<Omit<Colloquium, 'id' | 'natum' | 'mutatum'>> = {}) {
  return {
    animaId: 'anima-abc',
    status: 'active' as const,
    ...overrides,
  }
}

before(async () => {
  client = new MongoClient(URI)
  await client.connect()
  col = client.db(DB).collection(COL)
  await col.deleteMany({})
  await col.createIndex({ id: 1 }, { unique: true })
  store = new MongoColloquium(col)
})

afterEach(async () => { await col.deleteMany({}) })
after(async () => {
  await client.db(DB).dropCollection(COL).catch(() => {})
  await client.close()
})

test('create returns colloquium with id, natum, mutatum', async () => {
  const c = await store.create(makeInput())
  assert.ok(c.id)
  assert.ok(c.natum instanceof Date)
  assert.ok(c.mutatum instanceof Date)
})

test('create stores animaId and status', async () => {
  const c = await store.create(makeInput())
  assert.equal(c.animaId, 'anima-abc')
  assert.equal(c.status, 'active')
})

test('create stores optional fields when provided', async () => {
  const c = await store.create(makeInput({ tabulaId: 'tab-1', modoId: 'modo-1', titulus: 'My Chat' }))
  assert.equal(c.tabulaId, 'tab-1')
  assert.equal(c.modoId, 'modo-1')
  assert.equal(c.titulus, 'My Chat')
})

test('find returns null for unknown id', async () => {
  assert.equal(await store.find('nope'), null)
})

test('find returns created colloquium', async () => {
  const created = await store.create(makeInput())
  const found = await store.find(created.id)
  assert.equal(found?.id, created.id)
  assert.equal(found?.animaId, 'anima-abc')
})

test('findByAnima returns all colloquia for animaId', async () => {
  await store.create(makeInput({ animaId: 'anima-abc', status: 'active' }))
  await store.create(makeInput({ animaId: 'anima-abc', status: 'archived' }))
  await store.create(makeInput({ animaId: 'anima-xyz' }))
  const results = await store.findByAnima('anima-abc')
  assert.equal(results.length, 2)
  assert.ok(results.every(c => c.animaId === 'anima-abc'))
})

test('findByAnima filters by status when provided', async () => {
  await store.create(makeInput({ animaId: 'anima-abc', status: 'active' }))
  await store.create(makeInput({ animaId: 'anima-abc', status: 'archived' }))
  const active = await store.findByAnima('anima-abc', 'active')
  assert.equal(active.length, 1)
  assert.equal(active[0].status, 'active')
})

test('findByAnima returns empty array for unknown animaId', async () => {
  const results = await store.findByAnima('unknown-anima')
  assert.deepEqual(results, [])
})

test('update changes fields and stamps mutatum', async () => {
  const c = await store.create(makeInput())
  await new Promise(r => setTimeout(r, 5))
  const updated = await store.update(c.id, { titulus: 'New Title' })
  assert.equal(updated.titulus, 'New Title')
  assert.ok(updated.mutatum > updated.natum)
})

test('update status', async () => {
  const c = await store.create(makeInput())
  const updated = await store.update(c.id, { status: 'archived' })
  assert.equal(updated.status, 'archived')
})

test('archive sets status to archived', async () => {
  const c = await store.create(makeInput())
  const archived = await store.archive(c.id)
  assert.equal(archived.status, 'archived')
})
