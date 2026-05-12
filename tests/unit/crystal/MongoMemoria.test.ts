import { test, before, after, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { MongoClient, Collection } from 'mongodb'
import { MongoMemoria } from '../../../src/crystal/MongoMemoria.js'
import type { Memoria } from '../../../src/types/anima.js'

const URI = process.env.MONGO_PASS ?? process.env.MONGODB_URI ?? 'mongodb://localhost:27017'
const DB = 'noemaplane_test'
const COL = 'memoriae_unit'

let client: MongoClient
let col: Collection
let store: MongoMemoria

function makeInput(overrides: Partial<Omit<Memoria, 'id' | 'natum' | 'mutatum'>> = {}) {
  return {
    animaId: 'anima-abc',
    summarium: 'A creative user who loves portrait photography.',
    affines: ['photography', 'portraits'],
    praeferentia: { style: 'cinematic' },
    ...overrides,
  }
}

before(async () => {
  client = new MongoClient(URI)
  await client.connect()
  col = client.db(DB).collection(COL)
  await col.deleteMany({})
  await col.createIndex({ animaId: 1 }, { unique: true })
  store = new MongoMemoria(col)
})

afterEach(async () => { await col.deleteMany({}) })
after(async () => {
  await client.db(DB).dropCollection(COL).catch(() => {})
  await client.close()
})

test('upsert creates memoria on first call', async () => {
  const m = await store.upsert(makeInput())
  assert.ok(m.id)
  assert.ok(m.natum instanceof Date)
  assert.ok(m.mutatum instanceof Date)
  assert.equal(m.animaId, 'anima-abc')
  assert.equal(m.summarium, 'A creative user who loves portrait photography.')
  assert.deepEqual(m.affines, ['photography', 'portraits'])
  assert.deepEqual(m.praeferentia, { style: 'cinematic' })
})

test('upsert updates existing memoria on second call with same animaId', async () => {
  await store.upsert(makeInput())
  await new Promise(r => setTimeout(r, 5))
  const updated = await store.upsert(makeInput({
    summarium: 'Updated summary.',
    affines: ['photography', 'portraits', 'film'],
    praeferentia: { style: 'noir' },
  }))
  assert.equal(updated.summarium, 'Updated summary.')
  assert.deepEqual(updated.affines, ['photography', 'portraits', 'film'])
  assert.deepEqual(updated.praeferentia, { style: 'noir' })
})

test('upsert second call preserves same animaId (one doc per animaId)', async () => {
  await store.upsert(makeInput())
  await store.upsert(makeInput({ summarium: 'Updated.' }))
  const count = await col.countDocuments({ animaId: 'anima-abc' })
  assert.equal(count, 1)
})

test('upsert mutatum advances on update', async () => {
  const first = await store.upsert(makeInput())
  await new Promise(r => setTimeout(r, 5))
  const second = await store.upsert(makeInput({ summarium: 'Updated.' }))
  assert.ok(second.mutatum >= first.mutatum)
})

test('findByAnima returns null for unknown animaId', async () => {
  assert.equal(await store.findByAnima('unknown-anima'), null)
})

test('findByAnima returns memoria for known animaId', async () => {
  await store.upsert(makeInput())
  const found = await store.findByAnima('anima-abc')
  assert.ok(found)
  assert.equal(found.animaId, 'anima-abc')
  assert.equal(found.summarium, 'A creative user who loves portrait photography.')
})
