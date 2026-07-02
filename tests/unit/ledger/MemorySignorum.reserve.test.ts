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

test('reserve: greedy smallest-first minimises overshoot', async () => {
  const s = new MemorySignorum()
  await issue(s, 'a', 100n)
  await issue(s, 'a', 900n)

  const r = await s.reserve({ animaId: 'a' }, 50n, 'act-1')
  assert.ok(r.ok)
  assert.equal(r.locked, 100n)                      // took the 100, not the 900
  assert.equal(r.signaIds.length, 1)
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
