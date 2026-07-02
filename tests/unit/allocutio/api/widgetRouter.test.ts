// Hermetic (express) test of the /widget embed surface (ADR-0011 §7).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import express from 'express'
import request from 'supertest'
import { createWidgetRouter, type WidgetRouterDeps } from '../../../../src/allocutio/api/widgetRouter.js'
import type { Legatus } from '../../../../src/types/legatus.js'
import type { FeedItem } from '../../../../src/allocutio/api/types.js'
import type { FeedFilter } from '../../../../src/types/editio.js'

function legatus(over: Partial<Legatus>): Legatus {
  return { agentId: 'camel42', animaId: 'anima-1', ownerAddress: '0xowner', status: 'active', ...over } as Legatus
}

function app(over: Partial<WidgetRouterDeps> = {}, capture?: { filter?: FeedFilter }) {
  const rawFeed = over.feed ?? (async () => [])
  const deps: WidgetRouterDeps = {
    legati: over.legati ?? { findByAgentId: async (id) => (id === 'camel42' ? legatus({}) : null) },
    feed: async (filter) => { if (capture) capture.filter = filter; return rawFeed(filter) },
    appearance: over.appearance ?? (async () => undefined),
    frameAncestors: over.frameAncestors ?? ['https://camelcabal.fun'],
    ...(over.limit !== undefined ? { limit: over.limit } : {}),
  }
  const a = express()
  a.use('/widget', createWidgetRouter(deps))
  return a
}

const imgItem = (url: string): FeedItem => ({ editionId: 'e1', artifact: { kind: 'actum', id: 'a1' }, output: { image: url }, createdAt: '2026-07-02T00:00:00.000Z' })

test('GET /widget/sdk.js → JS with the StationThis contract, no framing header', async () => {
  const res = await request(app()).get('/widget/sdk.js')
  assert.equal(res.status, 200)
  assert.match(res.headers['content-type'], /application\/javascript/)
  assert.match(res.text, /global\.StationThis = StationThis/)
  assert.match(res.text, /init:\s*function/)
  assert.match(res.text, /initGallery:\s*function/)
  // sdk.js is a <script> include — it must NOT carry a frame-ancestors header.
  assert.equal(res.headers['content-security-policy'], undefined)
})

test('GET /widget/:agentId → themed feed with per-partner frame-ancestors', async () => {
  const cap: { filter?: FeedFilter } = {}
  const a = app({ feed: async () => [imgItem('https://cdn.test/a.png')], appearance: async () => ({ accent: '#ff0088' }) }, cap)
  const res = await request(a).get('/widget/camel42')
  assert.equal(res.status, 200)
  assert.match(res.headers['content-type'], /text\/html/)
  assert.equal(res.headers['content-security-policy'], 'frame-ancestors https://camelcabal.fun')
  assert.match(res.text, /https:\/\/cdn\.test\/a\.png/)          // the tile rendered
  assert.match(res.text, /--accent:#ff0088/)                     // appearance themed
  assert.match(res.text, /WIDGET_READY/)                         // iframe bridge present
  // feed was author-scoped to the resolved agent Anima.
  assert.deepEqual(cap.filter?.author, { animaId: 'anima-1' })
  assert.equal(cap.filter?.visibility, 'feed')
})

test('GET /widget/:agentId unknown agent → 404 chrome-less page (still framed)', async () => {
  const res = await request(app()).get('/widget/nope')
  assert.equal(res.status, 404)
  assert.equal(res.headers['content-security-policy'], 'frame-ancestors https://camelcabal.fun')
  assert.match(res.text, /Agent not found/)
})

test('GET /widget/:agentId revoked agent → 404', async () => {
  const a = app({ legati: { findByAgentId: async () => legatus({ status: 'revoked' }) } })
  const res = await request(a).get('/widget/camel42')
  assert.equal(res.status, 404)
})

test('GET /widget/gallery/:addr → recent public feed (not author-scoped)', async () => {
  const cap: { filter?: FeedFilter } = {}
  const a = app({ feed: async () => [imgItem('https://cdn.test/g.png')] }, cap)
  const res = await request(a).get('/widget/gallery/0xABC')
  assert.equal(res.status, 200)
  assert.match(res.text, /https:\/\/cdn\.test\/g\.png/)
  assert.equal(cap.filter?.author, undefined)                    // gallery is cross-author
})

test('route ordering: /sdk.js and /gallery are not swallowed by /:agentId', async () => {
  // If /:agentId caught these, findByAgentId('sdk.js') → 404. Assert it did NOT.
  const seen: string[] = []
  const a = app({ legati: { findByAgentId: async (id) => { seen.push(id); return null } } })
  await request(a).get('/widget/sdk.js')
  await request(a).get('/widget/gallery/0xabc')
  assert.deepEqual(seen, [])                                     // neither hit the agent resolver
})

test('XSS/URL safety: javascript: urls dropped, malicious accent rejected', async () => {
  const evil: FeedItem = { editionId: 'e', artifact: { kind: 'actum', id: 'a' }, output: { image: 'javascript:alert(1)', image2: 'https://ok.test/b.png' }, createdAt: '2026-07-02T00:00:00.000Z' }
  const a = app({ feed: async () => [evil], appearance: async () => ({ accent: 'red;} body{display:none' }) })
  const res = await request(a).get('/widget/camel42')
  assert.equal(res.status, 200)
  assert.doesNotMatch(res.text, /javascript:alert/)              // unsafe url filtered out
  assert.match(res.text, /https:\/\/ok\.test\/b\.png/)          // safe url kept
  assert.doesNotMatch(res.text, /display:none/)                  // css-injection accent rejected
  assert.match(res.text, /--accent:#7c5cff/)                     // fell back to default accent
})

test('empty allowlist → frame-ancestors defaults to self', async () => {
  const a = app({ frameAncestors: [] })
  const res = await request(a).get('/widget/camel42')
  assert.equal(res.headers['content-security-policy'], "frame-ancestors 'self'")
})
