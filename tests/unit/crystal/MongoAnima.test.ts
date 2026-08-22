import { test, before, after, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { MongoClient, Collection } from 'mongodb'
import { MongoAnima } from '../../../src/crystal/MongoAnima.js'
import type { Anima } from '../../../src/types/anima.js'

const URI = process.env.MONGO_PASS ?? process.env.MONGODB_URI ?? 'mongodb://localhost:27017'
const DB = 'noemaplane_test'
const COL = 'animae_unit'

let client: MongoClient
let col: Collection
let store: MongoAnima

/**
 * `affines` is no longer part of the `Anima` contract — it lives on the owner-keyed
 * Consuetudinum store. `MongoAnima` is a verbatim document mirror, so a row written with
 * the field still carries it back out, which is what the two `affines` cases below cover.
 * Typed here as an extra DOCUMENT field so the suite states that plainly rather than
 * implying `Anima` still declares it.
 */
type AnimaRow = Anima & { affines?: Record<string, unknown> }

function makeInput(overrides: Partial<Omit<AnimaRow, 'id' | 'natum' | 'mutatum'>> = {}): Omit<AnimaRow, 'id' | 'natum' | 'mutatum'> {
  return {
    nomen: 'Test Soul',
    affines: {},
    ...overrides,
  }
}

before(async () => {
  client = new MongoClient(URI)
  await client.connect()
  col = client.db(DB).collection(COL)
  await col.createIndex({ id: 1 }, { unique: true })
  await col.createIndex({ custos: 1 }, { sparse: true })
  store = new MongoAnima(col)
})

afterEach(async () => {
  await col.deleteMany({})
})

after(async () => {
  await client.db(DB).dropCollection(COL).catch(() => {})
  await client.close()
})

// ── create ────────────────────────────────────────────────────────────────────

test('create returns anima with id, natum, mutatum', async () => {
  const a = await store.create(makeInput())
  assert.ok(a.id)
  assert.ok(a.natum instanceof Date)
  assert.ok(a.mutatum instanceof Date)
})

test('create sets nomen and affines', async () => {
  const a = await store.create(makeInput({ nomen: 'Alice', affines: { 'modus-1': { seed: 42 } } })) as AnimaRow
  assert.equal(a.nomen, 'Alice')
  assert.deepEqual(a.affines, { 'modus-1': { seed: 42 } })
})

test('create with custos stores wallet address', async () => {
  const a = await store.create(makeInput({ custos: '0xdeadbeef' }))
  assert.equal(a.custos, '0xdeadbeef')
})

test('create without custos leaves it undefined', async () => {
  const a = await store.create(makeInput())
  assert.equal(a.custos, undefined)
})

// ── find ──────────────────────────────────────────────────────────────────────

test('find returns null for unknown id', async () => {
  const a = await store.find('does-not-exist')
  assert.equal(a, null)
})

test('find returns the created anima', async () => {
  const created = await store.create(makeInput({ nomen: 'Bob' }))
  const found = await store.find(created.id)
  assert.ok(found)
  assert.equal(found.id, created.id)
  assert.equal(found.nomen, 'Bob')
})

test('find does not return other animae', async () => {
  await store.create(makeInput({ nomen: 'Alice' }))
  const bob = await store.create(makeInput({ nomen: 'Bob' }))
  const found = await store.find(bob.id)
  assert.equal(found?.nomen, 'Bob')
})

// ── findByCustos ──────────────────────────────────────────────────────────────

test('findByCustos returns null for unknown wallet', async () => {
  const a = await store.findByCustos('0xunknown')
  assert.equal(a, null)
})

test('findByCustos returns anima for known wallet', async () => {
  const created = await store.create(makeInput({ custos: '0xabc123' }))
  const found = await store.findByCustos('0xabc123')
  assert.ok(found)
  assert.equal(found.id, created.id)
})

test('findByCustos does not return anima with different wallet', async () => {
  await store.create(makeInput({ custos: '0xabc' }))
  const found = await store.findByCustos('0xxyz')
  assert.equal(found, null)
})

// ── update ────────────────────────────────────────────────────────────────────

test('update changes nomen', async () => {
  const a = await store.create(makeInput({ nomen: 'Old Name' }))
  const updated = await store.update(a.id, { nomen: 'New Name' })
  assert.equal(updated.nomen, 'New Name')
})

test('update changes affines', async () => {
  const a = await store.create(makeInput())
  // `affines` is not in this store's `update` patch whitelist (it is not an `Anima` field at
  // all any more), while the store's `$set` still writes a patch verbatim — which is the
  // behaviour this case covers. Suppressed narrowly rather than dropped: whether the Anima
  // suite should keep covering a field that has moved to Consuetudinum is a follow-on
  // decision about the stores, not something a typecheck sweep should settle.
  // @ts-expect-error — `affines` was re-homed onto the owner-keyed Consuetudinum store.
  const updated = await store.update(a.id, { affines: { 'modus-x': { steps: 20 } } }) as AnimaRow
  assert.deepEqual(updated.affines, { 'modus-x': { steps: 20 } })
})

test('update sets custos', async () => {
  const a = await store.create(makeInput())
  const updated = await store.update(a.id, { custos: '0xnewwallet' })
  assert.equal(updated.custos, '0xnewwallet')
})

test('update stamps mutatum later than natum', async () => {
  const a = await store.create(makeInput())
  await new Promise(r => setTimeout(r, 5))
  const updated = await store.update(a.id, { nomen: 'Changed' })
  assert.ok(updated.mutatum > updated.natum)
})

test('update persists — find returns updated anima', async () => {
  const a = await store.create(makeInput({ nomen: 'Before' }))
  await store.update(a.id, { nomen: 'After' })
  const found = await store.find(a.id)
  assert.equal(found?.nomen, 'After')
})
