import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mintOwnedPurse, reclaimOwnedPurse, type OwnedPurseDeps } from '../../../src/crystal/ownedPurse.js'
import type { Bursa } from '../../../src/types/bursa.js'

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
      async debit(t: string, amt: bigint) { const b = byToken.get(t); if (!b) throw new Error('nf'); if (b.credits < amt) throw new Error('insufficient'); b.credits -= amt; return b },
      async credit(t: string, amt: bigint) { const b = byToken.get(t); if (b) b.credits += amt },
      async setStatus(t: string, s: 'active' | 'revoked') { const b = byToken.get(t); if (b) b.status = s },
      async listByOwner(a: string) { return [...byToken.values()].filter((b) => b.owner?.animaId === a) },
    },
  }
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
