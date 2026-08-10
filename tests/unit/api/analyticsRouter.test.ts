// Auth contract of the internal analytics router: the `x-internal-secret` / `?token=` gate is
// unconditional, so an unconfigured secret refuses every request instead of admitting it.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import express from 'express'
import request from 'supertest'
import { createAnalyticsRouter } from '../../../src/api/internal/analyticsRouter.js'
import type { WideEventStore } from '../../../src/analytics/WideEventStore.js'

const SECRET = 'test-internal-secret'

/** In-memory stand-in for the Mongo-backed store — this suite only exercises the gate. */
function stubStore(): WideEventStore {
  return {
    totals: async () => ({ revenue: 42n, count: 3, failed: 1 }),
    query:  async () => [],
  } as unknown as WideEventStore
}

function app(secret?: string) {
  const server = express()
  server.use('/internal/analytics', createAnalyticsRouter(stubStore(), secret))
  return server
}

test('configured secret + correct header → 200', async () => {
  const res = await request(app(SECRET)).get('/internal/analytics/totals').set('x-internal-secret', SECRET)
  assert.equal(res.status, 200)
  assert.equal(res.body.revenue, '42')
  assert.equal(res.body.count, 3)
})

test('configured secret + correct ?token= → 200', async () => {
  const res = await request(app(SECRET)).get('/internal/analytics/recent').query({ token: SECRET })
  assert.equal(res.status, 200)
})

test('configured secret + wrong credential → 401', async () => {
  const res = await request(app(SECRET)).get('/internal/analytics/totals').set('x-internal-secret', 'wrong')
  assert.equal(res.status, 401)
})

test('configured secret + no credential → 401', async () => {
  const res = await request(app(SECRET)).get('/internal/analytics/totals')
  assert.equal(res.status, 401)
})

// The point of the item: an unconfigured credential refuses, it does not admit.
test('secret NOT configured + no credential → 401', async () => {
  const res = await request(app(undefined)).get('/internal/analytics/totals')
  assert.equal(res.status, 401)
})

test('secret NOT configured + any credential supplied → 401', async () => {
  const res = await request(app(undefined)).get('/internal/analytics/recent').set('x-internal-secret', 'anything')
  assert.equal(res.status, 401)
})

test('secret NOT configured — the per-user read is refused too', async () => {
  const res = await request(app(undefined)).get('/internal/analytics/recent').query({ animaId: 'anima-1' })
  assert.equal(res.status, 401)
})
