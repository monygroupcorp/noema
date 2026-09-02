// Hermetic (express) test of the /widget embed surface (ADR-0011 §7).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import express from 'express'
import request from 'supertest'
import { createWidgetRouter, type WidgetRouterDeps } from '../../../../src/allocutio/api/widgetRouter.js'
import type { Legatus } from '../../../../src/types/legatus.js'
import type { FeedItem } from '../../../../src/allocutio/api/types.js'
import type { FeedFilter } from '../../../../src/types/editio.js'
import type { Modus } from '../../../../src/types/modus.js'
import { DEFAULT_X402_CONFIG } from '../../../../src/crystal/x402Pricing.js'

function legatus(over: Partial<Legatus>): Legatus {
  return { agentId: 'camel42', animaId: 'anima-1', ownerAddress: '0xowner', status: 'active', ...over } as Legatus
}

const GLOBAL_ANCESTORS = ['https://camelcabal.fun']

function app(over: Partial<WidgetRouterDeps> = {}, capture?: { filter?: FeedFilter }) {
  const rawFeed = over.feed ?? (async () => [])
  const deps: WidgetRouterDeps = {
    legati: over.legati ?? {
      findByAgentId: async (id) => (id === 'camel42' ? legatus({}) : null),
      listByCollection: async (addr) => (addr.toLowerCase() === '0xcollection' ? [legatus({ adapter: '0xcollection' })] : []),
    },
    feed: async (filter) => { if (capture) capture.filter = filter; return rawFeed(filter) },
    appearance: over.appearance ?? (async () => undefined),
    // Mirrors the real src/index.ts resolver: a per-`Legatus` list wins, else the global list.
    frameAncestors: over.frameAncestors ?? ((l) => (l?.frameAncestors?.length ? l.frameAncestors : GLOBAL_ANCESTORS)),
    ...(over.modorum ? { modorum: over.modorum } : {}),
    ...(over.quoteImpetus ? { quoteImpetus: over.quoteImpetus } : {}),
    ...(over.x402Config ? { x402Config: over.x402Config } : {}),
    ...(over.sessionAuth !== undefined ? { sessionAuth: over.sessionAuth } : {}),
    ...(over.limit !== undefined ? { limit: over.limit } : {}),
  }
  const a = express()
  a.use('/widget', createWidgetRouter(deps))
  return a
}

const imgItem = (url: string): FeedItem => ({ editionId: 'e1', artifact: { kind: 'actum', id: 'a1' }, output: { image: url }, createdAt: '2026-07-02T00:00:00.000Z' })

const MODUS = { id: 'm1', nomen: 'memeify', auctor: { animaId: 'anima-1' }, aditus: { prompt: { type: 'text', required: true, label: 'Prompt' }, seed: { type: 'int' } } } as unknown as Modus
const MODUS2 = { id: 'm2', nomen: 'upscale', auctor: { animaId: 'anima-1' }, aditus: { image: { type: 'image', required: true } } } as unknown as Modus
function interactive(modi: Modus[] = [MODUS]) {
  return app({
    legati: { findByAgentId: async () => legatus({ workspaceModusId: 'm1' }), listByCollection: async () => [] },
    modorum: { find: async (id) => modi.find((m) => m.id === id) ?? null, list: async () => modi },
    quoteImpetus: async (id) => (id === 'm2' ? 2000n : 1000n),
    x402Config: { ...DEFAULT_X402_CONFIG, payTo: '0xReceiver' },
  })
}

test('entrance gate: no access code → the enter-code gate, not the run panel', async () => {
  const res = await request(interactive()).get('/widget/camel42')
  assert.equal(res.status, 200)
  assert.match(res.text, /id="gateform"/)
  assert.match(res.text, /Enter your access code/)
  assert.doesNotMatch(res.text, /id="runbtn"/)                      // no run until a code
})

test('with a code: run panel holds the token + runs on the purse via /v1/runs (no x402/wallet)', async () => {
  const res = await request(interactive()).get('/widget/camel42?code=purse-abc')
  assert.equal(res.status, 200)
  assert.match(res.text, /id="runwrap" data-code="purse-abc"/)      // the Bursa token is held
  assert.match(res.text, /class="mform active"[^>]*data-modus="m1"/)
  assert.match(res.text, /<textarea name="prompt"/)                 // text porta → textarea
  assert.match(res.text, /name="seed"[^>]*type="number"|type="number"[^>]*name="seed"/) // int → number
  assert.match(res.text, /id="runbtn">Run · ~\d+ cr/)               // priced in credits, not USDC
  assert.match(res.text, /\/v1\/runs/)                              // runs via the identified path
  assert.match(res.text, /x-bursa-token/)                           // spending the purse
  assert.doesNotMatch(res.text, /PAYMENT_REQUIRED/)                 // no wallet/x402 on the human surface
  assert.doesNotMatch(res.text, /class="modchip/)                  // single modus → no picker
})

test('with a code: multiple modi → a picker with one chip + form (distinct credit prices)', async () => {
  const res = await request(interactive([MODUS, MODUS2])).get('/widget/camel42?code=x')
  assert.equal(res.status, 200)
  assert.match(res.text, /class="modchip active" data-modus="m1">memeify/)
  assert.match(res.text, /class="modchip" data-modus="m2">upscale/)
  assert.match(res.text, /class="mform" data-modus="m2"/)
  const p1 = res.text.match(/data-modus="m1"[^>]*data-price="([^"]+)"/)?.[1]
  const p2 = res.text.match(/data-modus="m2"[^>]*data-price="([^"]+)"/)?.[1]
  assert.ok(p1 && p2 && p1 !== p2, `m1 (${p1}) and m2 (${p2}) should be priced differently`)
})

test('login: header carries the connect-wallet pill + owner address; sign-in off by default', async () => {
  const owner = '0x' + 'a'.repeat(40)
  const a = app({ legati: { findByAgentId: async () => legatus({ ownerAddress: owner }), listByCollection: async () => [] } })
  const res = await request(a).get('/widget/camel42')
  assert.match(res.text, new RegExp(`id="login" class="login" data-owner="${owner}" data-session="0"`))
  assert.match(res.text, /CONNECT_WALLET/)                          // connect-wallet bridge present
  assert.match(res.text, /Connect wallet/)                          // the real (no-backend) affordance
})

test('login: sessionAuth flips data-session on (enables the sign-in step)', async () => {
  const a = app({ sessionAuth: true, legati: { findByAgentId: async () => legatus({ ownerAddress: '0x' + 'b'.repeat(40) }), listByCollection: async () => [] } })
  const res = await request(a).get('/widget/camel42')
  assert.match(res.text, /data-session="1"/)
  assert.match(res.text, /WALLET_AUTH_REQUEST/)                     // sign-in wired
})

test('interactive: agent with no callable modus falls back to the read-only gallery', async () => {
  const a = app({
    legati: { findByAgentId: async () => legatus({}), listByCollection: async () => [] },  // no workspaceModusId
    modorum: { find: async () => MODUS, list: async () => [] },   // no authored modi in this fixture
    quoteImpetus: async () => 1000n,
    x402Config: { ...DEFAULT_X402_CONFIG, payTo: '0xReceiver' },
    feed: async () => [imgItem('https://cdn.test/a.png')],
  })
  const res = await request(a).get('/widget/camel42')
  assert.equal(res.status, 200)
  assert.doesNotMatch(res.text, /id="runform"/)                     // no run panel
  assert.match(res.text, /https:\/\/cdn\.test\/a\.png/)             // gallery still shown
})

test('GET /widget/sdk.js → JS with the Noema contract, no framing header', async () => {
  const res = await request(app()).get('/widget/sdk.js')
  assert.equal(res.status, 200)
  assert.match(res.headers['content-type'], /application\/javascript/)
  assert.match(res.text, /global\.Noema = Noema/)
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
  const a = app({ legati: { findByAgentId: async () => legatus({ status: 'revoked' }), listByCollection: async () => [] } })
  const res = await request(a).get('/widget/camel42')
  assert.equal(res.status, 404)
})

test('GET /widget/gallery/:addr → scoped to the collection\'s agents', async () => {
  const cap: { filter?: FeedFilter } = {}
  const a = app({ feed: async () => [imgItem('https://cdn.test/g.png')] }, cap)
  const res = await request(a).get('/widget/gallery/0xCOLLECTION')
  assert.equal(res.status, 200)
  assert.match(res.text, /https:\/\/cdn\.test\/g\.png/)
  // feed was scoped to the collection's agent animaIds (not the whole platform feed).
  assert.deepEqual(cap.filter?.authorAnimaIds, ['anima-1'])
  assert.equal(cap.filter?.author, undefined)
})

test('GET /widget/gallery/:addr → unknown collection renders empty (no cross-collection leak)', async () => {
  let feedCalled = false
  const a = app({ feed: async () => { feedCalled = true; return [] } })
  const res = await request(a).get('/widget/gallery/0xUNKNOWN')
  assert.equal(res.status, 200)
  assert.match(res.text, /No creations in this collection/)
  assert.equal(feedCalled, false)                                // no agents → no feed query at all
})

test('route ordering: /sdk.js and /gallery are not swallowed by /:agentId', async () => {
  // If /:agentId caught these, findByAgentId('sdk.js') → 404. Assert it did NOT.
  const seen: string[] = []
  const a = app({ legati: { findByAgentId: async (id) => { seen.push(id); return null }, listByCollection: async () => [] } })
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
  assert.doesNotMatch(res.text, /red;\} body\{display:none/)     // the injection payload never lands
  assert.match(res.text, /--accent:#5b8cff/)                     // fell back to the NOEMA default accent
})

test('empty allowlist → frame-ancestors defaults to self', async () => {
  const a = app({ frameAncestors: () => [] })
  const res = await request(a).get('/widget/camel42')
  assert.equal(res.headers['content-security-policy'], "frame-ancestors 'self'")
})

test('per-agent frameAncestors on the Legatus wins over the global list', async () => {
  const a = app({
    legati: {
      findByAgentId: async () => legatus({ frameAncestors: ['https://partner-a.example'] }),
      listByCollection: async () => [],
    },
  })
  const res = await request(a).get('/widget/camel42')
  assert.equal(res.status, 200)
  assert.equal(res.headers['content-security-policy'], 'frame-ancestors https://partner-a.example')
})

test('agent without a per-agent frameAncestors falls back to the global list unchanged (regression)', async () => {
  const a = app({
    legati: { findByAgentId: async () => legatus({}), listByCollection: async () => [] },  // no frameAncestors set
  })
  const res = await request(a).get('/widget/camel42')
  assert.equal(res.status, 200)
  assert.equal(res.headers['content-security-policy'], `frame-ancestors ${GLOBAL_ANCESTORS.join(' ')}`)
})

test('gallery: a collection whose agent has a per-agent frameAncestors uses it', async () => {
  const a = app({
    legati: {
      findByAgentId: async () => null,
      listByCollection: async (addr) =>
        addr.toLowerCase() === '0xcollection'
          ? [legatus({ adapter: '0xcollection', frameAncestors: ['https://partner-b.example'] })]
          : [],
    },
  })
  const res = await request(a).get('/widget/gallery/0xCOLLECTION')
  assert.equal(res.status, 200)
  assert.equal(res.headers['content-security-policy'], 'frame-ancestors https://partner-b.example')
})

test('gallery: a collection with no per-agent frameAncestors is unaffected (regression)', async () => {
  const res = await request(app()).get('/widget/gallery/0xCOLLECTION')
  assert.equal(res.status, 200)
  assert.equal(res.headers['content-security-policy'], `frame-ancestors ${GLOBAL_ANCESTORS.join(' ')}`)
})

test('gallery: unknown collection (no agents at all) still gets the global default', async () => {
  const res = await request(app()).get('/widget/gallery/0xUNKNOWN')
  assert.equal(res.status, 200)
  assert.equal(res.headers['content-security-policy'], `frame-ancestors ${GLOBAL_ANCESTORS.join(' ')}`)
})
