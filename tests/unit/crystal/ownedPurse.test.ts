import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mintOwnedPurse, reclaimOwnedPurse, redeemOwnedPurse, type OwnedPurseDeps } from '../../../src/crystal/ownedPurse.js'
import type { Bursa } from '../../../src/types/bursa.js'
import { InsufficientBursaCreditsError } from '../../../src/types/bursa.js'

// Minimal fakes: a Signorum tracking one balance, and a Bursarum tracking purses.
function fakeSignorum(initial: bigint) {
  let bal = initial
  const locks = new Map<string, bigint>()
  return {
    balanceNow: () => bal,
    signorum: {
      async reserve(_by: unknown, amount: bigint, actumId: string) {
        if (bal < amount) return { ok: false as const, available: bal }
        bal -= amount; locks.set(actumId, amount)
        return { ok: true as const, signaIds: [actumId], locked: amount }
      },
      async settle(_ids: string[], actual: bigint, actumId: string) {
        const locked = locks.get(actumId) ?? 0n; locks.delete(actumId)
        if (actual < locked) bal += locked - actual   // refund overshoot; net spend = actual
      },
      async release(ids: string[]) { for (const id of ids) { const l = locks.get(id); if (l) { bal += l; locks.delete(id) } } },
      async issue(s: { valor: bigint }) { bal += s.valor; return { ...s, id: 'x', natum: new Date(), status: 'valid' } },
    },
  }
}
function fakeBursarium() {
  const byToken = new Map<string, Bursa>()
  let n = 0
  return {
    byToken,
    bursarium: {
      async create(credits: bigint, opts?: { owner?: { animaId: string }; label?: string }): Promise<Bursa> {
        const b: Bursa = { id: `purse-${++n}`, credits, createdAt: new Date(), ...(opts?.owner ? { owner: opts.owner, status: 'active' as const } : {}), ...(opts?.label ? { label: opts.label } : {}) }
        byToken.set(b.id, b); return b
      },
      async findByToken(t: string) { return byToken.get(t) ?? null },
      async debit(t: string, amt: bigint) { const b = byToken.get(t); if (!b) throw new Error('nf'); if (b.credits < amt) throw new InsufficientBursaCreditsError(b.credits, amt); b.credits -= amt; return b },
      async credit(t: string, amt: bigint) { const b = byToken.get(t); if (b) b.credits += amt },
      async setStatus(t: string, s: NonNullable<Bursa['status']>) { const b = byToken.get(t); if (b) b.status = s },
      async listByOwner(a: string) { return [...byToken.values()].filter((b) => b.owner?.animaId === a) },
      // The claim, with the store's real semantics: conditional on ACTIVE + OWNED, and a
      // single step, so two callers cannot both come away holding the purse.
      async claimForRedemption(t: string, at: Date) {
        const b = byToken.get(t)
        if (!b || !b.owner || (b.status ?? 'active') !== 'active') return null
        b.status = 'redeemed'; b.redeemedAt = at
        return { ...b }
      },
      async releaseRedemptionClaim(t: string) {
        const b = byToken.get(t)
        if (b && b.status === 'redeemed') { b.status = 'active'; delete b.redeemedAt }
      },
    },
  }
}

/** JSON with bigints rendered as strings — used to assert what a record does NOT contain. */
const dump = (v: unknown): string => JSON.stringify(v, (_k, x) => (typeof x === 'bigint' ? x.toString() : x))

/** A ledger over MANY animae — redemption moves credits BETWEEN accounts, so a single-balance
 *  fake cannot tell "the redeemer was credited" apart from "nobody was debited". */
function fakeLedger(initial: Record<string, bigint>) {
  const bal = new Map<string, bigint>(Object.entries(initial))
  const locks = new Map<string, { animaId: string; amount: bigint }>()
  const add = (a: string, v: bigint) => bal.set(a, (bal.get(a) ?? 0n) + v)
  return {
    balanceOf: (a: string) => bal.get(a) ?? 0n,
    totalHeld: () => [...bal.values()].reduce((s, v) => s + v, 0n),
    lockedTotal: () => [...locks.values()].reduce((s, l) => s + l.amount, 0n),
    signorum: {
      async reserve(by: { animaId: string }, amount: bigint, actumId: string) {
        const cur = bal.get(by.animaId) ?? 0n
        if (cur < amount) return { ok: false as const, available: cur }
        bal.set(by.animaId, cur - amount); locks.set(actumId, { animaId: by.animaId, amount })
        return { ok: true as const, signaIds: [actumId], locked: amount }
      },
      async settle(_ids: string[], actual: bigint, actumId: string) {
        const l = locks.get(actumId); locks.delete(actumId)
        if (l && actual < l.amount) add(l.animaId, l.amount - actual)
      },
      async release(ids: string[]) {
        for (const id of ids) { const l = locks.get(id); if (l) { add(l.animaId, l.amount); locks.delete(id) } }
      },
      async issue(s: { animaId?: string; valor: bigint }) {
        if (s.animaId) add(s.animaId, s.valor)
        return { ...s, id: 'x', natum: new Date(), status: 'valid' }
      },
    },
  }
}

/** Deps over the multi-account ledger, plus the totals a conservation assertion needs. */
function redeemWorld(balances: Record<string, bigint>) {
  const led = fakeLedger(balances)
  const bur = fakeBursarium()
  const deps = { signorum: led.signorum, bursarium: bur.bursarium } as unknown as OwnedPurseDeps
  // Every credit in the system: held in an account, locked mid-spend, or sitting in a purse.
  const systemTotal = () =>
    led.totalHeld() + led.lockedTotal() + [...bur.byToken.values()].reduce((s, b) => s + b.credits, 0n)
  return { deps, led, bur, systemTotal }
}
function deps(balance: bigint) {
  const s = fakeSignorum(balance); const b = fakeBursarium()
  return { deps: { signorum: s.signorum, bursarium: b.bursarium } as unknown as OwnedPurseDeps, sig: s, bur: b }
}

test('mint spends exactly `credits` from the funder and stamps an owned purse', async () => {
  const { deps: d, sig, bur } = deps(5000n)
  const r = await mintOwnedPurse(d, { owner: { animaId: 'u1' }, credits: 1200n, label: 'mods' })
  assert.ok(r.ok)
  if (!r.ok) return
  assert.equal(r.bursa.credits, 1200n)
  assert.deepEqual(r.bursa.owner, { animaId: 'u1' })
  assert.equal(r.bursa.label, 'mods')
  assert.equal(sig.balanceNow(), 3800n)                 // funder debited exactly 1200
  assert.equal((await bur.bursarium.listByOwner('u1')).length, 1)
})

test('mint refuses when the funder is short (no money moves)', async () => {
  const { deps: d, sig } = deps(500n)
  const r = await mintOwnedPurse(d, { owner: { animaId: 'u1' }, credits: 1200n })
  assert.deepEqual(r, { ok: false, available: 500n })
  assert.equal(sig.balanceNow(), 500n)                  // untouched
})

test('fundFrom lets an owner fund a purse from a DIFFERENT balance (the agent case)', async () => {
  // one shared balance in the fake, but assert fundFrom is honored by the reserve call path
  const { deps: d } = deps(3000n)
  const r = await mintOwnedPurse(d, { owner: { animaId: 'humanOwner' }, credits: 1000n, fundFrom: { animaId: 'agentAnima' } })
  assert.ok(r.ok)
  if (!r.ok) return
  assert.deepEqual(r.bursa.owner, { animaId: 'humanOwner' })   // dashboard = the human owner
})

test('reclaim drains leftover credits back to the owner; non-owner is refused', async () => {
  const { deps: d, sig, bur } = deps(5000n)
  const minted = await mintOwnedPurse(d, { owner: { animaId: 'u1' }, credits: 1000n })
  assert.ok(minted.ok); if (!minted.ok) return
  const token = minted.bursa.id
  // spend some of the purse (a run)
  await bur.bursarium.debit(token, 300n)
  assert.equal(sig.balanceNow(), 4000n)                 // after minting 1000

  // a non-owner cannot reclaim
  assert.deepEqual(await reclaimOwnedPurse(d, { token, owner: { animaId: 'someoneElse' } }), { ok: false, refunded: 0n })

  // the owner reclaims the leftover 700 → refunded to their balance
  const out = await reclaimOwnedPurse(d, { token, owner: { animaId: 'u1' }, revoke: true })
  assert.deepEqual(out, { ok: true, refunded: 700n })
  assert.equal(sig.balanceNow(), 4700n)                 // 4000 + 700 back
  assert.equal((await bur.bursarium.findByToken(token))?.credits, 0n)
  assert.equal((await bur.bursarium.findByToken(token))?.status, 'revoked')
})

// ── redeem (noema-336) — an owned purse becomes the redeemer's balance, once ─────────────────────
// The invite-code rail: the owner funds a purse from their balance and sends the token; whoever
// holds it turns it into credits on their OWN account. Every case below asserts the system total
// as well as the two balances — a redemption must move credits, never create or destroy them.

test('redeem moves the whole remaining balance to the redeemer and conserves the system total', async () => {
  const { deps: d, led, bur, systemTotal } = redeemWorld({ owner: 5000n, stranger: 0n })
  const before = systemTotal()
  const minted = await mintOwnedPurse(d, { owner: { animaId: 'owner' }, credits: 1000n })
  assert.ok(minted.ok); if (!minted.ok) return
  const token = minted.bursa.id
  await bur.bursarium.debit(token, 250n)                    // a bearer run already spent some

  const out = await redeemOwnedPurse(d, { token, redeemer: { animaId: 'stranger' } })
  assert.deepEqual(out, { ok: true, credited: 750n })
  assert.equal(led.balanceOf('stranger'), 750n)             // exactly what was left
  assert.equal(led.balanceOf('owner'), 4000n)               // untouched by the redeem itself
  assert.equal(systemTotal(), before - 250n)                // only the run's spend left the system
  const after = await bur.bursarium.findByToken(token)
  assert.equal(after?.credits, 0n)                          // drained
  assert.equal(after?.status, 'redeemed')                   // terminal
  assert.ok(after?.redeemedAt instanceof Date)              // and stamped with WHEN
  assert.equal(dump(after).includes('stranger'), false)     // never with WHOM
})

test('a second redeem of the same token is refused and moves nothing (one shot)', async () => {
  const { deps: d, led, systemTotal } = redeemWorld({ owner: 5000n, stranger: 0n })
  const minted = await mintOwnedPurse(d, { owner: { animaId: 'owner' }, credits: 800n })
  assert.ok(minted.ok); if (!minted.ok) return
  const token = minted.bursa.id

  assert.deepEqual(await redeemOwnedPurse(d, { token, redeemer: { animaId: 'stranger' } }), { ok: true, credited: 800n })
  const afterFirst = systemTotal()
  assert.deepEqual(await redeemOwnedPurse(d, { token, redeemer: { animaId: 'stranger' } }), { ok: false, reason: 'redeemed' })
  assert.equal(led.balanceOf('stranger'), 800n)             // not credited twice
  assert.equal(systemTotal(), afterFirst)
})

test('two identities, one token: the loser is refused and neither the winner nor the owner moves', async () => {
  const { deps: d, led, systemTotal } = redeemWorld({ owner: 5000n, first: 0n, second: 0n })
  const minted = await mintOwnedPurse(d, { owner: { animaId: 'owner' }, credits: 600n })
  assert.ok(minted.ok); if (!minted.ok) return
  const token = minted.bursa.id

  assert.deepEqual(await redeemOwnedPurse(d, { token, redeemer: { animaId: 'first' } }), { ok: true, credited: 600n })
  const settled = systemTotal()
  assert.deepEqual(await redeemOwnedPurse(d, { token, redeemer: { animaId: 'second' } }), { ok: false, reason: 'redeemed' })
  assert.equal(led.balanceOf('second'), 0n)                 // B gains nothing
  assert.equal(led.balanceOf('first'), 600n)                // A is unchanged by B's attempt
  assert.equal(led.balanceOf('owner'), 4400n)
  assert.equal(systemTotal(), settled)
})

test('concurrent redeems of one token: exactly one succeeds, the total is unchanged', async () => {
  const { deps: d, led, systemTotal } = redeemWorld({ owner: 5000n, first: 0n, second: 0n })
  const minted = await mintOwnedPurse(d, { owner: { animaId: 'owner' }, credits: 900n })
  assert.ok(minted.ok); if (!minted.ok) return
  const token = minted.bursa.id
  const before = systemTotal()

  const outs = await Promise.all([
    redeemOwnedPurse(d, { token, redeemer: { animaId: 'first' } }),
    redeemOwnedPurse(d, { token, redeemer: { animaId: 'second' } }),
  ])
  assert.equal(outs.filter((o) => o.ok).length, 1)
  assert.deepEqual(outs.filter((o) => !o.ok).map((o) => (o.ok ? null : o.reason)), ['redeemed'])
  assert.equal(led.balanceOf('first') + led.balanceOf('second'), 900n)   // credited once, in total
  assert.equal(systemTotal(), before)
})

test('an EMPTY owned purse redeems once for zero, and cannot be redeemed again', async () => {
  const { deps: d, bur } = redeemWorld({ owner: 5000n, stranger: 0n })
  const minted = await mintOwnedPurse(d, { owner: { animaId: 'owner' }, credits: 400n })
  assert.ok(minted.ok); if (!minted.ok) return
  const token = minted.bursa.id
  await bur.bursarium.debit(token, 400n)                    // runs spent all of it

  assert.deepEqual(await redeemOwnedPurse(d, { token, redeemer: { animaId: 'stranger' } }), { ok: true, credited: 0n })
  assert.deepEqual(await redeemOwnedPurse(d, { token, redeemer: { animaId: 'other' } }), { ok: false, reason: 'redeemed' })
})

test('a bearer spend landing between the claim and the drain shrinks the redemption, never the total', async () => {
  const { deps: d, led, bur, systemTotal } = redeemWorld({ owner: 5000n, stranger: 0n })
  const minted = await mintOwnedPurse(d, { owner: { animaId: 'owner' }, credits: 1000n })
  assert.ok(minted.ok); if (!minted.ok) return
  const token = minted.bursa.id
  const before = systemTotal()

  // One interleaved run: the first drain attempt asks for the balance as of the claim, and a
  // spend has already taken 300 of it. The redemption must fall back to what is actually left.
  const realDebit = bur.bursarium.debit
  let interleaved = false
  bur.bursarium.debit = async (t: string, amt: bigint) => {
    if (!interleaved) { interleaved = true; await realDebit(t, 300n) }
    return realDebit(t, amt)
  }

  const out = await redeemOwnedPurse(d, { token, redeemer: { animaId: 'stranger' } })
  bur.bursarium.debit = realDebit
  assert.deepEqual(out, { ok: true, credited: 700n })
  assert.equal(led.balanceOf('stranger'), 700n)
  assert.equal((await bur.bursarium.findByToken(token))?.credits, 0n)
  assert.equal(systemTotal(), before - 300n)                // only the run's spend left the system
})

test('an ANON purse is never redeemable — no path ties it to an anima', async () => {
  const { deps: d, bur } = redeemWorld({ stranger: 0n })
  const anon = await bur.bursarium.create(500n)             // no owner: the anon bursa
  assert.deepEqual(
    await redeemOwnedPurse(d, { token: anon.id, redeemer: { animaId: 'stranger' } }),
    { ok: false, reason: 'not_redeemable' },
  )
  assert.equal((await bur.bursarium.findByToken(anon.id))?.credits, 500n)
  assert.equal((await bur.bursarium.findByToken(anon.id))?.status, undefined)
})

test('the OWNER is refused — their path is reclaim, so the two stay distinct in the ledger', async () => {
  const { deps: d, led } = redeemWorld({ owner: 5000n })
  const minted = await mintOwnedPurse(d, { owner: { animaId: 'owner' }, credits: 700n })
  assert.ok(minted.ok); if (!minted.ok) return
  assert.deepEqual(
    await redeemOwnedPurse(d, { token: minted.bursa.id, redeemer: { animaId: 'owner' } }),
    { ok: false, reason: 'owner_reclaims' },
  )
  assert.equal(led.balanceOf('owner'), 4300n)               // nothing moved
})

test('a REVOKED purse is not redeemable, and an unknown token is not found', async () => {
  const { deps: d } = redeemWorld({ owner: 5000n, stranger: 0n })
  const minted = await mintOwnedPurse(d, { owner: { animaId: 'owner' }, credits: 300n })
  assert.ok(minted.ok); if (!minted.ok) return
  await reclaimOwnedPurse(d, { token: minted.bursa.id, owner: { animaId: 'owner' }, revoke: true })
  assert.deepEqual(
    await redeemOwnedPurse(d, { token: minted.bursa.id, redeemer: { animaId: 'stranger' } }),
    { ok: false, reason: 'not_redeemable' },
  )
  assert.deepEqual(
    await redeemOwnedPurse(d, { token: 'no-such-token', redeemer: { animaId: 'stranger' } }),
    { ok: false, reason: 'not_found' },
  )
})

test('reclaim after a redeem returns 0 — the owner cannot re-take what changed hands', async () => {
  const { deps: d, led } = redeemWorld({ owner: 5000n, stranger: 0n })
  const minted = await mintOwnedPurse(d, { owner: { animaId: 'owner' }, credits: 500n })
  assert.ok(minted.ok); if (!minted.ok) return
  const token = minted.bursa.id
  assert.deepEqual(await redeemOwnedPurse(d, { token, redeemer: { animaId: 'stranger' } }), { ok: true, credited: 500n })

  assert.deepEqual(await reclaimOwnedPurse(d, { token, owner: { animaId: 'owner' } }), { ok: true, refunded: 0n })
  assert.equal(led.balanceOf('owner'), 4500n)               // the mint's debit stands
  assert.equal(led.balanceOf('stranger'), 500n)
})

test('a failure after the claim restores the credits and releases the claim (nothing stranded)', async () => {
  const { deps: d, led, bur, systemTotal } = redeemWorld({ owner: 5000n, stranger: 0n })
  const minted = await mintOwnedPurse(d, { owner: { animaId: 'owner' }, credits: 650n })
  assert.ok(minted.ok); if (!minted.ok) return
  const token = minted.bursa.id
  const before = systemTotal()

  const realIssue = d.signorum.issue
  d.signorum.issue = async () => { throw new Error('ledger unavailable') }
  await assert.rejects(() => redeemOwnedPurse(d, { token, redeemer: { animaId: 'stranger' } }), /ledger unavailable/)
  d.signorum.issue = realIssue

  const after = await bur.bursarium.findByToken(token)
  assert.equal(after?.credits, 650n)                        // credits are back in the purse
  assert.equal(after?.status, 'active')                     // and it is redeemable again
  assert.equal(after?.redeemedAt, undefined)
  assert.equal(led.balanceOf('stranger'), 0n)
  assert.equal(systemTotal(), before)

  assert.deepEqual(await redeemOwnedPurse(d, { token, redeemer: { animaId: 'stranger' } }), { ok: true, credited: 650n })
})
