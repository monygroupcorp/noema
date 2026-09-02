// =============================================================================
// GET /v1/me/partner — the partner dashboard's access gate.
// =============================================================================
//
// A "partner" is just an ordinary Anima a platform admin has approved
// (types/partner.ts) — this route resolves the caller's identity exactly like
// every other `/me/*` route, then answers ONLY off `PartnerStore.find`. It
// never creates, mutates, or mints anything (that is the admin approval
// route's job, on a different surface — see partner-embed-06-partner-intake's
// partnerAdminRouter.ts, not touched by this branch).
//
// Follows the self-contained `serve()`/`fakeIdentity` pattern in eraseMe.test.ts
// rather than the shared giant `fakeApi` in apiRouter.test.ts — this route
// never calls into `ApiFacade` at all, so a full fake facade would be dead
// weight here.
// =============================================================================

import { test } from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import express from 'express'

import { createApiRouter, type ApiFacade, type Identity } from '../../../../src/allocutio/api/apiRouter.js'
import { Errors } from '../../../../src/allocutio/api/errors.js'
import type { AuctorKey } from '../../../../src/flow/types.js'
import type { Credentials } from '../../../../src/allocutio/api/IdentityResolver.js'
import type { Partner, PartnerStore } from '../../../../src/types/partner.js'

// ---------------------------------------------------------------------------
// Fakes
// ---------------------------------------------------------------------------

// This route never touches the facade — an empty object is sufficient.
const emptyApi = {} as unknown as ApiFacade

const fakeIdentity: Identity = {
  async resolve(creds: Credentials): Promise<AuctorKey> {
    if (creds.apiKey === 'partner-key') return { animaId: 'anima-partner' }
    if (creds.apiKey === 'revoked-key') return { animaId: 'anima-revoked' }
    if (creds.apiKey === 'stranger-key') return { animaId: 'anima-stranger' }
    if (creds.commitment) return { commitment: creds.commitment }
    throw Errors.authMissing()
  },
}

function makePartnerStore(seed: Partner[]): PartnerStore {
  const byId = new Map(seed.map((p) => [p.animaId, p]))
  return {
    async create(input) {
      const record: Partner = { ...input, status: input.status ?? 'active', natum: new Date() }
      byId.set(record.animaId, record)
      return record
    },
    async find(animaId) {
      return byId.get(animaId) ?? null
    },
    async list(filter) {
      const all = Array.from(byId.values())
      return filter?.status === undefined ? all : all.filter((p) => p.status === filter.status)
    },
    async setStatus(animaId, status) {
      const p = byId.get(animaId)
      if (p) byId.set(animaId, { ...p, status })
    },
  }
}

// ---------------------------------------------------------------------------
// Server helpers
// ---------------------------------------------------------------------------

function serve(router: express.Router): Promise<{ base: string; close: () => void }> {
  const app = express()
  app.use(express.json())
  app.use('/v1', router)
  return new Promise((resolve) => {
    const server = app.listen(0, () => {
      const addr = server.address()
      const port = typeof addr === 'object' && addr ? addr.port : 0
      resolve({ base: `http://127.0.0.1:${port}`, close: () => server.close() })
    })
  })
}

function getPartner(base: string, headers: Record<string, string> = {}): Promise<{ status: number; body: any }> {
  return new Promise((resolve, reject) => {
    const req = http.request(`${base}/v1/me/partner`, { method: 'GET', headers }, (res) => {
      let data = ''
      res.on('data', (c) => (data += c))
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body: data ? JSON.parse(data) : undefined }))
    })
    req.on('error', reject)
    req.end()
  })
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test('GET /v1/me/partner: returns the Partner record for an animaId with an active row', async () => {
  const partners = makePartnerStore([
    {
      animaId: 'anima-partner',
      status: 'active',
      org: 'Acme Studio',
      contactEmail: 'ops@acme.example',
      sourceRequestId: 'req-1',
      natum: new Date('2026-08-01T00:00:00.000Z'),
    },
  ])
  const router = createApiRouter({ api: emptyApi, identity: fakeIdentity, partners })
  const s = await serve(router)
  try {
    const res = await getPartner(s.base, { 'x-api-key': 'partner-key' })
    assert.equal(res.status, 200)
    assert.equal(res.body.animaId, 'anima-partner')
    assert.equal(res.body.status, 'active')
    assert.equal(res.body.org, 'Acme Studio')
    assert.equal(res.body.contactEmail, 'ops@acme.example')
    assert.equal(res.body.sourceRequestId, 'req-1')
  } finally { s.close() }
})

test('GET /v1/me/partner: 404 not_found.partner for an animaId with no Partner row', async () => {
  const partners = makePartnerStore([])
  const router = createApiRouter({ api: emptyApi, identity: fakeIdentity, partners })
  const s = await serve(router)
  try {
    const res = await getPartner(s.base, { 'x-api-key': 'stranger-key' })
    assert.equal(res.status, 404)
    assert.equal(res.body.error.code, 'not_found.partner')
  } finally { s.close() }
})

test('GET /v1/me/partner: 404 not_found.partner for a REVOKED Partner row (indistinguishable from no row)', async () => {
  const partners = makePartnerStore([
    { animaId: 'anima-revoked', status: 'revoked', sourceRequestId: 'req-2', natum: new Date('2026-07-01T00:00:00.000Z') },
  ])
  const router = createApiRouter({ api: emptyApi, identity: fakeIdentity, partners })
  const s = await serve(router)
  try {
    const res = await getPartner(s.base, { 'x-api-key': 'revoked-key' })
    assert.equal(res.status, 404)
    assert.equal(res.body.error.code, 'not_found.partner')
  } finally { s.close() }
})

test('GET /v1/me/partner: an anon (commitment-only) caller 404s — a Partner is always animaId-keyed', async () => {
  const partners = makePartnerStore([])
  const router = createApiRouter({ api: emptyApi, identity: fakeIdentity, partners })
  const s = await serve(router)
  try {
    const res = await getPartner(s.base, { 'x-commitment': 'cmt-1' })
    assert.equal(res.status, 404)
    assert.equal(res.body.error.code, 'not_found.partner')
  } finally { s.close() }
})

test('GET /v1/me/partner: unauthenticated caller gets 401 (auth resolves before any store lookup)', async () => {
  const partners = makePartnerStore([
    { animaId: 'anima-partner', status: 'active', sourceRequestId: 'req-1', natum: new Date() },
  ])
  const router = createApiRouter({ api: emptyApi, identity: fakeIdentity, partners })
  const s = await serve(router)
  try {
    const res = await getPartner(s.base)
    assert.equal(res.status, 401)
    assert.equal(res.body.error.code, 'auth.missing')
  } finally { s.close() }
})

test('GET /v1/me/partner: 503 internal.unavailable when no PartnerStore is wired (never a silent 404)', async () => {
  const router = createApiRouter({ api: emptyApi, identity: fakeIdentity }) // `partners` omitted
  const s = await serve(router)
  try {
    const res = await getPartner(s.base, { 'x-api-key': 'partner-key' })
    assert.equal(res.status, 503)
    assert.equal(res.body.error.code, 'internal.unavailable')
  } finally { s.close() }
})
