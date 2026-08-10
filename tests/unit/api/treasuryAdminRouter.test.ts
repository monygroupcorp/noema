// Auth contract of the treasury admin router: the `x-internal-secret` / `?token=` gate is
// unconditional, so an unconfigured secret refuses every request instead of admitting it.
// The gate runs before any ledger write — an unauthorized call must not reach `issue`.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import express from 'express'
import request from 'supertest'
import { createTreasuryAdminRouter, type TreasuryAdminDeps } from '../../../src/api/internal/treasuryAdminRouter.js'
import type { TreasuryConfig } from '../../../src/crystal/AgentProvisioner.js'

const SECRET = 'test-internal-secret'

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
  const deps: TreasuryAdminDeps = {
    signorum: {
      issue:    async () => { calls.push('issue');    return undefined as never },
      transfer: async () => { calls.push('transfer'); return { ok: true } as never },
      balance:  async () => { calls.push('balance');  return 0n },
    } as unknown as TreasuryAdminDeps['signorum'],
    legati:   { findByAgentId: async () => null } as unknown as TreasuryAdminDeps['legati'],
    treasury: (id: string) => (id === TREASURY.treasuryId ? TREASURY : null),
    ...(secret ? { secret } : {}),
  }
  const server = express()
  server.use('/internal/v1', express.json(), createTreasuryAdminRouter(deps))
  return { server, calls }
}

const fund = '/internal/v1/admin/treasury/treasury-1/fund'
const topup = '/internal/v1/admin/treasury/treasury-1/topup'

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
