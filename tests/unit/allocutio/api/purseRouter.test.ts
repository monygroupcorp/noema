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
      async credit(t: string, a: bigint) { const b = byToken.get(t); if (b) b.credits += a },
      async setStatus(t: string, s: NonNullable<Bursa['status']>) { const b = byToken.get(t); if (b) b.status = s },
      async listByOwner(a: string) { return [...byToken.values()].filter((b) => b.owner?.animaId === a) },
      // Conditional on ACTIVE + OWNED, in one step — the store's redemption claim.
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
// Per-anima balances: a redemption moves credits from one account to another, so a single
// shared number cannot show that the RIGHT account was credited.
function fakeSignorum(bal: { v: bigint }, ledger?: Map<string, bigint>) {
  const locks = new Map<string, bigint>()
  return {
    async reserve(_by: unknown, amount: bigint, id: string) { if (bal.v < amount) return { ok: false as const, available: bal.v }; bal.v -= amount; locks.set(id, amount); return { ok: true as const, signaIds: [id], locked: amount } },
    async settle(_i: string[], actual: bigint, id: string) { const l = locks.get(id) ?? 0n; locks.delete(id); if (actual < l) bal.v += l - actual },
    async release(ids: string[]) { for (const i of ids) { const l = locks.get(i); if (l) { bal.v += l; locks.delete(i) } } },
    async issue(s: { animaId?: string; valor: bigint }) {
      bal.v += s.valor
      if (ledger && s.animaId) ledger.set(s.animaId, (ledger.get(s.animaId) ?? 0n) + s.valor)
      return { ...s }
    },
  }
}

function app(opts: { auctor?: AuctorKey; balance?: bigint; ownsAgent?: boolean; frozen?: boolean; rateLimiters?: PurseRouterDeps['rateLimiters'] } = {}) {
  const bur = fakeBursarium()
  const bal = { v: opts.balance ?? 5000n }
  // Who the next request is from. Mutable so one app can serve two identities in turn —
  // the shape every owner-scoped assertion below needs.
  const who: { v: AuctorKey } = { v: opts.auctor ?? { animaId: 'u1' } }
  // What each anima was credited, by animaId (issue only — mint's debit runs through reserve).
  const credited = new Map<string, bigint>()
  // Mutable dispute-freeze state so a test can mint a purse UNFROZEN, then flip the caller frozen and
  // assert reclaim (value-inflow) still works — noema-082 Q3 freeze-boundary: MINT is gated, RECLAIM never is.
  const frozen = { v: opts.frozen ?? false }
  const animae = { find: async (id: string) => ({ id, disputeFrozen: frozen.v }) } as unknown as PurseRouterDeps['animae']
  const deps: PurseRouterDeps = {
    identity: { resolve: async () => who.v },
    signorum: fakeSignorum(bal, credited) as unknown as PurseRouterDeps['signorum'],
    bursarium: bur.store as unknown as PurseRouterDeps['bursarium'],
    fundFromAgent: async () => (opts.ownsAgent ? { animaId: 'agentAnima' } : null),
    animae,
    publicBase: 'https://noema.art',
    ...(opts.rateLimiters ? { rateLimiters: opts.rateLimiters } : {}),
  }
  const a = express(); a.use('/v1/purses', express.json(), createPurseRouter(deps))
  return { app: a, bur, bal, frozen, who, credited }
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

// ── redeem (noema-336) — POST /v1/purses/:token/redeem ───────────────────────────────────────────
// The invite-code rail over HTTP: the holder of a token turns it into credits on their own
// account. Owner-scoped state changes hands here, so each refusal is asserted by CODE (the web
// app branches on it) and each success is asserted against the RIGHT anima's credit.

test('redeem: a second identity turns the token into credits on THEIR account', async () => {
  const { app: a, bur, who, credited } = app({ balance: 5000n })
  const created = await request(a).post('/v1/purses').send({ credits: 1000 })
  const token = created.body.token
  await bur.store.debit(token, 250n)                      // a bearer run already spent some

  who.v = { animaId: 'stranger' }                          // a different account presents the code
  const res = await request(a).post(`/v1/purses/${token}/redeem`).send({})
  assert.equal(res.status, 200)
  assert.equal(res.body.credited, '750')                   // the whole remaining balance
  assert.equal(credited.get('stranger'), 750n)             // credited to the redeemer
  assert.equal(credited.get('u1'), undefined)              // never to the owner
  assert.equal(bur.byToken.get(token)?.credits, 0n)
  assert.equal(bur.byToken.get(token)?.status, 'redeemed')
})

test('redeem: the same token a second time → 409 purse.redeemed, nothing credited', async () => {
  const { app: a, who, credited } = app({ balance: 5000n })
  const created = await request(a).post('/v1/purses').send({ credits: 400 })
  const token = created.body.token

  who.v = { animaId: 'first' }
  assert.equal((await request(a).post(`/v1/purses/${token}/redeem`).send({})).status, 200)
  who.v = { animaId: 'second' }
  const again = await request(a).post(`/v1/purses/${token}/redeem`).send({})
  assert.equal(again.status, 409)
  assert.equal(again.body.error.code, 'purse.redeemed')
  assert.equal(credited.get('second'), undefined)
  assert.equal(credited.get('first'), 400n)                // unchanged by the second attempt
})

test('redeem: the owner is refused → 409 purse.owner_reclaims (reclaim is their path)', async () => {
  const { app: a, credited } = app({ balance: 5000n })
  const created = await request(a).post('/v1/purses').send({ credits: 400 })
  const res = await request(a).post(`/v1/purses/${created.body.token}/redeem`).send({})
  assert.equal(res.status, 409)
  assert.equal(res.body.error.code, 'purse.owner_reclaims')
  assert.equal(credited.get('u1'), undefined)
})

test('redeem: an unknown token → 404 purse.not_found', async () => {
  const { app: a } = app()
  const res = await request(a).post('/v1/purses/no-such-token/redeem').send({})
  assert.equal(res.status, 404)
  assert.equal(res.body.error.code, 'purse.not_found')
})

test('redeem: an anon (commitment) caller is refused — redemption needs an account', async () => {
  const { app: a, bur, who } = app()
  const created = await request(a).post('/v1/purses').send({ credits: 300 })
  who.v = { commitment: '0xabc' }
  const res = await request(a).post(`/v1/purses/${created.body.token}/redeem`).send({})
  assert.equal(res.status, 403)
  assert.equal(bur.byToken.get(created.body.token)?.credits, 300n)   // still funded
})

test('redeem: an ANON purse is refused → 409 purse.not_redeemable', async () => {
  const { app: a, bur, who } = app()
  const anon = await bur.store.create(500n)                // no owner
  who.v = { animaId: 'stranger' }
  const res = await request(a).post(`/v1/purses/${anon.id}/redeem`).send({})
  assert.equal(res.status, 409)
  assert.equal(res.body.error.code, 'purse.not_redeemable')
  assert.equal(bur.byToken.get(anon.id)?.credits, 500n)
})

test('the dashboard reports WHEN a purse was redeemed, and never by whom', async () => {
  const { app: a, who } = app({ balance: 5000n })
  const created = await request(a).post('/v1/purses').send({ credits: 500, label: 'outreach' })
  who.v = { animaId: 'stranger' }
  assert.equal((await request(a).post(`/v1/purses/${created.body.token}/redeem`).send({})).status, 200)

  who.v = { animaId: 'u1' }
  const dash = await request(a).get('/v1/purses')
  const row = (dash.body.purses as Array<Record<string, unknown>>).find((p) => p.token === created.body.token)
  assert.equal(row?.status, 'redeemed')
  assert.ok(typeof row?.redeemedAt === 'string' && !Number.isNaN(Date.parse(row.redeemedAt)))
  assert.equal(JSON.stringify(dash.body).includes('stranger'), false)
})

test('the wired rate limiters actually run on redeem — and only on redeem', async () => {
  // A limiter that is accepted but never applied is the failure mode this asserts against:
  // both stubs must see the redeem request, and neither may see reclaim.
  const seen: string[] = []
  const perIp: express.RequestHandler = (_req, _res, next) => { seen.push('ip'); next() }
  const perCaller: express.RequestHandler = (_req, res) => {
    seen.push('caller')
    res.status(429).json({ error: { code: 'rate.limited', message: 'too many code redemptions — try again shortly' } })
  }
  const { app: a, bur } = app({ balance: 5000n, rateLimiters: { redeem: [perIp, perCaller] } })
  const created = await request(a).post('/v1/purses').send({ credits: 300 })
  const token = created.body.token

  const limited = await request(a).post(`/v1/purses/${token}/redeem`).send({})
  assert.equal(limited.status, 429)                        // the limiter, not the route, answered
  assert.deepEqual(seen, ['ip', 'caller'])                 // in the order they were wired
  assert.equal(bur.byToken.get(token)?.credits, 300n)      // and no credits moved

  seen.length = 0
  assert.equal((await request(a).post(`/v1/purses/${token}/reclaim`).send({})).status, 200)
  assert.deepEqual(seen, [])                               // reclaim is not limited by this wiring
})

test('with no limiters wired the route still serves (the dep is optional)', async () => {
  const { app: a, who } = app({ balance: 5000n })
  const created = await request(a).post('/v1/purses').send({ credits: 200 })
  who.v = { animaId: 'stranger' }
  assert.equal((await request(a).post(`/v1/purses/${created.body.token}/redeem`).send({})).status, 200)
})
