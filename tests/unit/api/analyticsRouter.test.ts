// Auth contract of the internal analytics router: the `x-internal-secret` / `?token=` gate is
// unconditional, so an unconfigured secret refuses every request instead of admitting it.
// Also covers the behaviour-corpus additions: totals' run/behaviour breakdown and /funnel.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import express from 'express'
import request from 'supertest'
import { createAnalyticsRouter } from '../../../src/api/internal/analyticsRouter.js'
import type { WideEventStore } from '../../../src/analytics/WideEventStore.js'
import type { BehaviourEventStore } from '../../../src/analytics/BehaviourEventStore.js'
import type { Actorum } from '../../../src/types/cursus.js'

const SECRET = 'test-internal-secret'

/** In-memory stand-in for the Mongo-backed store — this suite only exercises the gate. */
function stubWideStore(): WideEventStore {
  return {
    totals: async () => ({ revenue: 42n, count: 3, failed: 1 }),
    query:  async () => [],
  } as unknown as WideEventStore
}

function stubBehaviourStore(): BehaviourEventStore {
  return {
    totals: async () => ({ catalog_view: 10, quote: 4, sign_in: 2, funding_attempt: 1 }),
    distinctOwnersByKind: async () => ({ catalog_view: 10, quote: 4, sign_in: 2, funding_attempt: 1 }),
    query: async () => [],
  } as unknown as BehaviourEventStore
}

function stubActorum(): Actorum {
  return {
    statusCountsSince: async () => ({ nascens: 1, agens: 0, completus: 5, fractus: 1 }),
  } as unknown as Actorum
}

function app(secret?: string, extra: { behaviourStore?: BehaviourEventStore; actorum?: Actorum } = {}) {
  const server = express()
  server.use('/internal/analytics', createAnalyticsRouter({ wideStore: stubWideStore(), ...extra }, secret))
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

test('totals: without actorum/behaviourStore, runs/behaviour are omitted (clause 1/2 opt-in)', async () => {
  const res = await request(app(SECRET)).get('/internal/analytics/totals').set('x-internal-secret', SECRET)
  assert.equal(res.status, 200)
  assert.equal(res.body.runs, undefined)
  assert.equal(res.body.behaviour, undefined)
})

test('totals: with actorum wired, attempts and completions are counted separately (clause 1)', async () => {
  const res = await request(app(SECRET, { actorum: stubActorum() })).get('/internal/analytics/totals').set('x-internal-secret', SECRET)
  assert.equal(res.status, 200)
  assert.equal(res.body.runs.attempted, 7)
  assert.equal(res.body.runs.completed, 5)
  assert.equal(res.body.runs.failed, 1)
  assert.equal(res.body.runs.inFlight, 1)
})

test('totals: with behaviourStore wired, non-run event kinds are totalled (clause 2)', async () => {
  const res = await request(app(SECRET, { behaviourStore: stubBehaviourStore() })).get('/internal/analytics/totals').set('x-internal-secret', SECRET)
  assert.equal(res.status, 200)
  assert.equal(res.body.behaviour.catalog_view, 10)
  assert.equal(res.body.behaviour.sign_in, 2)
})

test('funnel: 503 when the behaviour corpus is not configured', async () => {
  const res = await request(app(SECRET)).get('/internal/analytics/funnel').set('x-internal-secret', SECRET)
  assert.equal(res.status, 503)
})

test('funnel: walks the fixed stage order with distinct-owner counts (clause 6)', async () => {
  const res = await request(app(SECRET, { behaviourStore: stubBehaviourStore(), actorum: stubActorum() }))
    .get('/internal/analytics/funnel').set('x-internal-secret', SECRET)
  assert.equal(res.status, 200)
  const stages = res.body.stages as Array<{ stage: string; visitors: number }>
  assert.deepEqual(stages.map(s => s.stage), ['catalog_view', 'quote', 'sign_in', 'funding_attempt', 'run_attempt', 'run_complete'])
  assert.equal(stages[0].visitors, 10)
  assert.equal(stages.find(s => s.stage === 'run_attempt')?.visitors, 7)
  assert.equal(stages.find(s => s.stage === 'run_complete')?.visitors, 5)
})

test('funnel: unauthorized is still refused', async () => {
  const res = await request(app(SECRET, { behaviourStore: stubBehaviourStore() })).get('/internal/analytics/funnel')
  assert.equal(res.status, 401)
})
