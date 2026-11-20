// eventsRouter — POST /v1/events. Pure unit test (fake in-memory store, no live Mongo):
// identity-required (no fallback to IP), kind validation, device-bucket derivation from
// the request header only (never the body), and meta sanitization.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import express from 'express'
import request from 'supertest'
import { createEventsRouter } from '../../../src/api/internal/eventsRouter.js'
import type { BehaviourEventStore, BehaviourEventDoc } from '../../../src/analytics/BehaviourEventStore.js'
import type { AuctorKey } from '../../../src/flow/types.js'
import type { Credentials } from '../../../src/allocutio/api/IdentityResolver.js'

class MemoryEvents {
  saved: BehaviourEventDoc[] = []
  async save(event: Parameters<BehaviourEventStore['save']>[0]): Promise<void> {
    this.saved.push({ ...event, savedAt: new Date().toISOString() })
  }
}

const fakeIdentity = {
  async resolve(creds: Credentials): Promise<AuctorKey> {
    if (creds.authorization?.startsWith('Bearer ')) return { animaId: creds.authorization.slice('Bearer '.length) }
    if (creds.commitment) return { commitment: creds.commitment }
    throw new Error('auth.missing')
  },
}

function makeServer(events: MemoryEvents) {
  const app = express()
  app.use(express.json())
  app.use('/v1/events', createEventsRouter({ events: events as unknown as BehaviourEventStore, identity: fakeIdentity }))
  return app
}

test('records a catalog_view keyed on the resolved commitment, with a derived device bucket', async () => {
  const events = new MemoryEvents()
  const res = await request(makeServer(events))
    .post('/v1/events')
    .set('x-commitment', 'c-1')
    .set('user-agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/128.0.0.0 Safari/537.36')
    .send({ kind: 'catalog_view', modusId: 'flux-dev' })
  assert.equal(res.status, 204)
  assert.equal(events.saved.length, 1)
  const saved = events.saved[0]
  assert.equal(saved.kind, 'catalog_view')
  assert.equal(saved.byType, 'commitment')
  assert.equal(saved.ownerKey.startsWith('commitment:'), true)
  assert.equal(saved.device.browserFamily, 'Chrome')
  assert.equal(saved.meta?.modusId, 'flux-dev')
})

test('records an identified sign_in keyed on animaId', async () => {
  const events = new MemoryEvents()
  const res = await request(makeServer(events))
    .post('/v1/events')
    .set('authorization', 'Bearer anima-7')
    .send({ kind: 'sign_in', method: 'wallet' })
  assert.equal(res.status, 204)
  assert.equal(events.saved[0].animaId, 'anima-7')
  assert.equal(events.saved[0].ownerKey, 'anima:anima-7')
  assert.equal(events.saved[0].meta?.method, 'wallet')
})

test('no identity in hand → 401, nothing recorded (no IP fallback)', async () => {
  const events = new MemoryEvents()
  const res = await request(makeServer(events)).post('/v1/events').send({ kind: 'catalog_view' })
  assert.equal(res.status, 401)
  assert.equal(events.saved.length, 0)
})

test('unknown kind → 400, nothing recorded', async () => {
  const events = new MemoryEvents()
  const res = await request(makeServer(events)).post('/v1/events').set('x-commitment', 'c-1').send({ kind: 'page_scroll' })
  assert.equal(res.status, 400)
  assert.equal(events.saved.length, 0)
})

test('a client-supplied userAgent/device field in the body is ignored — only the header is read', async () => {
  const events = new MemoryEvents()
  await request(makeServer(events))
    .post('/v1/events')
    .set('x-commitment', 'c-2')
    .set('user-agent', 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) Version/17.5 Mobile/15E148 Safari/604.1')
    .send({ kind: 'catalog_view', userAgent: 'totally-fake-ua', device: 'spoofed' })
  const saved = events.saved[0]
  assert.equal(saved.device.osFamily, 'iOS')
  assert.ok(!('userAgent' in saved))
  assert.ok(!('device' in (saved.meta ?? {})))
})

test('an unrecognized sign_in method is dropped from meta rather than stored verbatim', async () => {
  const events = new MemoryEvents()
  await request(makeServer(events)).post('/v1/events').set('x-commitment', 'c-3').send({ kind: 'sign_in', method: 'carrier-pigeon' })
  assert.equal(events.saved[0].meta?.method, undefined)
})

test('per-owner rate limit: the request past the window max is refused with 429', async () => {
  const events = new MemoryEvents()
  const server = makeServer(events)
  const owner = `rate-limit-probe-${Math.random()}`
  let lastStatus = 0
  for (let i = 0; i < 301; i++) {
    const res = await request(server).post('/v1/events').set('x-commitment', owner).send({ kind: 'catalog_view' })
    lastStatus = res.status
  }
  assert.equal(lastStatus, 429)
})
