import { test, before, after, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { MongoClient, Collection } from 'mongodb'
import { MongoDelegatio } from '../../../src/crystal/MongoDelegatio.js'

// Real-Mongo coverage for the delegation budget guard. `recordSpend` is a CAS on
// `spentPoints` with the cap/active/expiry checks — only real Mongo proves that N
// concurrent runs under one capped delegation cannot collectively overspend the cap.

const URI = process.env.MONGO_PASS ?? process.env.MONGODB_URI ?? 'mongodb://localhost:27017'
const DB = 'noemaplane_test'
const COL = 'delegationes_unit'

let client: MongoClient
let col: Collection
let store: MongoDelegatio

before(async () => {
  client = new MongoClient(URI)
  await client.connect()
  col = client.db(DB).collection(COL)
  await col.deleteMany({})
  await col.createIndex({ token: 1 }, { unique: true })
  store = new MongoDelegatio(col)
})
afterEach(async () => { await col.deleteMany({}) })
after(async () => {
  await client.db(DB).dropCollection(COL).catch(() => {})
  await client.close()
})

test('create mints a unique token; findByToken round-trips bigints', async () => {
  const d = await store.create({ agentId: 'camel42', label: 'x', spendCapPoints: 5000n })
  assert.ok(d.token)
  const byTok = await store.findByToken(d.token)
  assert.equal(byTok?.spendCapPoints, 5000n)
  assert.equal(byTok?.spentPoints, 0n)
})

test('recordSpend enforces the cap; a spend that would breach it is refused', async () => {
  const d = await store.create({ agentId: 'a', spendCapPoints: 1000n })
  assert.equal((await store.recordSpend(d.id, 600n, new Date()))?.spentPoints, 600n)
  assert.equal((await store.recordSpend(d.id, 300n, new Date()))?.spentPoints, 900n)
  assert.equal(await store.recordSpend(d.id, 200n, new Date()), null)   // 900+200 > 1000 → refused
  assert.equal((await store.find(d.id))?.spentPoints, 900n)             // unchanged
})

test('recordSpend refuses a revoked or expired delegation', async () => {
  const revoked = await store.create({ agentId: 'a', spendCapPoints: 1000n })
  await store.setStatus(revoked.id, 'revoked')
  assert.equal(await store.recordSpend(revoked.id, 10n, new Date()), null)

  const expired = await store.create({ agentId: 'a', spendCapPoints: 1000n, expiresAt: new Date(Date.now() - 1000) })
  assert.equal(await store.recordSpend(expired.id, 10n, new Date()), null)
})

test('CAS: 20 concurrent 100-pt spends on a 1000-pt cap NEVER overspend', async () => {
  const d = await store.create({ agentId: 'a', spendCapPoints: 1000n })
  const results = await Promise.all(Array.from({ length: 20 }, () => store.recordSpend(d.id, 100n, new Date())))
  const wins = results.filter(Boolean).length
  const spent = (await store.find(d.id))!.spentPoints
  // The load-bearing invariant: the cap is never exceeded (a spend that would breach it is
  // refused). Under heavy contention some fittable spends may also be conservatively refused
  // (the delegate re-runs) — but overspend is impossible.
  assert.ok(spent <= 1000n, `spent ${spent} must never exceed the 1000 cap`)
  assert.ok(wins >= 1 && wins <= 10, `wins ${wins} within [1,10]`)
  assert.equal(spent, BigInt(wins) * 100n, 'spend total is consistent with the number of winners')
})

test('uncapped delegation accrues spend without limit', async () => {
  const d = await store.create({ agentId: 'a' })                        // no spendCapPoints
  await store.recordSpend(d.id, 999_999n, new Date())
  assert.equal((await store.find(d.id))?.spentPoints, 999_999n)
})
