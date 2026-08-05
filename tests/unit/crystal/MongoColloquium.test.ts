import { test, before, after, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { MongoClient, Collection } from 'mongodb'
import { MongoColloquium } from '../../../src/crystal/MongoColloquium.js'
import { ownerKeyOf } from '../../../src/crystal/ownerKey.js'
import type { Colloquium } from '../../../src/types/colloquium.js'

const URI = process.env.MONGO_PASS ?? process.env.MONGODB_URI ?? 'mongodb://localhost:27017'
const DB = 'noemaplane_test'
const COL = 'colloquia_unit'

let client: MongoClient
let col: Collection
let store: MongoColloquium

function makeInput(overrides: Partial<Omit<Colloquium, 'id' | 'natum' | 'mutatum'>> = {}) {
  return {
    ownerKey: 'anima:anima-abc',
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

test('create stores ownerKey and status', async () => {
  const c = await store.create(makeInput())
  assert.equal(c.ownerKey, 'anima:anima-abc')
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
  assert.equal(found?.ownerKey, 'anima:anima-abc')
})

test('findByOwner returns all colloquia for animaId-shaped ownerKey', async () => {
  const owner = ownerKeyOf({ animaId: 'anima-abc' })
  await store.create(makeInput({ ownerKey: owner, status: 'active' }))
  await store.create(makeInput({ ownerKey: owner, status: 'archived' }))
  await store.create(makeInput({ ownerKey: ownerKeyOf({ animaId: 'anima-xyz' }) }))
  const results = await store.findByOwner(owner)
  assert.equal(results.length, 2)
  assert.ok(results.every(c => c.ownerKey === owner))
})

test('findByOwner filters by status when provided', async () => {
  const owner = ownerKeyOf({ animaId: 'anima-abc' })
  await store.create(makeInput({ ownerKey: owner, status: 'active' }))
  await store.create(makeInput({ ownerKey: owner, status: 'archived' }))
  const active = await store.findByOwner(owner, 'active')
  assert.equal(active.length, 1)
  assert.equal(active[0].status, 'active')
})

test('findByOwner returns empty array for unknown ownerKey', async () => {
  const results = await store.findByOwner('anima:unknown-anima')
  assert.deepEqual(results, [])
})

test('findByOwner returns colloquia for a commitment-shaped ownerKey', async () => {
  const owner = ownerKeyOf({ commitment: 'cmt-123' })
  await store.create(makeInput({ ownerKey: owner, status: 'active' }))
  await store.create(makeInput({ ownerKey: ownerKeyOf({ commitment: 'cmt-999' }) }))
  const results = await store.findByOwner(owner)
  assert.equal(results.length, 1)
  assert.equal(results[0].ownerKey, owner)
})

test('findByOwner returns colloquia for a bursaToken-shaped ownerKey', async () => {
  const owner = ownerKeyOf({ bursaToken: 'tok-xyz' })
  await store.create(makeInput({ ownerKey: owner, status: 'active' }))
  await store.create(makeInput({ ownerKey: owner, status: 'archived' }))
  await store.create(makeInput({ ownerKey: ownerKeyOf({ bursaToken: 'tok-other' }) }))
  const results = await store.findByOwner(owner)
  assert.equal(results.length, 2)
  assert.ok(results.every(c => c.ownerKey === owner))
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
