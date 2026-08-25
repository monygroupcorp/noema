import { test } from 'node:test'
import assert from 'node:assert/strict'
import { MemorySignorum } from '../../../src/ledger/MemorySignorum.js'

// settle(signaIds, actualImpetus, actumId)
//
// The overshoot case: greedy signum selection locks more valor than needed.
// settle() spends all locked signa AND issues a refund signum for the delta,
// so the user is charged exactly actualImpetus — no more.
//
// This is the treasury protection invariant:
//   sum(spent signa that settle issues) === actualImpetus (never more)

async function issueAndLock(s: MemorySignorum, animaId: string, valor: bigint, actumId: string) {
  const sig = await s.issue({ animaId, forma: 'minted', valor, auctor: 'test' })
  await s.lock([sig.id], actumId)
  return sig
}

test('settle with exact impetus: no refund issued, signa are spent', async () => {
  const s = new MemorySignorum()
  const sig = await issueAndLock(s, 'anima-1', 1000n, 'act-1')

  await s.settle([sig.id], 1000n, 'act-1')

  const hist = await s.history({ animaId: 'anima-1' })
  const spent = hist.filter(x => x.status === 'spent')
  const valid = hist.filter(x => x.status === 'valid')

  assert.equal(spent.length, 1)
  assert.equal(valid.length, 0)
  assert.equal(await s.balance({ animaId: 'anima-1' }), 0n)
})

test('settle with overshoot: refund signum issued for delta', async () => {
  const s = new MemorySignorum()
  const sig = await issueAndLock(s, 'anima-1', 1000n, 'act-1')

  await s.settle([sig.id], 400n, 'act-1')

  // Original signum is spent
  const hist = await s.history({ animaId: 'anima-1' })
  const spent = hist.find(x => x.id === sig.id)
  assert.equal(spent!.status, 'spent')

  // A refund signum was issued for the delta (1000 - 400 = 600)
  const refund = hist.find(x => x.status === 'valid')
  assert.ok(refund, 'refund signum must be present')
  assert.equal(refund!.valor, 600n)
  assert.equal(refund!.animaId, 'anima-1')
})

test('settle overshoot: user balance equals unspent delta', async () => {
  const s = new MemorySignorum()
  const sig = await issueAndLock(s, 'anima-1', 1000n, 'act-1')

  await s.settle([sig.id], 400n, 'act-1')

  assert.equal(await s.balance({ animaId: 'anima-1' }), 600n)
})

test('settle multiple signa with overshoot: refund is total locked minus actual', async () => {
  const s = new MemorySignorum()
  const a = await issueAndLock(s, 'anima-1', 400n, 'act-1')
  const b = await issueAndLock(s, 'anima-1', 600n, 'act-1')

  // locked = 1000n, actual = 700n → refund = 300n
  await s.settle([a.id, b.id], 700n, 'act-1')

  assert.equal(await s.balance({ animaId: 'anima-1' }), 300n)
})

test('settle with arcanum signa: refund preserves anonymous identity', async () => {
  const s = new MemorySignorum()
  const sig = await s.issue({ forma: 'arcanum', valor: 1000n, auctor: 'test', testis: 'hash-abc' })
  await s.lock([sig.id], 'act-1')

  await s.settle([sig.id], 300n, 'act-1')

  // Refund signum must also be arcanum with same testis so anonymous identity is preserved
  const bal = await s.balance({ commitment: 'hash-abc' })
  assert.equal(bal, 700n)
})

test('settle: spent signa have actumId and expensum set', async () => {
  const s = new MemorySignorum()
  const sig = await issueAndLock(s, 'anima-1', 500n, 'act-1')

  await s.settle([sig.id], 500n, 'act-1')

  const hist = await s.history({ animaId: 'anima-1' })
  const spent = hist.find(x => x.id === sig.id)!
  assert.equal(spent.actumId, 'act-1')
  assert.ok(spent.expensum instanceof Date)
})

// ── settle against a reservation that split a note (noema-306) ───────────────
//
// reserve() hands settle() a set that covers the ceiling EXACTLY, so the common case has no delta
// to mint at all. These prove settle's arithmetic on the new shape, and that the identity carried
// onto the split children survives a second hop through the delta mint.

test('settle after a split: an exactly-covering reservation mints no delta', async () => {
  const s = new MemorySignorum()
  await s.issue({ animaId: 'anima-1', forma: 'minted', valor: 1000n, auctor: 'test' })

  const r = await s.reserve({ animaId: 'anima-1' }, 400n, 'act-1')
  assert.ok(r.ok)
  await s.settle(r.signaIds, 400n, 'act-1')

  const hist = await s.history({ animaId: 'anima-1' })
  assert.equal(hist.filter(x => x.auctor === 'settle:delta').length, 0, 'exact cover leaves no delta to refund')
  assert.equal(await s.balance({ animaId: 'anima-1' }), 600n, 'charged exactly the actual impetus')
})

test('settle after a split: underspend refunds the delta on top of the change', async () => {
  const s = new MemorySignorum()
  await s.issue({ animaId: 'anima-1', forma: 'minted', valor: 1000n, auctor: 'test' })

  const r = await s.reserve({ animaId: 'anima-1' }, 400n, 'act-1')
  assert.ok(r.ok)
  await s.settle(r.signaIds, 150n, 'act-1')   // ran cheaper than the ceiling → 250 delta

  const hist = await s.history({ animaId: 'anima-1' })
  const delta = hist.find(x => x.auctor === 'settle:delta')
  assert.ok(delta, 'delta refund must be present')
  assert.equal(delta.valor, 250n)
  assert.equal(delta.forma, 'minted')          // provenance survived the split
  // Net cost is exactly what the run consumed: 1000 − 150.
  assert.equal(await s.balance({ animaId: 'anima-1' }), 850n)
})

test('settle after a split: an arcanum reservation keeps the commitment through both mints', async () => {
  const s = new MemorySignorum()
  await s.issue({ forma: 'arcanum', valor: 1000n, auctor: 'test', testis: 'hash-abc' })

  const r = await s.reserve({ commitment: 'hash-abc' }, 400n, 'act-1')
  assert.ok(r.ok)
  await s.settle(r.signaIds, 150n, 'act-1')

  assert.equal(await s.balance({ commitment: 'hash-abc' }), 850n)
})

test('settle with zero actual impetus: full refund, nothing spent', async () => {
  const s = new MemorySignorum()
  const sig = await issueAndLock(s, 'anima-1', 800n, 'act-1')

  await s.settle([sig.id], 0n, 'act-1')

  // All valor returned as refund
  assert.equal(await s.balance({ animaId: 'anima-1' }), 800n)
})
