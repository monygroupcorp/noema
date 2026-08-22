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
  // Mirror ensureIndexes: the valorNum sort-mirror index that makes reserve's selection
  // an index-backed server-side sort (ledger-hardening Debt #1).
  await col.createIndex({ animaId: 1, status: 1, valorNum: 1 })
  await col.createIndex({ actumId: 1 })
  store = new MongoSignorum(col, client)
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

// ── negative-valor debit exclusion (noema-083), Mongo parity ─────────────────
//
// Real-Mongo proof that reserve's server-side selection query filters out negative-valor debit
// signa (nexus:studioSpend / tee:spend / publish:scanFee mint `valor: -impetus, status:'valid'`
// rows). balance() still NETS them (it must not change); reserve must never lock one. The filter
// rides the numeric sort-mirror `valorNum` so it stays on the { animaId, status, valorNum } index.

// A studioSpend-shaped host debit: negative valor, valid on issue.
async function issueDebit(animaId: string, valor: bigint) {
  return store.issue({ animaId, forma: 'integer', valor, auctor: 'nexus:studioSpend', testis: 'materia-1' })
}

test('reserve: never selects a negative-valor debit signum, and leaves it untouched', async () => {
  await issue('a', 100n)
  await issue('a', 300n)
  const neg = await issueDebit('a', -50n)
  assert.equal(await store.balance({ animaId: 'a' }), 350n)   // balance nets the debit

  const r = await store.reserve({ animaId: 'a' }, 120n, 'act-1')
  assert.ok(r.ok)
  assert.ok(!r.signaIds.includes(neg.id), 'negative debit must never be reserved')
  // the debit row is untouched — still valid, never locked.
  const negDoc = await col.findOne({ id: neg.id })
  assert.ok(negDoc)
  assert.equal(negDoc.status, 'valid')
  assert.equal(negDoc.valor, '-50')
  const lockedDebits = await col.countDocuments({ valorNum: { $lte: 0 }, status: 'locked' })
  assert.equal(lockedDebits, 0)
})

test('reserve+settle: spends only positives; the debit still nets to the expected balance', async () => {
  await issue('a', 500n)          // one positive coin
  await issueDebit('a', -200n)    // studioSpend-shaped host debit
  assert.equal(await store.balance({ animaId: 'a' }), 300n)   // netted spendable

  const r = await store.reserve({ animaId: 'a' }, 300n, 'act-1')
  assert.ok(r.ok)
  assert.equal(r.locked, 500n)
  assert.equal(r.signaIds.length, 1)

  await store.settle(r.signaIds, 300n, 'act-1')   // charge exactly 300, refund 200
  // Spent 300 of the netted 300 → balance nets to 0 (200 refund − 200 debit).
  assert.equal(await store.balance({ animaId: 'a' }), 0n)
})

test('reserve: positive-only identity — numeric smallest-first selection unchanged (regression guard)', async () => {
  const c50 = await issue('a', 50n)
  const c100 = await issue('a', 100n)
  await issue('a', 900n)

  const r = await store.reserve({ animaId: 'a' }, 120n, 'act-1')
  assert.ok(r.ok)
  // greedy numeric smallest-first, stops once covered: exactly {50,100}, the 900 untouched.
  const selected = new Set(r.signaIds)
  assert.equal(selected.size, 2)
  assert.ok(selected.has(c50.id) && selected.has(c100.id))
  assert.equal(r.locked, 150n)
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

// ── ledger-hardening Debt #1: O(n) → ~O(k) reserve selection ─────────────────
//
// The fix pushes smallest-first ordering into Mongo via the `valorNum` sort-mirror, so reserve
// streams an index-backed ascending scan and stops once `amount` is covered — instead of loading
// the whole valid pool and sorting in JS. These tests prove the SELECTION is unchanged (still
// numeric smallest-first, NOT the lexicographic order string storage would give) and that the
// read is bounded (the full pool is no longer materialised).

// Maps the returned reservation's signaIds back to their valor via the ledger, so a test can
// assert exactly WHICH coins were selected.
async function selectedValors(signaIds: string[]): Promise<bigint[]> {
  const docs = await col.find({ id: { $in: signaIds } }).toArray()
  return docs.map(d => BigInt(d.valor as string)).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
}

test('SELECTION: greedy smallest-first uses NUMERIC order, not string order', async () => {
  // Values chosen so lexicographic string order ("10" < "100" < "2" < "30" < "9") diverges hard
  // from numeric order (2 < 9 < 10 < 30 < 100). A correct numeric greedy for amount=12 picks
  // 2 + 9 + 10 = 21 (stops once ≥ 12). A string-sorted greedy would instead pick 10 + 100 = 110.
  for (const v of [10n, 9n, 2n, 100n, 30n]) await issue('ord', v)

  const r = await store.reserve({ animaId: 'ord' }, 12n, 'act-ord')
  assert.ok(r.ok, 'reserve should cover 12 from a 151 pool')

  // Exact selection: the three smallest coins, in numeric terms.
  assert.deepEqual(await selectedValors(r.signaIds), [2n, 9n, 10n])
  assert.equal(r.locked, 21n)
  // Sanity: a lexicographic pick (10,100) would have locked 110 and NOT contained the 2-coin.
  assert.ok(r.locked < 110n, 'string-order selection would have overshot to 110')
})

test('SELECTION: parity with the reference greedy across mixed magnitudes', async () => {
  // A pool spanning magnitudes where string vs numeric order differ throughout.
  const pool = [1n, 5n, 8n, 12n, 40n, 99n, 100n, 250n, 1000n, 3n]
  for (const v of pool) await issue('mix', v)

  // Reference: exactly what the old full-load + JS numeric sort would have selected.
  const ascending = [...pool].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
  const amount = 30n
  const expected: bigint[] = []
  let covered = 0n
  for (const v of ascending) { if (covered >= amount) break; expected.push(v); covered += v }
  expected.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))

  const r = await store.reserve({ animaId: 'mix' }, amount, 'act-mix')
  assert.ok(r.ok)
  assert.deepEqual(await selectedValors(r.signaIds), expected)
  assert.equal(r.locked, covered)
})

test('BOUNDED READ: reserve does not materialise the whole pool (~O(k), not O(n))', async () => {
  // Instrument the collection: count documents the algorithm actually pulls (async-iterated or
  // toArray'd). The old impl `.toArray()`-loaded every valid signum, so this count would equal
  // the pool size; the fixed impl streams an ordered cursor and breaks after the ~k coins needed.
  const counter = { docs: 0 }
  const counting = new Proxy(col, {
    get(target, prop, recv) {
      if (prop === 'find') {
        return (...args: unknown[]) => {
          // @ts-expect-error variadic passthrough to the real driver signature
          const cursor = target.find(...args)
          const origToArray = cursor.toArray.bind(cursor)
          cursor.toArray = async () => { const arr = await origToArray(); counter.docs += arr.length; return arr }
          const origAsyncIter = cursor[Symbol.asyncIterator].bind(cursor)
          cursor[Symbol.asyncIterator] = function () {
            const it = origAsyncIter()
            const origNext = it.next.bind(it)
            it.next = async () => { const res = await origNext(); if (!res.done) counter.docs++; return res }
            return it
          }
          return cursor
        }
      }
      return Reflect.get(target, prop, recv)
    },
  }) as Collection
  const instrumented = new MongoSignorum(counting, client)

  // Large pool of uniform 1-point coins so covering amount=5 needs exactly k=5 coins.
  const POOL = 600
  for (let i = 0; i < POOL; i++) await issue('big', 1n)

  counter.docs = 0
  const r = await instrumented.reserve({ animaId: 'big' }, 5n, 'act-big')
  assert.ok(r.ok)
  assert.equal(r.locked, 5n)
  // The whole point: docs pulled is bounded by ~k (selection break + won re-read), NOT the pool.
  // Old O(n) impl would have pulled ≥ POOL here. A generous ceiling well under POOL proves the fix.
  assert.ok(counter.docs < POOL / 4, `pulled ${counter.docs} docs — expected ~O(k) ≪ ${POOL}`)
})

test('INDEX-BACKED: selection sort is served by an index, with no blocking in-memory sort', async () => {
  for (const v of [7n, 3n, 15n, 2n]) await issue('plan', v)

  // The exact shape reserve issues: valid pool for an identity, ordered smallest-first.
  const plan = await col
    .find({ animaId: 'plan', status: 'valid' })
    .sort({ valorNum: 1 })
    .explain('queryPlanner')

  const winning = JSON.stringify((plan as { queryPlanner?: { winningPlan?: unknown } }).queryPlanner?.winningPlan ?? plan)
  assert.ok(winning.includes('IXSCAN'), 'selection should be an index scan')
  // A COLLSCAN + blocking SORT stage is exactly the full-pool-then-sort the fix removes.
  assert.ok(!winning.includes('"stage":"SORT"') && !winning.includes('"SORT"'), 'must not use a blocking in-memory SORT')
})
