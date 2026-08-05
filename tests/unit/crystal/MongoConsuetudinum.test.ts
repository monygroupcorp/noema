import { test, before, after, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { MongoClient, Collection } from 'mongodb'
import { MongoConsuetudinum } from '../../../src/crystal/MongoConsuetudinum.js'

const URI = process.env.MONGO_PASS ?? process.env.MONGODB_URI ?? 'mongodb://localhost:27017'
const DB = 'noemaplane_test'
const COL = 'consuetudinum_unit'

let client: MongoClient
let col: Collection
let store: MongoConsuetudinum

before(async () => {
  client = new MongoClient(URI)
  await client.connect()
  col = client.db(DB).collection(COL)
  store = new MongoConsuetudinum(col)
})

after(async () => { await client.close() })
afterEach(async () => { await col.deleteMany({}) })

// ── verb rebinds (existing behavior — regression guard) ────────────────────────

test('bind then resolve round-trips; rebind overwrites', async () => {
  const owner = { animaId: 'anima-1' }
  await store.bind(owner, 'make', 'sd1-5')
  assert.equal(await store.resolve(owner, 'make'), 'sd1-5')
  await store.bind(owner, 'make', 'flux-schnell')
  assert.equal(await store.resolve(owner, 'make'), 'flux-schnell')
  assert.equal(await store.resolve(owner, 'chat'), undefined, 'unbound verb → undefined')
})

test('verb rebinds isolate by owner (animaId vs commitment)', async () => {
  await store.bind({ animaId: 'x' }, 'make', 'sd1-5')
  assert.equal(await store.resolve({ commitment: 'x' }, 'make'), undefined)
  await store.bind({ commitment: 'c-1' }, 'make', 'flux')
  assert.equal(await store.resolve({ commitment: 'c-1' }, 'make'), 'flux')
})

// ── affines (re-homed from Anima.affines) ──────────────────────────────────────

test('setAffines then resolveAffines round-trips per (owner, modus)', async () => {
  const owner = { animaId: 'anima-1' }
  await store.setAffines(owner, 'sd1-5', { steps: 30, cfg: 7 })
  assert.deepEqual(await store.resolveAffines(owner, 'sd1-5'), { steps: 30, cfg: 7 })
  assert.equal(await store.resolveAffines(owner, 'flux-schnell'), undefined)
  assert.equal(await store.resolveAffines({ animaId: 'anima-2' }, 'sd1-5'), undefined, 'owner isolation')
})

test('setAffines replaces the prior map (upsert, not merge)', async () => {
  const owner = { commitment: 'c-1' }
  await store.setAffines(owner, 'sd1-5', { steps: 10, cfg: 5 })
  await store.setAffines(owner, 'sd1-5', { steps: 40 })
  assert.deepEqual(await store.resolveAffines(owner, 'sd1-5'), { steps: 40 }, 'full replace')
})

// ── the critical disambiguation: both kinds share one collection ───────────────

test('a verb rebind and an affines doc on the same owner+modusId never cross-read', async () => {
  const owner = { animaId: 'anima-1' }
  // 'make' as a verb AND 'make' as a modusId — contrived worst case for the shared collection.
  await store.bind(owner, 'make', 'sd1-5')
  await store.setAffines(owner, 'make', { steps: 99 })

  assert.equal(await store.resolve(owner, 'make'), 'sd1-5', 'verb resolution unaffected by the affines doc')
  assert.deepEqual(await store.resolveAffines(owner, 'make'), { steps: 99 }, 'affines unaffected by the verb doc')

  // And they are genuinely two separate documents.
  assert.equal(await col.countDocuments({ 'auctorKey.animaId': 'anima-1' }), 2)
})

test('resolveAffines does not return a verb-rebind doc that shares the modusId', async () => {
  const owner = { animaId: 'anima-1' }
  await store.bind(owner, 'make', 'sd1-5')   // verb doc has modusId 'sd1-5' but a string verb
  assert.equal(await store.resolveAffines(owner, 'sd1-5'), undefined, 'verb doc must not satisfy the affines query')
})
