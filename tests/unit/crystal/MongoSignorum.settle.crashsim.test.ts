import { test, before, after, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { MongoClient, Collection } from 'mongodb'
import { MongoSignorum } from '../../../src/crystal/MongoSignorum.js'
import type { Signum } from '../../../src/types/significandi.js'

// ─────────────────────────────────────────────────────────────────────────────
// Ledger Debt #2 — crash-simulation HARD GATE (Bridge ruling R4).
//
// `settle` performs two writes: it spends the locked signa, then issues the overshoot refund.
// Left non-atomic, a crash BETWEEN them spends the full locked `total` yet never issues the refund
// — the identity silently loses `amount + overshoot`. This test injects exactly that crash (the
// refund insert throws, standing in for a process kill / disconnect / OOM between the two writes)
// and asserts the ledger is left CONSISTENT: the spend rolled back, the signa are still `locked`
// and fully recoverable, no value lost.
//
// It is a before/after gate:
//   • PRE-FIX (spend + refund as separate writes): the spend has already committed, so after the
//     crash the signum is `spent` with no refund → the recoverability assertion FAILS. Demonstrate
//     by reverting the settle body to two sequential writes.
//   • POST-FIX (single withTransaction): the abort rolls the spend back → signum stays `locked` →
//     PASSES.
//
// Requires a replica-set Mongo (transactions are unavailable on standalone) — this is why the
// crystal-db CI Mongo is a single-node replica set (ruling R3).
// ─────────────────────────────────────────────────────────────────────────────

const URI = process.env.MONGO_PASS ?? process.env.MONGODB_URI ?? 'mongodb://localhost:27017'
const DB = 'noemaplane_test'
const COL = 'signa_crashsim_unit'

let client: MongoClient
let realCol: Collection

// A collection facade that throws on `insertOne` once armed. During settle the ONLY insertOne is
// the overshoot refund, so arming it right before the settle call injects the crash precisely
// between the spend (an updateMany) and the refund (the insertOne).
function crashOnRefundInsert(col: Collection): { col: Collection; arm: () => void } {
  let armed = false
  const facade = new Proxy(col, {
    get(target, prop, receiver) {
      if (prop === 'insertOne') {
        return (...args: unknown[]) => {
          if (armed) throw new Error('injected crash: process killed between spend and refund')
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          return (target as any).insertOne(...args)
        }
      }
      const value = Reflect.get(target, prop, receiver)
      return typeof value === 'function' ? value.bind(target) : value
    },
  })
  return { col: facade as Collection, arm: () => { armed = true } }
}

function makeSignum(overrides: Partial<Omit<Signum, 'id' | 'natum' | 'status'>> = {}): Omit<Signum, 'id' | 'natum' | 'status'> {
  return { forma: 'minted', valor: 300n, auctor: 'system:test', animaId: 'anima-crash', ...overrides }
}

before(async () => {
  client = new MongoClient(URI)
  await client.connect()
  realCol = client.db(DB).collection(COL)
  await realCol.createIndex({ id: 1 }, { unique: true })
})

afterEach(async () => { await realCol.deleteMany({}) })

after(async () => {
  await client.db(DB).dropCollection(COL).catch(() => {})
  await client.close()
})

test('crash between spend and refund leaves the ledger consistent — spend rolls back, signum stays locked (recoverable)', async () => {
  // Seed with the UNwrapped collection so setup writes are real; a signum worth 300.
  const seed = new MongoSignorum(realCol, client)
  const s = await seed.issue(makeSignum({ valor: 300n }))
  await seed.lock([s.id], 'actum-crash')

  // Now settle spending only 100 of 300 → a 200 overshoot must be refunded. Arm the crash so the
  // refund insert throws AFTER the spend write, exactly reproducing the value-loss window.
  const { col: crashing, arm } = crashOnRefundInsert(realCol)
  const signorum = new MongoSignorum(crashing, client)
  arm()

  await assert.rejects(
    () => signorum.settle([s.id], 100n, 'actum-crash'),
    /injected crash/,
    'settle must surface the crash, not swallow it',
  )

  // The invariant: no value was silently lost. The transaction must have rolled the spend back, so
  // the signum is still `locked` (NOT `spent`) and its full 300 is recoverable.
  const history = await signorum.history({ animaId: 'anima-crash' })
  assert.equal(history.length, 1, 'no refund should have been issued (and no orphaned doc)')
  assert.equal(history[0].status, 'locked', 'spend must roll back — signum stays locked, not spent')
  assert.equal(history[0].valor, 300n)

  // Recoverable end-to-end: releasing the still-locked signum restores the full balance. Pre-fix
  // this is 0 (the 300 was spent and never refunded).
  await signorum.release([s.id])
  const balance = await signorum.balance({ animaId: 'anima-crash' })
  assert.equal(balance, 300n, 'full value must be recoverable after the crash — none lost')
})

test('crash on an exact-settle (no overshoot) never fires — single spend write, nothing to lose', async () => {
  // When actualImpetus == total there is no refund insert, so the crash arming is a no-op and the
  // spend commits cleanly. Guards that the txn wrapper does not regress the common no-refund path.
  const seed = new MongoSignorum(realCol, client)
  const s = await seed.issue(makeSignum({ valor: 100n }))
  await seed.lock([s.id], 'actum-exact')

  const { col: crashing, arm } = crashOnRefundInsert(realCol)
  const signorum = new MongoSignorum(crashing, client)
  arm()

  await signorum.settle([s.id], 100n, 'actum-exact') // no delta → no refund insert → no crash
  const history = await signorum.history({ animaId: 'anima-crash' })
  assert.equal(history.length, 1)
  assert.equal(history[0].status, 'spent')
})
