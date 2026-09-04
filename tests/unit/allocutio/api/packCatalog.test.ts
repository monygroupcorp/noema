// =============================================================================
// packCatalog — the single-source credit-pack DISPLAY catalog.
// =============================================================================
//
// noema-122: the pack numbers were triplicated (stripePacks.PACKS, Funding's FIAT_PACKS,
// the app's content/pricing copy). They now flow from ONE server source — stripePacks → CrystalApi.listPacks →
// GET /v1/payments/packs — so a pack-number change updates every surface. These tests pin:
//   • the ratified catalog projection (credits = impetus/10, order, bestRate),
//   • that CrystalApi.listPacks maps it faithfully,
//   • that GET /v1/payments/packs is public (no auth) and returns { packs }.
// Hermetic: pure functions + one in-process express server. No network, no DB.
// =============================================================================

import { test } from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import express from 'express'

import { packCatalog, packViews, PACKS, PACK_IDS } from '../../../../src/ledger/stripePacks.js'
import { CrystalApi, type CrystalApiDeps } from '../../../../src/allocutio/api/CrystalApi.js'
import { createApiRouter, type ApiFacade, type Identity } from '../../../../src/allocutio/api/apiRouter.js'
import type { Credentials, ResolvedCaller } from '../../../../src/allocutio/api/IdentityResolver.js'

// The ratified public projection, cheapest → dearest. credits = impetus/10; studio_100 = best rate.
const EXPECTED = [
  { id: 'starter_10', usd: 10, credits: 2_080, label: 'Starter' },
  { id: 'standard_25', usd: 25, credits: 5_720, label: 'Standard' },
  { id: 'plus_50', usd: 50, credits: 12_480, label: 'Plus' },
  { id: 'studio_100', usd: 100, credits: 27_040, label: 'Studio', bestRate: true },
]

test('packCatalog: ordered cheapest → dearest, the 4 ratified SKUs', () => {
  assert.deepEqual(packCatalog().map((p) => p.id), [...PACK_IDS])
})

test('packViews: display projection — credits = impetus/10, tier label, single bestRate', () => {
  assert.deepEqual(packViews(), EXPECTED)
  // credits is exactly the source impetus / 10 (display unit), never a hand-typed number.
  for (const v of packViews()) {
    assert.equal(v.credits, Number(PACKS[v.id].impetus) / 10)
  }
  // exactly one best-rate pack, and it is the highest credits-per-USD (studio_100).
  assert.equal(packViews().filter((p) => p.bestRate).length, 1)
})

test('CrystalApi.listPacks: maps the catalog to the public shape (no deps needed)', () => {
  const api = new CrystalApi({} as unknown as CrystalApiDeps)
  assert.deepEqual(api.listPacks(), EXPECTED)
})

// --- route: GET /v1/payments/packs is public and returns { packs } ---------------------------

function serve(): { url: string; close: () => Promise<void> } {
  // The route only touches api.listPacks() (public, no auth) — a partial facade is enough.
  const api = { listPacks: () => packViews() } as unknown as ApiFacade
  const identity: Identity = {
    resolve: async (_c: Credentials) => { throw new Error('auth must NOT be called for a public catalog route') },
    resolveCaller: async (_c: Credentials): Promise<ResolvedCaller> => { throw new Error('auth must NOT be called for a public catalog route') },
  }
  const app = express()
  app.use(express.json())
  app.use('/v1', createApiRouter({ api, identity }))
  const server = http.createServer(app)
  server.listen(0)
  const addr = server.address()
  const port = typeof addr === 'object' && addr ? addr.port : 0
  return {
    url: `http://127.0.0.1:${port}`,
    close: () => new Promise<void>((res) => server.close(() => res())),
  }
}

test('GET /v1/payments/packs: public (no auth) → the ratified catalog', async () => {
  const s = serve()
  try {
    const r = await fetch(`${s.url}/v1/payments/packs`)
    assert.equal(r.status, 200)
    const body = await r.json() as { packs: unknown }
    assert.deepEqual(body.packs, EXPECTED)
  } finally {
    await s.close()
  }
})
