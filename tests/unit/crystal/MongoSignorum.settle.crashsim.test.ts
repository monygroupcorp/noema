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

// ─────────────────────────────────────────────────────────────────────────────
// noema-306 — the SPLIT crash windows, same gate shape as settle's above.
//
// `reserve` splits an over-covering note into two children and consumes the parent. Left
// non-atomic that opens two windows: children minted while the parent stays spendable (value
// created), or the parent consumed with the children never minted (value destroyed). The split
// runs inside the same single-identity transaction discipline `settle` uses, so a crash at either
// point rolls the whole split back and the reservation degrades to the pre-split shape — whole
// notes locked, `locked >= amount`, nothing minted, nothing lost.
// ─────────────────────────────────────────────────────────────────────────────

/** Throws on the collection method named, standing in for a process kill at that write. */
function crashOn(col: Collection, method: 'insertMany' | 'updateOne'): { col: Collection; arm: () => void } {
  let armed = false
  const facade = new Proxy(col, {
    get(target, prop, receiver) {
      if (prop === method) {
        return (...args: unknown[]) => {
          if (armed) throw new Error(`injected crash: process killed at ${method}`)
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          return (target as any)[method](...args)
        }
      }
      const value = Reflect.get(target, prop, receiver)
      return typeof value === 'function' ? value.bind(target) : value
    },
  })
  return { col: facade as Collection, arm: () => { armed = true } }
}

test('crash while minting the split children: nothing is minted, the reservation still covers, no value lost', async () => {
  const seed = new MongoSignorum(realCol, client)
  const big = await seed.issue(makeSignum({ valor: 1000n }))

  const { col: crashing, arm } = crashOn(realCol, 'insertMany')
  const signorum = new MongoSignorum(crashing, client)
  arm()

  const r = await signorum.reserve({ animaId: 'anima-crash' }, 250n, 'actum-split-a')
  assert.ok(r.ok, 'a legitimate reservation still succeeds — the split refines the hold, it is not the debit')
  assert.equal(r.locked, 1000n, 'degrades to the pre-split shape: the note is held whole')

  const history = await signorum.history({ animaId: 'anima-crash' })
  assert.equal(history.length, 1, 'no orphan children — the split rolled back whole')
  assert.equal(history[0].id, big.id)
  assert.equal(history[0].status, 'locked', 'the parent was never consumed')

  // Recoverable end-to-end: releasing the reservation restores the full value, none created.
  await signorum.release(r.signaIds)
  assert.equal(await signorum.balance({ animaId: 'anima-crash' }), 1000n)

  // Non-vacuity: the injected crash is what suppressed the split, not an absent implementation.
  // The identical reserve on an unarmed collection does split.
  const clean = new MongoSignorum(realCol, client)
  const r2 = await clean.reserve({ animaId: 'anima-crash' }, 250n, 'actum-split-a2')
  assert.ok(r2.ok)
  assert.equal(r2.locked, 250n)
  assert.equal(await realCol.countDocuments({ auctor: 'reserve:change' }), 2)
})

test('crash while consuming the split parent: the children roll back with it, no double-spend', async () => {
  const seed = new MongoSignorum(realCol, client)
  const big = await seed.issue(makeSignum({ valor: 1000n }))

  const { col: crashing, arm } = crashOn(realCol, 'updateOne')
  const signorum = new MongoSignorum(crashing, client)
  arm()

  const r = await signorum.reserve({ animaId: 'anima-crash' }, 250n, 'actum-split-b')
  assert.ok(r.ok)
  assert.equal(r.locked, 1000n)

  // The inverse window: children must NOT survive a parent that was never consumed, or the
  // identity would hold both the parent's value and its two halves.
  const history = await signorum.history({ animaId: 'anima-crash' })
  assert.equal(history.length, 1, 'the children rolled back with the parent')
  assert.equal(history[0].id, big.id)
  assert.equal(history[0].status, 'locked')

  await signorum.release(r.signaIds)
  assert.equal(await signorum.balance({ animaId: 'anima-crash' }), 1000n)

  // Non-vacuity: the same reserve on an unarmed collection does split.
  const clean = new MongoSignorum(realCol, client)
  const r2 = await clean.reserve({ animaId: 'anima-crash' }, 250n, 'actum-split-b2')
  assert.ok(r2.ok)
  assert.equal(r2.locked, 250n)
  assert.equal(await realCol.countDocuments({ auctor: 'reserve:change' }), 2)
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
