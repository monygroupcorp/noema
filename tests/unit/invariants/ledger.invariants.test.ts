// =============================================================================
// LEDGER INVARIANTS
// =============================================================================
// These tests assert properties that must hold forever, regardless of what
// gets built on top. They are not unit tests of specific functions — they are
// proofs of business rules.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { MemorySignorum } from '../../../src/ledger/MemorySignorum.js'
import { mintOwnedPurse, redeemOwnedPurse } from '../../../src/crystal/ownedPurse.js'
import { MemoryBursarium, purseCredits } from './_purseKit.js'

// ── Privacy Partition ────────────────────────────────────────────────────────
// RULE: forma 'arcanum' and 'tessera' NEVER have animaId.
// If this is violated, the anonymous→identified hop chain collapses.

test('INVARIANT: issuing arcanum signum with animaId throws', async () => {
  const s = new MemorySignorum()

  await assert.rejects(
    () => s.issue({ animaId: 'anima-1', forma: 'arcanum', valor: 100n, auctor: 'test' }),
    /privacy.*partition|arcanum.*animaId|anonymous.*identity/i
  )
})

test('INVARIANT: issuing tessera signum with animaId throws', async () => {
  const s = new MemorySignorum()

  await assert.rejects(
    () => s.issue({ animaId: 'anima-1', forma: 'tessera', valor: 100n, auctor: 'test' }),
    /privacy.*partition|tessera.*animaId|anonymous.*identity/i
  )
})

test('INVARIANT: arcanum signum in ledger never has animaId', async () => {
  const s = new MemorySignorum()
  const sig = await s.issue({ forma: 'arcanum', valor: 500n, auctor: 'test', testis: 'hash-x' })

  assert.equal(sig.animaId, undefined)
})

// ── One-Way Commitment Link ──────────────────────────────────────────────────
// RULE: the link from deposit → commitment is one-directional.
// An arcanum signum must never carry commitment — it IS the anonymous end.
// A back-pointer would collapse the cryptographic break between deposit and session.

test('INVARIANT: issuing arcanum signum with commitment throws', async () => {
  const s = new MemorySignorum()

  await assert.rejects(
    () => s.issue({ forma: 'arcanum', valor: 100n, auctor: 'test', testis: 'hash-x', commitment: 'deposit-hash' }),
    /one.way|back.pointer|arcanum.*commitment|link.*direction/i
  )
})

test('INVARIANT: tessera signum with commitment throws', async () => {
  const s = new MemorySignorum()

  await assert.rejects(
    () => s.issue({ forma: 'tessera', valor: 100n, auctor: 'test', commitment: 'deposit-hash' }),
    /one.way|back.pointer|tessera.*commitment|link.*direction/i
  )
})

// ── No Double-Spend ──────────────────────────────────────────────────────────
// RULE: a settled (spent) signum cannot be settled again.
// Violating this would allow credits to be used more than once.

test('INVARIANT: settling an already-settled signum throws', async () => {
  const s = new MemorySignorum()
  const sig = await s.issue({ animaId: 'anima-1', forma: 'minted', valor: 100n, auctor: 'test' })

  await s.lock([sig.id], 'act-1')
  await s.settle([sig.id], 100n, 'act-1')

  // A second lock attempt on the spent signum will fail (not found as valid),
  // but the deeper protection is that settle() itself rejects already-spent signa
  const sig2 = await s.issue({ animaId: 'anima-1', forma: 'minted', valor: 100n, auctor: 'test' })
  await s.lock([sig2.id], 'act-2')

  await assert.rejects(
    () => s.settle([sig.id, sig2.id], 50n, 'act-2'),
    /already spent|invalid status|spent/i
  )
})

// ── Settle Only on Locked Signa ──────────────────────────────────────────────
// RULE: settle() must only operate on locked signa.
// Settling a valid signum would bypass the balance check + lock step,
// allowing charges without a pre-flight reservation.

test('INVARIANT: settle on a valid (unlocked) signum throws', async () => {
  const s = new MemorySignorum()
  const sig = await s.issue({ animaId: 'anima-1', forma: 'minted', valor: 500n, auctor: 'test' })

  await assert.rejects(
    () => s.settle([sig.id], 200n, 'act-1'),
    /not locked|invalid status|must be locked/i
  )
})

// ── Value Conservation ───────────────────────────────────────────────────────
// RULE: no value is created or destroyed by the ledger.
// total issued = total currently held (balance + locked + spent face values)

test('INVARIANT: value is conserved through full issue→lock→settle cycle', async () => {
  const s = new MemorySignorum()
  const issued = 1000n
  const charged = 350n

  const sig = await s.issue({ animaId: 'anima-1', forma: 'minted', valor: issued, auctor: 'test' })
  await s.lock([sig.id], 'act-1')
  await s.settle([sig.id], charged, 'act-1')

  // Conservation: user's balance after = what they had before - what they were charged.
  // The refund signum re-credits the delta — the user's net cost is exactly charged.
  const balance = await s.balance({ animaId: 'anima-1' })
  assert.equal(balance, issued - charged, 'net balance must equal issued minus charged')
})

test('INVARIANT: value is conserved through lock→release (no spend)', async () => {
  const s = new MemorySignorum()
  const sig = await s.issue({ animaId: 'anima-1', forma: 'minted', valor: 800n, auctor: 'test' })

  await s.lock([sig.id], 'act-1')
  await s.release([sig.id])

  assert.equal(await s.balance({ animaId: 'anima-1' }), 800n)
})

// ── Balance Excludes Locked Signa ────────────────────────────────────────────
// RULE: locked signa are unavailable for spending.
// This prevents a race where two concurrent executions both see the same balance.

test('INVARIANT: locked signa do not appear in balance', async () => {
  const s = new MemorySignorum()
  const a = await s.issue({ animaId: 'anima-1', forma: 'minted', valor: 400n, auctor: 'test' })
  await s.issue({ animaId: 'anima-1', forma: 'minted', valor: 600n, auctor: 'test' })

  await s.lock([a.id], 'act-1')

  // Only the unlocked 600n is available
  assert.equal(await s.balance({ animaId: 'anima-1' }), 600n)
})

// ── Anonymous Path (arcanum) ─────────────────────────────────────────────────
// RULE: the arcanum identity path must be fully symmetric with the identified
// path. Knowing H(secret) is sufficient to query balance, lock, settle, and
// receive refunds — no animaId required at any step.

test('INVARIANT: arcanum balance query returns only signa for that hash', async () => {
  const s = new MemorySignorum()
  await s.issue({ forma: 'arcanum', valor: 300n, auctor: 'test', testis: 'hash-anon' })
  await s.issue({ forma: 'arcanum', valor: 200n, auctor: 'test', testis: 'hash-anon' })
  await s.issue({ forma: 'arcanum', valor: 999n, auctor: 'test', testis: 'hash-other' })

  assert.equal(await s.balance({ commitment: 'hash-anon' }), 500n, 'must not include other-hash signa')
})

test('INVARIANT: locked arcanum signa do not appear in balance', async () => {
  const s = new MemorySignorum()
  const a = await s.issue({ forma: 'arcanum', valor: 400n, auctor: 'test', testis: 'hash-anon' })
  await s.issue({ forma: 'arcanum', valor: 600n, auctor: 'test', testis: 'hash-anon' })

  await s.lock([a.id], 'act-1')

  assert.equal(await s.balance({ commitment: 'hash-anon' }), 600n)
})

test('INVARIANT: value is conserved through arcanum issue→lock→settle cycle', async () => {
  const s = new MemorySignorum()
  const issued = 1000n
  const charged = 350n

  const sig = await s.issue({ forma: 'arcanum', valor: issued, auctor: 'test', testis: 'hash-anon' })
  await s.lock([sig.id], 'act-1')
  await s.settle([sig.id], charged, 'act-1')

  assert.equal(
    await s.balance({ commitment: 'hash-anon' }),
    issued - charged,
    'net arcanum balance must equal issued minus charged'
  )
})

test('INVARIANT: settle refund on arcanum signum has same testis and no animaId', async () => {
  const s = new MemorySignorum()
  const sig = await s.issue({ forma: 'arcanum', valor: 1000n, auctor: 'test', testis: 'hash-anon' })
  await s.lock([sig.id], 'act-1')
  await s.settle([sig.id], 400n, 'act-1')

  const history = await s.history({ commitment: 'hash-anon' })
  const refund = history.find(s => s.auctor === 'settle:delta')

  assert.ok(refund, 'refund signum must exist in arcanum history')
  assert.equal(refund!.testis, 'hash-anon', 'refund must preserve the testis commitment hash')
  assert.equal(refund!.animaId, undefined, 'refund must never have animaId')
  assert.equal(refund!.forma, 'arcanum', 'refund must remain arcanum forma')
  assert.equal(refund!.valor, 600n, 'refund valor must be the overshoot delta')
})

test('INVARIANT: tessera settle refund does not acquire animaId', async () => {
  const s = new MemorySignorum()
  // Tessera has no animaId — if settle() issued a refund with animaId set, issue() would throw
  // via the privacy partition guard. A clean settle() proves the refund stayed anonymous.
  const sig = await s.issue({ forma: 'tessera', valor: 1000n, auctor: 'test', modoId: 'modo-1' })
  await s.lock([sig.id], 'act-1')
  await assert.doesNotReject(
    () => s.settle([sig.id], 400n, 'act-1'),
    'settle must not throw — if refund acquired animaId the partition guard would reject it'
  )
})

// ── System-Wide Value Conservation ──────────────────────────────────────────
// RULE: valid + locked + spent = total ever issued (including refunds).
// The ledger is a closed system — no value is created or destroyed.

test('INVARIANT: system-wide value conservation across mixed operations', async () => {
  const s = new MemorySignorum()

  // Issue several signa and run different operations on each
  const a = await s.issue({ animaId: 'anima-1', forma: 'minted', valor: 500n, auctor: 'test' })
  const b = await s.issue({ animaId: 'anima-1', forma: 'minted', valor: 300n, auctor: 'test' })
  const c = await s.issue({ animaId: 'anima-1', forma: 'minted', valor: 200n, auctor: 'test' })

  // Lock b, settle it at 150n (refund 150n issued)
  await s.lock([b.id], 'act-1')
  await s.settle([b.id], 150n, 'act-1')

  // Lock c, then release it (failure path)
  await s.lock([c.id], 'act-2')
  await s.release([c.id])

  // a stays valid, c stays valid (released), b is spent, refund of 150n is valid
  // history returns all signa regardless of status
  const history = await s.history({ animaId: 'anima-1' })
  const totalIssued = history.reduce((sum, s) => sum + s.valor, 0n)
  const byStatus = {
    valid:  history.filter(s => s.status === 'valid').reduce((sum, s) => sum + s.valor, 0n),
    locked: history.filter(s => s.status === 'locked').reduce((sum, s) => sum + s.valor, 0n),
    spent:  history.filter(s => s.status === 'spent').reduce((sum, s) => sum + s.valor, 0n),
  }

  assert.equal(
    byStatus.valid + byStatus.locked + byStatus.spent,
    totalIssued,
    'valid + locked + spent must equal total ever issued'
  )
})

// ── One-Way Link: Forward Pointer Preserved ──────────────────────────────────
// RULE: identified signa that funded a commitment carry commitment.
// The forward direction of the link must be stored and retrievable.

test('INVARIANT: identified signum with commitment is preserved through history', async () => {
  const s = new MemorySignorum()
  await s.issue({ animaId: 'anima-1', forma: 'eth', valor: 1000n, auctor: 'deposit', commitment: 'hash-anon' })

  const history = await s.history({ animaId: 'anima-1' })
  assert.equal(history.length, 1)
  assert.equal(history[0].commitment, 'hash-anon', 'forward link must be stored on identified signum')
  assert.equal(history[0].animaId, 'anima-1', 'identified signum must retain animaId')
})

// ── Purse redemption: credits change hands, the system total does not ────────
// RULE: a purse redemption is a TRANSFER. Whatever the purse loses, the redeemer gains —
// exactly, and nothing else in the system moves. A redemption that credited without draining
// (or drained twice) would print or destroy credits, which is the one thing the ledger may
// never do. These run over the real MemorySignorum, so the reserve/settle discipline of the
// mint is exercised too, not stubbed.

/** Every credit in this little world: held by an account, or sitting in a purse. */
async function systemTotal(s: MemorySignorum, bur: MemoryBursarium, animae: string[]): Promise<bigint> {
  let held = 0n
  for (const animaId of animae) held += await s.balance({ animaId })
  return held + purseCredits(bur)
}

test('INVARIANT: a purse redemption transfers credits and leaves the system total unchanged', async () => {
  const s = new MemorySignorum()
  const bur = new MemoryBursarium()
  const deps = { signorum: s, bursarium: bur }
  const ANIMAE = ['owner', 'stranger']
  await s.issue({ animaId: 'owner', forma: 'minted', valor: 5000n, auctor: 'test' })
  const before = await systemTotal(s, bur, ANIMAE)

  const minted = await mintOwnedPurse(deps, { owner: { animaId: 'owner' }, credits: 1200n })
  assert.ok(minted.ok)
  if (!minted.ok) return
  assert.equal(await systemTotal(s, bur, ANIMAE), before, 'minting a purse moves credits, it does not create them')

  const out = await redeemOwnedPurse(deps, { token: minted.bursa.id, redeemer: { animaId: 'stranger' } })
  assert.deepEqual(out, { ok: true, credited: 1200n })
  assert.equal(await s.balance({ animaId: 'stranger' }), 1200n, 'the redeemer gains exactly what the purse held')
  assert.equal(await s.balance({ animaId: 'owner' }), 3800n, "the owner's balance is untouched by the redemption")
  assert.equal(purseCredits(bur), 0n, 'the purse is drained')
  assert.equal(await systemTotal(s, bur, ANIMAE), before, 'system-wide total is unchanged by a redemption')
})

test('INVARIANT: a refused redemption moves nothing at all', async () => {
  const s = new MemorySignorum()
  const bur = new MemoryBursarium()
  const deps = { signorum: s, bursarium: bur }
  const ANIMAE = ['owner', 'first', 'second']
  await s.issue({ animaId: 'owner', forma: 'minted', valor: 4000n, auctor: 'test' })
  const minted = await mintOwnedPurse(deps, { owner: { animaId: 'owner' }, credits: 900n })
  assert.ok(minted.ok)
  if (!minted.ok) return
  const token = minted.bursa.id

  assert.deepEqual(await redeemOwnedPurse(deps, { token, redeemer: { animaId: 'first' } }), { ok: true, credited: 900n })
  const settled = await systemTotal(s, bur, ANIMAE)

  // Every refusal shape, one after another — each must be inert.
  assert.deepEqual(await redeemOwnedPurse(deps, { token, redeemer: { animaId: 'second' } }), { ok: false, reason: 'redeemed' })
  assert.deepEqual(await redeemOwnedPurse(deps, { token, redeemer: { animaId: 'owner' } }), { ok: false, reason: 'owner_reclaims' })
  assert.deepEqual(await redeemOwnedPurse(deps, { token: 'absent', redeemer: { animaId: 'second' } }), { ok: false, reason: 'not_found' })
  const anon = await bur.create(300n)   // an anon purse: no owner, never redeemable
  assert.deepEqual(await redeemOwnedPurse(deps, { token: anon.id, redeemer: { animaId: 'second' } }), { ok: false, reason: 'not_redeemable' })

  assert.equal(await s.balance({ animaId: 'first' }), 900n, 'the settled redemption is not disturbed')
  assert.equal(await s.balance({ animaId: 'second' }), 0n, 'a refused redeemer gains nothing')
  assert.equal(await systemTotal(s, bur, ANIMAE), settled + 300n, 'only the newly minted anon purse changes the total')
})
