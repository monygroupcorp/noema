// Auth contract of the deposits admin router: the `x-internal-secret` header gate is
// unconditional and header-only (no `?token=` fallback), so a refused request must never
// reach the reconciler. A request with a chainId this deployment does not serve proves the
// gate let it through without needing a working reconciler stub.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import express from 'express'
import request from 'supertest'
import { createDepositsAdminRouter, type DepositsAdminDeps } from '../../../src/api/internal/depositsAdminRouter.js'

const SECRET = 'test-internal-secret'

function harness(secret?: string) {
  const deps: DepositsAdminDeps = {
    reconciler: {} as unknown as DepositsAdminDeps['reconciler'],
    servedChainIds: ['chain-1'],
    ...(secret ? { secret } : {}),
  }
  const server = express()
  server.use('/internal/v1', express.json(), createDepositsAdminRouter(deps))
  return { server }
}

const reconcile = '/internal/v1/admin/deposits/reconcile'

test('configured secret + correct header → request is admitted (reaches handler)', async () => {
  const { server } = harness(SECRET)
  const res = await request(server).post(reconcile).set('x-internal-secret', SECRET).send({ chainId: 'unserved-chain' })
  assert.equal(res.status, 400)
  assert.equal(res.body.error.code, 'BAD_REQUEST')
})

test('configured secret + correct ?token= → 401 (header only, no query fallback)', async () => {
  const { server } = harness(SECRET)
  const res = await request(server).post(reconcile).query({ token: SECRET }).send({ chainId: 'chain-1' })
  assert.equal(res.status, 401)
})

test('configured secret + wrong credential → 401', async () => {
  const { server } = harness(SECRET)
  const res = await request(server).post(reconcile).set('x-internal-secret', 'wrong').send({ chainId: 'chain-1' })
  assert.equal(res.status, 401)
})

test('configured secret + no credential → 401', async () => {
  const { server } = harness(SECRET)
  const res = await request(server).post(reconcile).send({ chainId: 'chain-1' })
  assert.equal(res.status, 401)
})

// The point of the item: an unconfigured credential refuses, it does not admit.
test('secret NOT configured + no credential → 401', async () => {
  const { server } = harness(undefined)
  const res = await request(server).post(reconcile).send({ chainId: 'chain-1' })
  assert.equal(res.status, 401)
})

test('secret NOT configured + any credential supplied → 401', async () => {
  const { server } = harness(undefined)
  const res = await request(server).post(reconcile).set('x-internal-secret', 'anything').send({ chainId: 'chain-1' })
  assert.equal(res.status, 401)
})
