// Auth contract of the treasury admin router: the `x-internal-secret` / `?token=` gate is
// unconditional, so an unconfigured secret refuses every request instead of admitting it.
// The gate runs before any ledger write — an unauthorized call must not reach `issue`.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import express from 'express'
import request from 'supertest'
import { createTreasuryAdminRouter, MAX_GRANT_POINTS, type TreasuryAdminDeps } from '../../../src/api/internal/treasuryAdminRouter.js'
import type { TreasuryConfig } from '../../../src/crystal/AgentProvisioner.js'
import type { Anima } from '../../../src/types/anima.js'

const SECRET = 'test-internal-secret'

const ANIMA: Anima = {
  id: 'anima-1',
  nomen: 'Test Anima',
  natum: new Date(0),
  mutatum: new Date(0),
}

const TREASURY: TreasuryConfig = {
  treasuryId: 'treasury-1',
  animaId:    'anima-treasury-1',
  issuerId:   'https://issuer.example/',
  templateModusId: 'template-modus',
  starterGrant: 0n,
  status: 'active',
}

/** Counts every ledger call so a refused request can be proven to have written nothing. */
function harness(secret?: string) {
  const calls: string[] = []
  const issued: Array<Record<string, unknown>> = []
  const deps: TreasuryAdminDeps = {
    signorum: {
      issue:    async (signum: Record<string, unknown>) => { calls.push('issue'); issued.push(signum); return undefined as never },
      transfer: async () => { calls.push('transfer'); return { ok: true } as never },
      balance:  async () => { calls.push('balance');  return 0n },
    } as unknown as TreasuryAdminDeps['signorum'],
    legati:   { findByAgentId: async () => null } as unknown as TreasuryAdminDeps['legati'],
    animae:   { find: async (id: string) => (id === ANIMA.id ? ANIMA : null) },
    treasury: (id: string) => (id === TREASURY.treasuryId ? TREASURY : null),
    ...(secret ? { secret } : {}),
  }
  const server = express()
  server.use('/internal/v1', express.json(), createTreasuryAdminRouter(deps))
  return { server, calls, issued }
}

const fund = '/internal/v1/admin/treasury/treasury-1/fund'
const topup = '/internal/v1/admin/treasury/treasury-1/topup'
const grant = `/internal/v1/admin/animae/${ANIMA.id}/grant`

test('configured secret + correct header → request is admitted', async () => {
  const { server, calls } = harness(SECRET)
  const res = await request(server).post(fund).set('x-internal-secret', SECRET).send({ points: 5 })
  assert.equal(res.status, 200)
  assert.ok(calls.includes('issue'))
})

test('configured secret + correct ?token= → request is admitted', async () => {
  const { server } = harness(SECRET)
  const res = await request(server).post(fund).query({ token: SECRET }).send({ points: 5 })
  assert.equal(res.status, 200)
})

test('configured secret + wrong credential → 401 and no ledger write', async () => {
  const { server, calls } = harness(SECRET)
  const res = await request(server).post(fund).set('x-internal-secret', 'wrong').send({ points: 5 })
  assert.equal(res.status, 401)
  assert.deepEqual(calls, [])
})

test('configured secret + no credential → 401 and no ledger write', async () => {
  const { server, calls } = harness(SECRET)
  const res = await request(server).post(fund).send({ points: 5 })
  assert.equal(res.status, 401)
  assert.deepEqual(calls, [])
})

// The point of the item: an unconfigured credential refuses, it does not admit.
test('secret NOT configured + no credential → 401 and no ledger write', async () => {
  const { server, calls } = harness(undefined)
  const res = await request(server).post(fund).send({ points: 5 })
  assert.equal(res.status, 401)
  assert.deepEqual(calls, [])
})

test('secret NOT configured + any credential supplied → 401 and no ledger write', async () => {
  const { server, calls } = harness(undefined)
  const res = await request(server).post(fund).set('x-internal-secret', 'anything').send({ points: 5 })
  assert.equal(res.status, 401)
  assert.deepEqual(calls, [])
})

test('secret NOT configured — topup is refused as well', async () => {
  const { server, calls } = harness(undefined)
  const res = await request(server).post(topup).send({ agentId: 'agent-1', points: 5 })
  assert.equal(res.status, 401)
  assert.deepEqual(calls, [])
})

// ---------------------------------------------------------------------------
// grant — mint onto a plain Anima. Every refusal below must write NOTHING.
// ---------------------------------------------------------------------------

test('an unauthenticated grant is refused and writes NOTHING', async () => {
  const { server, calls } = harness(SECRET)
  const res = await request(server).post(grant).send({ points: 5 })
  assert.equal(res.status, 401)
  assert.deepEqual(calls, [])
})

test('grant: secret NOT configured → 401 and no ledger write', async () => {
  const { server, calls } = harness(undefined)
  const res = await request(server).post(grant).set('x-internal-secret', 'anything').send({ points: 5 })
  assert.equal(res.status, 401)
  assert.deepEqual(calls, [])
})

test('a valid grant issues exactly once and reads the balance back', async () => {
  const { server, calls, issued } = harness(SECRET)
  const res = await request(server).post(grant).set('x-internal-secret', SECRET).send({ points: 5 })
  assert.equal(res.status, 200)
  assert.deepEqual(calls, ['issue', 'balance'])
  assert.equal(issued.length, 1)
  assert.equal(issued[0]?.animaId, ANIMA.id)
  assert.equal(issued[0]?.forma, 'minted')
  assert.equal(issued[0]?.valor, 5n)
  assert.equal(res.body.animaId, ANIMA.id)
  assert.equal(res.body.granted, '5')
  assert.equal(res.body.balance, '0')
})

test('a grant is attributable: auctor is admin:anima-grant', async () => {
  const { server, issued } = harness(SECRET)
  const res = await request(server).post(grant).set('x-internal-secret', SECRET).send({ points: 5 })
  assert.equal(res.status, 200)
  assert.equal(issued[0]?.auctor, 'admin:anima-grant')
})

test('a non-empty memo rides the signum as contextId; absent memo sets no field', async () => {
  const withMemo = harness(SECRET)
  await request(withMemo.server).post(grant).set('x-internal-secret', SECRET).send({ points: 5, memo: 'probe' })
  assert.equal(withMemo.issued[0]?.contextId, 'probe')

  const without = harness(SECRET)
  await request(without.server).post(grant).set('x-internal-secret', SECRET).send({ points: 5 })
  assert.ok(!('contextId' in (without.issued[0] ?? {})))
})

test('granting to an unknown anima is 404 and writes nothing', async () => {
  const { server, calls } = harness(SECRET)
  const res = await request(server).post('/internal/v1/admin/animae/anima-absent/grant')
    .set('x-internal-secret', SECRET).send({ points: 5 })
  assert.equal(res.status, 404)
  assert.deepEqual(calls, [])
})

for (const points of [0, -5, 1.5, 'abc', null] as const) {
  test(`grant rejects points=${JSON.stringify(points)} with 400 and no ledger write`, async () => {
    const { server, calls } = harness(SECRET)
    const res = await request(server).post(grant).set('x-internal-secret', SECRET).send({ points })
    assert.equal(res.status, 400)
    assert.deepEqual(calls, [])
  })
}

test('a grant above MAX_GRANT_POINTS is refused and writes nothing', async () => {
  const { server, calls } = harness(SECRET)
  const res = await request(server).post(grant).set('x-internal-secret', SECRET)
    .send({ points: (MAX_GRANT_POINTS + 1n).toString() })
  assert.equal(res.status, 400)
  assert.deepEqual(calls, [])
})

test('a grant exactly at MAX_GRANT_POINTS is admitted', async () => {
  const { server, issued } = harness(SECRET)
  const res = await request(server).post(grant).set('x-internal-secret', SECRET)
    .send({ points: MAX_GRANT_POINTS.toString() })
  assert.equal(res.status, 200)
  assert.equal(issued[0]?.valor, MAX_GRANT_POINTS)
})
