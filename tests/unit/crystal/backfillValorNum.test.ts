import { test, before, after, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { MongoClient, Collection } from 'mongodb'
import { randomUUID } from 'node:crypto'
import { backfillValorNum } from '../../../src/crystal/backfillValorNum.js'
import { MongoSignorum } from '../../../src/crystal/MongoSignorum.js'

// ledger-hardening Debt #1 — reserve selects via `.sort({ valorNum: 1 })`. Signa written before
// the sort-mirror existed (legacy prod/staging writes, direct-insert seeds) carry NO valorNum; in
// an ascending Mongo sort a missing field ranks as null (below all numbers), so a legacy coin is
// mis-picked ahead of genuinely-smaller coins. These tests prove the backfill closes that gap.

const URI = process.env.MONGO_PASS ?? process.env.MONGODB_URI ?? 'mongodb://localhost:27017'
const DB = 'noemaplane_test'
const COL = 'signa_backfill_unit'

let client: MongoClient
let col: Collection

before(async () => {
  client = new MongoClient(URI)
  await client.connect()
  col = client.db(DB).collection(COL)
  await col.deleteMany({})
  await col.createIndex({ id: 1 }, { unique: true })
  await col.createIndex({ animaId: 1, status: 1, valorNum: 1 })
})

afterEach(async () => { await col.deleteMany({}) })
after(async () => {
  await client.db(DB).dropCollection(COL).catch(() => {})
  await client.close()
})

// A legacy insert: valor as a string, NO valorNum — exactly what pre-mirror writes / direct-insert
// seeds produced (see scripts/seed-test-commitment.mjs before its fix).
async function insertLegacy(animaId: string, valor: bigint): Promise<string> {
  const id = randomUUID()
  await col.insertOne({ id, animaId, forma: 'minted', valor: valor.toString(), auctor: 'legacy', natum: new Date(), status: 'valid' })
  return id
}

test('stamps valorNum on every legacy doc; value mirrors the bigint valor', async () => {
  const values = [2n, 9n, 10n, 30n, 100000n]
  for (const v of values) await insertLegacy('a', v)

  const before = await col.countDocuments({ valorNum: { $exists: false } })
  assert.equal(before, values.length, 'fixture must start with no valorNum')

  const res = await backfillValorNum(col)
  assert.equal(res.scanned, values.length)
  assert.equal(res.updated, values.length)

  // Every doc now carries valorNum === Number(BigInt(valor)).
  const docs = await col.find({}).toArray()
  assert.equal(docs.length, values.length)
  for (const d of docs) {
    assert.equal(typeof d.valorNum, 'number', `doc ${d.id} missing valorNum`)
    assert.equal(d.valorNum, Number(BigInt(d.valor as string)))
  }
  assert.equal(await col.countDocuments({ valorNum: { $exists: false } }), 0)
})

test('is idempotent — a second run touches nothing', async () => {
  await insertLegacy('a', 5n)
  await insertLegacy('a', 7n)

  await backfillValorNum(col)
  const second = await backfillValorNum(col)
  assert.equal(second.scanned, 0, 'no docs should remain missing valorNum')
  assert.equal(second.updated, 0)
})

test('dry-run reports the work but writes nothing', async () => {
  await insertLegacy('a', 42n)
  const res = await backfillValorNum(col, { dryRun: true })
  assert.equal(res.scanned, 1)
  assert.equal(res.updated, 0)
  assert.equal(await col.countDocuments({ valorNum: { $exists: false } }), 1, 'dry-run must not write')
})

// The load-bearing regression proof: without valorNum, a legacy big coin sorts null-first and is
// mis-picked; after the backfill, reserve correctly takes the small coin.
test('after backfill, reserve selects the smaller coin (not the null-sorted legacy one)', async () => {
  const bigId = await insertLegacy('mix', 100000n)   // legacy, no valorNum → sorts as null (first)
  await insertLegacy('mix', 5n)                       // legacy small coin

  // Pre-backfill sanity: the ascending sort ranks the valorNum-less big coin first.
  const preOrder = await col.find({ animaId: 'mix', status: 'valid' }).sort({ valorNum: 1 }).toArray()
  assert.equal(preOrder[0].id, bigId, 'null-sorted legacy coin should rank first before backfill')

  await backfillValorNum(col)

  const store = new MongoSignorum(col, client)
  const r = await store.reserve({ animaId: 'mix' }, 5n, 'act-backfill')
  assert.ok(r.ok, 'reserve should cover 5')
  // Correct greedy: take the 5-coin whole, never split the 100000-coin.
  assert.equal(r.locked, 5n, `expected to lock the 5-coin, got ${r.locked}`)
  assert.equal(r.signaIds.length, 1)
  assert.notEqual(r.signaIds[0], bigId, 'must not pick the large legacy coin')
})
