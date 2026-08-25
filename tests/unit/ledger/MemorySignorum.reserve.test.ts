import { test } from 'node:test'
import assert from 'node:assert/strict'
import { MemorySignorum } from '../../../src/ledger/MemorySignorum.js'

// reserve(by, amount, actumId) — the atomic "debit-if-sufficient" primitive.
// transfer(from, to, amount) — spend-and-reissue built on reserve + settle.
//
// These prove the caller-facing contract; the real adversarial-concurrency proof lives in
// the Mongo test (atomicity is trivial in a single-threaded Map, real only in Mongo).

async function issue(s: MemorySignorum, animaId: string, valor: bigint) {
  return s.issue({ animaId, forma: 'minted', valor, auctor: 'test' })
}

// ── reserve ──────────────────────────────────────────────────────────────────

test('reserve: covers the amount, locks selected signa, returns their total', async () => {
  const s = new MemorySignorum()
  await issue(s, 'a', 300n)
  await issue(s, 'a', 300n)
  await issue(s, 'a', 300n)

  const r = await s.reserve({ animaId: 'a' }, 500n, 'act-1')
  assert.ok(r.ok)
  assert.ok(r.locked >= 500n)                       // greedy overshoot allowed
  // locked signa are no longer spendable
  assert.equal(await s.balance({ animaId: 'a' }), 900n - r.locked)
})

test('reserve: greedy smallest-first, and the reservation holds exactly the amount', async () => {
  const s = new MemorySignorum()
  await issue(s, 'a', 100n)
  await issue(s, 'a', 900n)

  const r = await s.reserve({ animaId: 'a' }, 50n, 'act-1')
  assert.ok(r.ok)
  assert.equal(r.locked, 50n)                       // the 100 is split, not held whole
  assert.equal(r.signaIds.length, 1)
  // The 900 was never a candidate; the 100's unused half is spendable immediately.
  assert.equal(await s.balance({ animaId: 'a' }), 950n)
})

test('reserve: insufficient balance fails closed and locks nothing', async () => {
  const s = new MemorySignorum()
  await issue(s, 'a', 400n)

  const r = await s.reserve({ animaId: 'a' }, 1000n, 'act-1')
  assert.equal(r.ok, false)
  if (!r.ok) assert.equal(r.available, 400n)
  // nothing left locked — the whole balance is still spendable
  assert.equal(await s.balance({ animaId: 'a' }), 400n)
  const hist = await s.history({ animaId: 'a' })
  assert.ok(hist.every(x => x.status === 'valid'))
})

test('reserve: amount <= 0 is a no-op success', async () => {
  const s = new MemorySignorum()
  await issue(s, 'a', 100n)
  const r = await s.reserve({ animaId: 'a' }, 0n, 'act-1')
  assert.ok(r.ok)
  assert.deepEqual(r.signaIds, [])
  assert.equal(r.locked, 0n)
  assert.equal(await s.balance({ animaId: 'a' }), 100n)
})

test('reserve then settle: sender charged exactly amount, overshoot refunded', async () => {
  const s = new MemorySignorum()
  await issue(s, 'a', 1000n)

  const r = await s.reserve({ animaId: 'a' }, 700n, 'act-1')
  assert.ok(r.ok)
  await s.settle(r.signaIds, 700n, 'act-1')
  assert.equal(await s.balance({ animaId: 'a' }), 300n)
})

test('reserve then release: charges nothing', async () => {
  const s = new MemorySignorum()
  await issue(s, 'a', 1000n)

  const r = await s.reserve({ animaId: 'a' }, 700n, 'act-1')
  assert.ok(r.ok)
  await s.release(r.signaIds)
  assert.equal(await s.balance({ animaId: 'a' }), 1000n)
})

test('reserve: two reservations on one pool never overlap or overdraw', async () => {
  const s = new MemorySignorum()
  await issue(s, 'a', 600n)
  await issue(s, 'a', 600n)   // pool = 1200

  const r1 = await s.reserve({ animaId: 'a' }, 600n, 'act-1')
  const r2 = await s.reserve({ animaId: 'a' }, 600n, 'act-2')
  assert.ok(r1.ok && r2.ok)
  const ids1 = new Set(r1.signaIds)
  assert.ok(r2.signaIds.every(id => !ids1.has(id)), 'no signum reserved twice')

  // a third reservation cannot be covered
  const r3 = await s.reserve({ animaId: 'a' }, 600n, 'act-3')
  assert.equal(r3.ok, false)
})

// ── negative-valor debit exclusion (noema-083) ───────────────────────────────
//
// The ledger holds negative-valor debit signa (nexus:studioSpend / tee:spend / publish:scanFee
// mint `valor: -impetus, status:'valid'` rows). balance() NETS them; reserve() must never treat
// one as a spend candidate, or it could be locked and fed to settle(), corrupting cover arithmetic.

// A studioSpend-shaped host debit: negative valor, status becomes 'valid' on issue.
async function issueDebit(s: MemorySignorum, animaId: string, valor: bigint) {
  return s.issue({ animaId, forma: 'integer', valor, auctor: 'nexus:studioSpend', testis: 'materia-1' })
}

test('reserve: never selects a negative-valor debit signum, and leaves it untouched', async () => {
  const s = new MemorySignorum()
  const p1 = await issue(s, 'a', 100n)
  const p2 = await issue(s, 'a', 300n)
  const neg = await issueDebit(s, 'a', -50n)
  assert.equal(await s.balance({ animaId: 'a' }), 350n)   // balance nets the debit

  const r = await s.reserve({ animaId: 'a' }, 120n, 'act-1')
  assert.ok(r.ok)
  // the debit is never a spend candidate…
  assert.ok(!r.signaIds.includes(neg.id), 'negative debit must never be reserved')
  // …only positives are drawn on: the 100 is locked whole, the 300 splits into the 20 shortfall.
  const reserved = await s.history({ animaId: 'a' })
  const lockedRows = reserved.filter(x => r.signaIds.includes(x.id))
  assert.ok(lockedRows.every(x => x.valor > 0n), 'only positives selected')
  assert.ok(r.signaIds.includes(p1.id))
  assert.ok(!r.signaIds.includes(p2.id))
  assert.equal(reserved.find(x => x.id === p2.id)!.status, 'spent')   // consumed by the split
  assert.equal(r.locked, 120n)
  // …and the debit is left byte-identical: still valid, still nets in balance/history.
  const negRow = (await s.history({ animaId: 'a' })).find(x => x.id === neg.id)
  assert.ok(negRow)
  assert.equal(negRow.status, 'valid')
  assert.equal(negRow.valor, -50n)
})

test('reserve+settle: spends only positives; the debit still nets to the expected balance', async () => {
  const s = new MemorySignorum()
  await issue(s, 'a', 500n)              // one positive coin
  await issueDebit(s, 'a', -200n)        // studioSpend-shaped host debit
  assert.equal(await s.balance({ animaId: 'a' }), 300n)   // netted spendable

  // Reserve the full netted balance — succeeds by locking positives only (the 500 coin splits).
  const r = await s.reserve({ animaId: 'a' }, 300n, 'act-1')
  assert.ok(r.ok)
  assert.equal(r.locked, 300n)
  assert.equal(r.signaIds.length, 1)

  await s.settle(r.signaIds, 300n, 'act-1')   // charges exactly 300; the change was already returned
  // Spent 300 of the netted 300 → balance nets to 0 (200 refund − 200 debit).
  assert.equal(await s.balance({ animaId: 'a' }), 0n)
})

test('reserve: positive-only identity — selection unchanged, only the last note splits', async () => {
  const s = new MemorySignorum()
  const c50 = await issue(s, 'a', 50n)
  const c100 = await issue(s, 'a', 100n)
  const c900 = await issue(s, 'a', 900n)

  const r = await s.reserve({ animaId: 'a' }, 120n, 'act-1')
  assert.ok(r.ok)
  // Greedy smallest-first, stops once covered: {50, 100} selected, the 900 untouched. The 50 is
  // fully consumed by the cover so it stays locked whole; the 100 over-covers and splits 70/30.
  assert.equal(r.signaIds.length, 2)
  assert.equal(r.signaIds[0], c50.id)
  assert.equal(r.locked, 120n)

  const hist = await s.history({ animaId: 'a' })
  const byId = new Map(hist.map(x => [x.id, x]))
  assert.equal(byId.get(c50.id)!.status, 'locked')
  assert.equal(byId.get(c100.id)!.status, 'spent')      // consumed by the split, valor untouched
  assert.equal(byId.get(c100.id)!.valor, 100n)
  assert.equal(byId.get(c900.id)!.status, 'valid')
  assert.equal(byId.get(r.signaIds[1])!.valor, 70n)     // the locked child

  // Balance conservation: nothing minted, nothing destroyed.
  assert.equal(await s.balance({ animaId: 'a' }), 1050n - 120n)
})

// ── change at reserve time (noema-306) ───────────────────────────────────────
//
// A reservation must hold exactly its ceiling. Before this, selection locked WHOLE notes until
// the ceiling was covered, so a small reservation against one large note froze the whole note for
// the run's duration and only returned the difference at settle. The over-covering note is now
// split at reserve time: consumed, and replaced by a locked child for the exact shortfall plus a
// spendable child for the remainder.
//
// NON-VACUITY: revert `reserve`'s split (lock whole notes again) and the over-lock test below
// fails — the change is no longer spendable while the reservation is live.

const CHANGE_AUCTOR = 'reserve:change'

test('reserve: a small reservation against one big note leaves the change spendable', async () => {
  const s = new MemorySignorum()
  const big = await issue(s, 'a', 10_000n)

  const r = await s.reserve({ animaId: 'a' }, 25n, 'act-1')
  assert.ok(r.ok)
  assert.equal(r.locked, 25n, 'the reservation holds exactly the ceiling, not the whole note')

  // The over-lock assertion: everything but the ceiling is spendable WHILE the run is in flight.
  assert.equal(await s.balance({ animaId: 'a' }), 9_975n)

  // Balance conservation: locked + spendable == what the identity held before.
  assert.equal(await s.balance({ animaId: 'a' }) + r.locked, 10_000n)

  const hist = await s.history({ animaId: 'a' })
  const parent = hist.find(x => x.id === big.id)!
  assert.equal(parent.status, 'spent', 'the split note is consumed, never mutated in value')
  assert.equal(parent.valor, 10_000n)
  assert.equal(parent.actumId, 'act-1')

  const children = hist.filter(x => x.auctor === CHANGE_AUCTOR)
  assert.equal(children.length, 2)
  assert.equal(children.reduce((sum, c) => sum + c.valor, 0n), parent.valor, 'children sum to the parent')
  assert.equal(children.filter(c => c.status === 'locked').length, 1)
  assert.equal(children.filter(c => c.status === 'valid').length, 1)
  // Provenance carries to both halves.
  assert.ok(children.every(c => c.animaId === 'a' && c.forma === 'minted'))
})

test('reserve: an exact cover mints nothing — no split', async () => {
  const s = new MemorySignorum()
  const c = await issue(s, 'a', 300n)

  const r = await s.reserve({ animaId: 'a' }, 300n, 'act-1')
  assert.ok(r.ok)
  assert.deepEqual(r.signaIds, [c.id])
  assert.equal(r.locked, 300n)

  const hist = await s.history({ animaId: 'a' })
  assert.equal(hist.length, 1, 'no children minted on an exact cover')
  assert.equal(hist[0].status, 'locked')
})

test('reserve: insufficient funds leaves no orphan children', async () => {
  const s = new MemorySignorum()
  await issue(s, 'a', 400n)

  const r = await s.reserve({ animaId: 'a' }, 1000n, 'act-1')
  assert.equal(r.ok, false)

  const hist = await s.history({ animaId: 'a' })
  assert.equal(hist.length, 1, 'a failed reservation mints nothing')
  assert.equal(hist[0].status, 'valid')
  assert.equal(await s.balance({ animaId: 'a' }), 400n)
})

test('reserve then release after a split: the locked child returns to spendable, value conserved', async () => {
  const s = new MemorySignorum()
  const big = await issue(s, 'a', 1000n)

  const r = await s.reserve({ animaId: 'a' }, 250n, 'act-1')
  assert.ok(r.ok)
  await s.release(r.signaIds)

  assert.equal(await s.balance({ animaId: 'a' }), 1000n, 'a released reservation charges nothing')
  const hist = await s.history({ animaId: 'a' })
  assert.equal(hist.find(x => x.id === big.id)!.status, 'spent', 'the parent stays terminal')
  assert.equal(hist.filter(x => x.status === 'locked').length, 0)
})

test('reserve: arcanum notes split with the commitment carried to both children', async () => {
  const s = new MemorySignorum()
  await s.issue({ forma: 'arcanum', valor: 1000n, auctor: 'test', testis: 'hash-abc' })

  const r = await s.reserve({ commitment: 'hash-abc' }, 400n, 'act-1')
  assert.ok(r.ok)
  assert.equal(r.locked, 400n)
  assert.equal(await s.balance({ commitment: 'hash-abc' }), 600n)

  const hist = await s.history({ commitment: 'hash-abc' })
  const children = hist.filter(x => x.auctor === CHANGE_AUCTOR)
  assert.equal(children.length, 2)
  // Privacy partition intact: anonymous children keep the commitment, never gain an animaId.
  assert.ok(children.every(c => c.forma === 'arcanum' && c.testis === 'hash-abc' && c.animaId === undefined))
})

// ── transfer ───────────────────────────────────────────────────────────────

test('transfer: moves exactly amount from sender to recipient', async () => {
  const s = new MemorySignorum()
  await issue(s, 'sender', 1000n)

  const t = await s.transfer({ animaId: 'sender' }, { animaId: 'recipient' }, 400n)
  assert.ok(t.ok)
  assert.equal(await s.balance({ animaId: 'sender' }), 600n)
  assert.equal(await s.balance({ animaId: 'recipient' }), 400n)
})

test('transfer: greedy overshoot is refunded to the sender (conserves value)', async () => {
  const s = new MemorySignorum()
  await issue(s, 'sender', 100n)
  await issue(s, 'sender', 900n)   // to cover 150 it must lock 1000, refund 850

  const t = await s.transfer({ animaId: 'sender' }, { animaId: 'recipient' }, 150n)
  assert.ok(t.ok)
  assert.equal(await s.balance({ animaId: 'sender' }), 850n)
  assert.equal(await s.balance({ animaId: 'recipient' }), 150n)
})

test('transfer: insufficient sender fails closed — no money moves', async () => {
  const s = new MemorySignorum()
  await issue(s, 'sender', 100n)

  const t = await s.transfer({ animaId: 'sender' }, { animaId: 'recipient' }, 500n)
  assert.equal(t.ok, false)
  if (!t.ok) assert.equal(t.available, 100n)
  assert.equal(await s.balance({ animaId: 'sender' }), 100n)
  assert.equal(await s.balance({ animaId: 'recipient' }), 0n)
})

test('transfer: honours recipient forma/auctor override', async () => {
  const s = new MemorySignorum()
  await issue(s, 'sender', 500n)

  await s.transfer({ animaId: 'sender' }, { animaId: 'platform' }, 200n, { forma: 'reward', auctor: 'tee:spend' })
  const hist = await s.history({ animaId: 'platform' })
  assert.equal(hist.length, 1)
  assert.equal(hist[0].forma, 'reward')
  assert.equal(hist[0].auctor, 'tee:spend')
})
