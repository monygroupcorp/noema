import { test, before, after, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { MongoClient, Collection } from 'mongodb'
import { MongoBursarium } from '../../../src/arcanum/MongoBursarium.js'

// Real-Mongo coverage for the OWNED-purse widening of Bursa (§7 delegation-via-Bursa):
// owner/label/status persist + round-trip, listByOwner backs the dashboard, and the anon
// path (no owner) is untouched. debit still guards the balance (the reused overspend guard).

const URI = process.env.MONGO_PASS ?? process.env.MONGODB_URI ?? 'mongodb://localhost:27017'
const DB = 'noemaplane_test'
const COL = 'bursarium_owned_unit'

let client: MongoClient
let col: Collection
let store: MongoBursarium

before(async () => {
  client = new MongoClient(URI)
  await client.connect()
  col = client.db(DB).collection(COL)
  await col.deleteMany({})
  await col.createIndex({ token: 1 }, { unique: true })
  await col.createIndex({ ownerAnimaId: 1 }, { sparse: true })
  store = new MongoBursarium(col)
})
afterEach(async () => { await col.deleteMany({}) })
after(async () => {
  await client.db(DB).dropCollection(COL).catch(() => {})
  await client.close()
})

test('owned purse persists owner/label/status; anon purse omits them', async () => {
  const owned = await store.create(1000n, { owner: { animaId: 'u1' }, label: 'mods' })
  const back = await store.findByToken(owned.id)
  assert.deepEqual(back?.owner, { animaId: 'u1' })
  assert.equal(back?.label, 'mods')
  assert.equal(back?.status, 'active')

  const anon = await store.create(500n)                 // no opts → anon purse
  const anonBack = await store.findByToken(anon.id)
  assert.equal(anonBack?.owner, undefined)              // unlinkable — no ownerAnimaId
  assert.equal(anonBack?.status, undefined)
})

test('listByOwner returns only that owner\'s purses (the dashboard); anon purses excluded', async () => {
  await store.create(100n, { owner: { animaId: 'u1' }, label: 'a' })
  await store.create(200n, { owner: { animaId: 'u1' }, label: 'b' })
  await store.create(300n, { owner: { animaId: 'u2' } })
  await store.create(400n)                              // anon
  const mine = await store.listByOwner('u1')
  assert.equal(mine.length, 2)
  assert.deepEqual(new Set(mine.map((b) => b.label)), new Set(['a', 'b']))
})

test('debit still guards the balance + carries owner on the returned purse; setStatus revokes', async () => {
  const b = await store.create(1000n, { owner: { animaId: 'u1' } })
  const after = await store.debit(b.id, 400n)
  assert.equal(after.credits, 600n)
  assert.deepEqual(after.owner, { animaId: 'u1' })      // fromDoc carries owner through debit
  await assert.rejects(() => store.debit(b.id, 999n), /Insufficient/)   // overspend guard intact
  await store.setStatus(b.id, 'revoked')
  assert.equal((await store.findByToken(b.id))?.status, 'revoked')
})
