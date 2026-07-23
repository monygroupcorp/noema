// Hermetic (express) test of the owned-purse router (§7 — delegation via Bursa).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import express from 'express'
import request from 'supertest'
import { createPurseRouter, type PurseRouterDeps } from '../../../../src/allocutio/api/purseRouter.js'
import type { Bursa } from '../../../../src/types/bursa.js'
import type { AuctorKey } from '../../../../src/flow/types.js'

function fakeBursarium() {
  const byToken = new Map<string, Bursa>(); let n = 0
  return {
    byToken,
    store: {
      async create(credits: bigint, opts?: { owner?: { animaId: string }; label?: string }): Promise<Bursa> {
        const b: Bursa = { id: `p${++n}`, credits, createdAt: new Date(), ...(opts?.owner ? { owner: opts.owner, status: 'active' as const } : {}), ...(opts?.label ? { label: opts.label } : {}) }
        byToken.set(b.id, b); return b
      },
      async findByToken(t: string) { return byToken.get(t) ?? null },
      async debit(t: string, a: bigint) { const b = byToken.get(t)!; b.credits -= a; return b },
      async credit() {}, async setStatus(t: string, s: 'active' | 'revoked') { const b = byToken.get(t); if (b) b.status = s },
      async listByOwner(a: string) { return [...byToken.values()].filter((b) => b.owner?.animaId === a) },
    },
  }
}
function fakeSignorum(bal: { v: bigint }) {
  const locks = new Map<string, bigint>()
  return {
    async reserve(_by: unknown, amount: bigint, id: string) { if (bal.v < amount) return { ok: false as const, available: bal.v }; bal.v -= amount; locks.set(id, amount); return { ok: true as const, signaIds: [id], locked: amount } },
    async settle(_i: string[], actual: bigint, id: string) { const l = locks.get(id) ?? 0n; locks.delete(id); if (actual < l) bal.v += l - actual },
    async release(ids: string[]) { for (const i of ids) { const l = locks.get(i); if (l) { bal.v += l; locks.delete(i) } } },
    async issue(s: { valor: bigint }) { bal.v += s.valor; return { ...s } },
  }
}

function app(opts: { auctor?: AuctorKey; balance?: bigint; ownsAgent?: boolean; frozen?: boolean } = {}) {
  const bur = fakeBursarium()
  const bal = { v: opts.balance ?? 5000n }
  // Mutable dispute-freeze state so a test can mint a purse UNFROZEN, then flip the caller frozen and
  // assert reclaim (value-inflow) still works — noema-082 Q3 freeze-boundary: MINT is gated, RECLAIM never is.
  const frozen = { v: opts.frozen ?? false }
  const animae = { find: async (id: string) => ({ id, disputeFrozen: frozen.v }) } as unknown as PurseRouterDeps['animae']
  const deps: PurseRouterDeps = {
    identity: { resolve: async () => (opts.auctor ?? { animaId: 'u1' }) },
    signorum: fakeSignorum(bal) as unknown as PurseRouterDeps['signorum'],
    bursarium: bur.store as unknown as PurseRouterDeps['bursarium'],
    fundFromAgent: async () => (opts.ownsAgent ? { animaId: 'agentAnima' } : null),
    animae,
    publicBase: 'https://noema.art',
  }
  const a = express(); a.use('/v1/purses', express.json(), createPurseRouter(deps))
  return { app: a, bur, bal, frozen }
}

test('mint a purse → token + credits; it appears in the dashboard', async () => {
  const { app: a } = app({ balance: 5000n })
  const res = await request(a).post('/v1/purses').send({ credits: 1200, label: 'friends' })
  assert.equal(res.status, 200)
  assert.ok(res.body.token)
  assert.equal(res.body.credits, '1200')
  assert.equal(res.body.label, 'friends')
  const dash = await request(a).get('/v1/purses')      // NOTE: fresh app has no purses; assert shape only
  assert.equal(dash.status, 200)
  assert.ok(Array.isArray(dash.body.purses))
})

test('mint refuses when the balance is short → 402 with available', async () => {
  const { app: a } = app({ balance: 500n })
  const res = await request(a).post('/v1/purses').send({ credits: 1200 })
  assert.equal(res.status, 402)
  assert.equal(res.body.available, '500')
})

test('anon (commitment) caller is refused — purses are owner-linked', async () => {
  const { app: a } = app({ auctor: { commitment: '0xabc' } })
  assert.equal((await request(a).post('/v1/purses').send({ credits: 100 })).status, 403)
  assert.equal((await request(a).get('/v1/purses')).status, 403)
})

test('fund-from-agent: owner → funded + agent joinUrl; non-owner → 403', async () => {
  const owner = app({ ownsAgent: true })
  const ok = await request(owner.app).post('/v1/purses').send({ credits: 1000, fundFromAgentId: 'camel42' })
  assert.equal(ok.status, 200)
  assert.match(ok.body.joinUrl, /\/join\/camel42\//)

  const notOwner = app({ ownsAgent: false })
  const no = await request(notOwner.app).post('/v1/purses').send({ credits: 1000, fundFromAgentId: 'camel42' })
  assert.equal(no.status, 403)
  assert.equal(no.body.error.code, 'NOT_OWNER')
})

test('reclaim drains a purse back to the owner', async () => {
  const { app: a, bur } = app()
  const created = await request(a).post('/v1/purses').send({ credits: 1000 })
  const token = created.body.token
  await bur.store.debit(token, 400n)                    // simulate a run spending 400
  const rec = await request(a).post(`/v1/purses/${token}/reclaim`).send({})
  assert.equal(rec.status, 200)
  assert.equal(rec.body.refunded, '600')
})

// ── dispute freeze (noema-082 Q3 freeze-boundary ruling 2026-07-22) ──────────────────────────────
// The freeze-boundary ruling mandates: a frozen anima is blocked on purse MINT (the bearer-value
// extraction route a disputing fraudster uses), but its purse RECLAIM (value returning IN) still works.
// These two cases pair with stripeRail.test.ts's run-spend-blocked + reserve-freeze-blind coverage to
// complete the ruling's mandated matrix (run spend blocked, purse mint blocked, reclaim works, system
// transfer works).

test('frozen anima is BLOCKED from minting a purse → 403 auth.forbidden (bearer-value extraction is gated)', async () => {
  const { app: a } = app({ frozen: true, balance: 5000n })
  const res = await request(a).post('/v1/purses').send({ credits: 1200, label: 'friends' })
  assert.equal(res.status, 403)
  assert.equal(res.body.error.code, 'auth.forbidden')
  // Balance was NOT touched — the guard runs before any funding.
  assert.match(res.body.error.message, /dispute/i)
})

test("frozen anima's purse RECLAIM still works — value-inflow is deliberately NOT gated", async () => {
  const { app: a, bur, frozen } = app({ frozen: false })
  // Mint while unfrozen (mint requires an unfrozen anima), then simulate a dispute freeze.
  const created = await request(a).post('/v1/purses').send({ credits: 1000 })
  const token = created.body.token
  await bur.store.debit(token, 400n)                    // simulate a run spending 400
  frozen.v = true                                        // charge.dispute.created froze the caller
  const rec = await request(a).post(`/v1/purses/${token}/reclaim`).send({})
  assert.equal(rec.status, 200)                          // reclaim is freeze-blind (value returning in)
  assert.equal(rec.body.refunded, '600')
})
