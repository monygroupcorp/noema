import { test, before, after, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { MongoClient, Collection } from 'mongodb'
import { MongoSignorum } from '../../../src/crystal/MongoSignorum.js'

// Real-Mongo concurrency proof for the ledger-safety phase (ADR-0011 §3).
//
// The atomic `reserve` and hardened `settle` are only meaningfully testable against a real
// Mongo — atomicity is trivial in the in-memory Map but real only when concurrent writers
// race on the same documents. This proves: no overdraw under contention, fail-closed on
// shortfall, and the settle/release guards that bring Mongo to MemorySignorum parity.

const URI = process.env.MONGO_PASS ?? process.env.MONGODB_URI ?? 'mongodb://localhost:27017'
const DB = 'noemaplane_test'
const COL = 'signa_reserve_unit'

let client: MongoClient
let col: Collection
let store: MongoSignorum

before(async () => {
  client = new MongoClient(URI)
  await client.connect()
  col = client.db(DB).collection(COL)
  await col.deleteMany({})
  await col.createIndex({ id: 1 }, { unique: true })
  await col.createIndex({ animaId: 1, status: 1 })
  await col.createIndex({ actumId: 1 })
  store = new MongoSignorum(col)
})

afterEach(async () => { await col.deleteMany({}) })
after(async () => {
  await client.db(DB).dropCollection(COL).catch(() => {})
  await client.close()
})

async function issue(animaId: string, valor: bigint) {
  return store.issue({ animaId, forma: 'minted', valor, auctor: 'test' })
}

// ── single-caller correctness ────────────────────────────────────────────────

test('reserve covers the amount and locks the signa', async () => {
  await issue('a', 300n)
  await issue('a', 300n)
  await issue('a', 300n)

  const r = await store.reserve({ animaId: 'a' }, 500n, 'act-1')
  assert.ok(r.ok)
  assert.ok(r.locked >= 500n)
  assert.equal(await store.balance({ animaId: 'a' }), 900n - r.locked)
})

test('reserve insufficient fails closed and locks nothing', async () => {
  await issue('a', 400n)
  const r = await store.reserve({ animaId: 'a' }, 1000n, 'act-1')
  assert.equal(r.ok, false)
  if (!r.ok) assert.equal(r.available, 400n)
  assert.equal(await store.balance({ animaId: 'a' }), 400n)
  const locked = await col.countDocuments({ status: 'locked' })
  assert.equal(locked, 0)
})

// ── the load-bearing concurrency proof ───────────────────────────────────────

test('CONCURRENCY: parallel reservations on one pool never overdraw', async () => {
  // Pool = 1000 (10 × 100). Fire 10 concurrent reservations of 200 each (demand 2000 ≫ 1000).
  for (let i = 0; i < 10; i++) await issue('pool', 100n)

  const results = await Promise.all(
    Array.from({ length: 10 }, (_, i) => store.reserve({ animaId: 'pool' }, 200n, `act-${i}`)),
  )

  const winners = results.filter((r): r is Extract<typeof r, { ok: true }> => r.ok)
  const totalLocked = winners.reduce((sum, r) => sum + r.locked, 0n)

  // No overdraw: winners can never have locked more than the pool held.
  assert.ok(totalLocked <= 1000n, `overdraw: locked ${totalLocked} > 1000`)

  // Winners hold disjoint signa — no signum reserved twice.
  const seen = new Set<string>()
  for (const w of winners) {
    for (const id of w.signaIds) {
      assert.ok(!seen.has(id), `signum ${id} reserved by two actums`)
      seen.add(id)
    }
  }

  // Ledger is internally consistent: locked docs == the union the winners claim.
  const lockedDocs = await col.countDocuments({ status: 'locked' })
  assert.equal(lockedDocs, seen.size)

  // Nothing was lost: valid + locked still sums to the original 1000.
  const validTotal = await store.balance({ animaId: 'pool' })
  assert.equal(validTotal + totalLocked, 1000n)
})

test('CONCURRENCY: losers of a race are fully released (fail closed)', async () => {
  // Pool = 300. Two reservations of 200 each — at most one can win; the other must release.
  await issue('pool2', 100n)
  await issue('pool2', 100n)
  await issue('pool2', 100n)

  const [r1, r2] = await Promise.all([
    store.reserve({ animaId: 'pool2' }, 200n, 'act-a'),
    store.reserve({ animaId: 'pool2' }, 200n, 'act-b'),
  ])

  const winners = [r1, r2].filter(r => r.ok)
  assert.ok(winners.length <= 1, 'both reservations of 200 cannot win against a pool of 300')

  // Whatever a loser touched is back to valid — no dangling locks on an actum that failed.
  for (const [r, act] of [[r1, 'act-a'], [r2, 'act-b']] as const) {
    if (!r.ok) {
      const dangling = await col.countDocuments({ actumId: act, status: 'locked' })
      assert.equal(dangling, 0, `loser ${act} left dangling locks`)
    }
  }
})

// ── hardened settle / release parity ─────────────────────────────────────────

test('settle: charges exactly actual, refunds the overshoot delta', async () => {
  await issue('a', 1000n)
  const r = await store.reserve({ animaId: 'a' }, 1000n, 'act-1')
  assert.ok(r.ok)
  await store.settle(r.signaIds, 700n, 'act-1')
  assert.equal(await store.balance({ animaId: 'a' }), 300n)
})

test('settle: rejects overcharge above the locked total', async () => {
  const sig = await issue('a', 500n)
  await store.lock([sig.id], 'act-1')
  await assert.rejects(() => store.settle([sig.id], 800n, 'act-1'), /overcharge/i)
})

test('settle: rejects a signum that is not locked', async () => {
  const sig = await issue('a', 500n)   // still valid, never locked
  await assert.rejects(() => store.settle([sig.id], 100n, 'act-1'), /must be locked/i)
})

test('settle: rejects an already-spent signum (no double-refund)', async () => {
  const sig = await issue('a', 500n)
  await store.lock([sig.id], 'act-1')
  await store.settle([sig.id], 500n, 'act-1')
  await assert.rejects(() => store.settle([sig.id], 500n, 'act-1'), /already spent/i)
})

test('release: no-op on already-spent signum', async () => {
  const sig = await issue('a', 500n)
  await store.lock([sig.id], 'act-1')
  await store.settle([sig.id], 500n, 'act-1')
  await store.release([sig.id])   // must not resurrect the spent signum
  assert.equal(await store.balance({ animaId: 'a' }), 0n)
})

// ── transfer ────────────────────────────────────────────────────────────────

test('transfer: moves exactly amount, conserves total value', async () => {
  await issue('sender', 1000n)
  const t = await store.transfer({ animaId: 'sender' }, { animaId: 'recipient' }, 400n)
  assert.ok(t.ok)
  assert.equal(await store.balance({ animaId: 'sender' }), 600n)
  assert.equal(await store.balance({ animaId: 'recipient' }), 400n)
})

test('transfer: insufficient sender moves nothing', async () => {
  await issue('sender', 100n)
  const t = await store.transfer({ animaId: 'sender' }, { animaId: 'recipient' }, 500n)
  assert.equal(t.ok, false)
  assert.equal(await store.balance({ animaId: 'sender' }), 100n)
  assert.equal(await store.balance({ animaId: 'recipient' }), 0n)
})
