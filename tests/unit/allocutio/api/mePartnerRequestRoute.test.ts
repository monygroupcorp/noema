// =============================================================================
// GET /v1/me/partner-request — the applicant's read of their own application.
// =============================================================================
//
// The route that makes a partner decision reach the person it was made about.
// `GET /v1/me/partner` (mePartnerRoute.test.ts) answers only "are you an
// approved partner", and its 404 is equally true of someone who never applied,
// someone still in the review queue, and someone who was declined. This route
// separates those three, off `PartnerRequestStore.findByAnimaId` alone — it
// never files or decides anything.
//
// Same self-contained `serve()`/`fakeIdentity` shape as mePartnerRoute.test.ts,
// minus the API-key machinery this route has no use for. The store is the real
// `MemoryPartnerRequest` rather than a hand-rolled fake: `findByAnimaId`'s
// newest-first ordering is part of what "your application" means when someone
// has applied twice, so the implementation under test should be the one that
// orders.
// =============================================================================

import { test } from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import express from 'express'

import { createApiRouter, type ApiFacade, type Identity } from '../../../../src/allocutio/api/apiRouter.js'
import { Errors } from '../../../../src/allocutio/api/errors.js'
import type { AuctorKey } from '../../../../src/flow/types.js'
import type { Credentials } from '../../../../src/allocutio/api/IdentityResolver.js'
import { MemoryPartnerRequest } from '../../../../src/crystal/MemoryPartnerRequest.js'
import { emailKeyOf } from '../../../../src/api/partner/partnerRequestRouter.js'

// This route never touches the facade — an empty object is sufficient.
const emptyApi = {} as unknown as ApiFacade

const fakeIdentity: Identity = {
  async resolve(creds: Credentials): Promise<AuctorKey> {
    if (creds.apiKey === 'applicant-key') return { animaId: 'anima-applicant' }
    if (creds.apiKey === 'stranger-key') return { animaId: 'anima-stranger' }
    // An anonymous spend identity: resolves, but carries no animaId to match on.
    if (creds.commitment) return { commitment: creds.commitment }
    throw Errors.authMissing()
  },
  async resolveCaller(creds: Credentials) {
    return { auctor: await this.resolve(creds) }
  },
}

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

function getOwnRequest(base: string, headers: Record<string, string> = {}): Promise<{ status: number; body: any }> {
  return new Promise((resolve, reject) => {
    const req = http.request(`${base}/v1/me/partner-request`, { method: 'GET', headers }, (res) => {
      let data = ''
      res.on('data', (c) => (data += c))
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body: data ? JSON.parse(data) : undefined }))
    })
    req.on('error', reject)
    req.end()
  })
}

/** Seed one application the way `partnerRequestRouter` files it. */
async function fileRequest(
  store: MemoryPartnerRequest,
  fields: { contactEmail: string; useCase: string; animaId?: string; org?: string; nomen?: string; notes?: string },
) {
  return store.create({ ...fields, emailKey: emailKeyOf(fields.contactEmail) })
}

test('GET /v1/me/partner-request: a pending application comes back as pending', async () => {
  const partnerRequests = new MemoryPartnerRequest()
  await fileRequest(partnerRequests, {
    contactEmail: 'ops@acme.example', useCase: 'embed the widget', animaId: 'anima-applicant', org: 'Acme Studio',
  })
  const { base, close } = await serve(createApiRouter({ api: emptyApi, identity: fakeIdentity, partnerRequests }))
  try {
    const res = await getOwnRequest(base, { 'x-api-key': 'applicant-key' })
    assert.equal(res.status, 200)
    assert.equal(res.body.status, 'pending')
    assert.equal(res.body.org, 'Acme Studio')
    assert.equal(res.body.useCase, 'embed the widget')
    assert.equal(res.body.decidedAt, undefined, 'a pending application has no decision date')
  } finally { close() }
})

test('GET /v1/me/partner-request: a declined application says declined, and when', async () => {
  const partnerRequests = new MemoryPartnerRequest()
  const filed = await fileRequest(partnerRequests, {
    contactEmail: 'ops@acme.example', useCase: 'embed the widget', animaId: 'anima-applicant',
  })
  await partnerRequests.update(filed.id, {
    status: 'declined', decidedAt: new Date('2026-09-01T00:00:00.000Z'), decidedBy: 'platform',
  })
  const { base, close } = await serve(createApiRouter({ api: emptyApi, identity: fakeIdentity, partnerRequests }))
  try {
    const res = await getOwnRequest(base, { 'x-api-key': 'applicant-key' })
    assert.equal(res.status, 200)
    assert.equal(res.body.status, 'declined')
    assert.equal(res.body.decidedAt, '2026-09-01T00:00:00.000Z')
  } finally { close() }
})

test('GET /v1/me/partner-request: never returns the queue internals — emailKey, decidedBy, animaId', async () => {
  const partnerRequests = new MemoryPartnerRequest()
  const filed = await fileRequest(partnerRequests, {
    contactEmail: 'ops@acme.example', useCase: 'embed the widget', animaId: 'anima-applicant',
  })
  await partnerRequests.update(filed.id, { status: 'approved', decidedAt: new Date(), decidedBy: 'platform' })
  const { base, close } = await serve(createApiRouter({ api: emptyApi, identity: fakeIdentity, partnerRequests }))
  try {
    const res = await getOwnRequest(base, { 'x-api-key': 'applicant-key' })
    assert.equal(res.status, 200)
    assert.equal(res.body.emailKey, undefined)
    assert.equal(res.body.decidedBy, undefined)
    assert.equal(res.body.animaId, undefined)
  } finally { close() }
})

test('GET /v1/me/partner-request: after reapplying, the newest application is the answer', async () => {
  const partnerRequests = new MemoryPartnerRequest()
  const first = await fileRequest(partnerRequests, {
    contactEmail: 'ops@acme.example', useCase: 'the old plan', animaId: 'anima-applicant',
  })
  await partnerRequests.update(first.id, { status: 'declined', decidedAt: new Date('2026-08-01T00:00:00.000Z') })
  // `natum` is stamped by the store at create time; a second create is therefore newer.
  await new Promise((r) => setTimeout(r, 2))
  await fileRequest(partnerRequests, {
    contactEmail: 'ops@acme.example', useCase: 'the new plan', animaId: 'anima-applicant',
  })
  const { base, close } = await serve(createApiRouter({ api: emptyApi, identity: fakeIdentity, partnerRequests }))
  try {
    const res = await getOwnRequest(base, { 'x-api-key': 'applicant-key' })
    assert.equal(res.status, 200)
    assert.equal(res.body.useCase, 'the new plan')
    assert.equal(res.body.status, 'pending', 'the live answer, not the old decline')
  } finally { close() }
})

test('GET /v1/me/partner-request: 404 not_found.partner_request when this account has filed nothing', async () => {
  const partnerRequests = new MemoryPartnerRequest()
  await fileRequest(partnerRequests, {
    contactEmail: 'ops@acme.example', useCase: 'embed the widget', animaId: 'anima-applicant',
  })
  const { base, close } = await serve(createApiRouter({ api: emptyApi, identity: fakeIdentity, partnerRequests }))
  try {
    const res = await getOwnRequest(base, { 'x-api-key': 'stranger-key' })
    assert.equal(res.status, 404)
    assert.equal(res.body.error.code, 'not_found.partner_request')
  } finally { close() }
})

test("GET /v1/me/partner-request: an anonymous application is not readable — there is no account to match it to", async () => {
  const partnerRequests = new MemoryPartnerRequest()
  // No animaId: exactly what `partnerRequestRouter` stores for a signed-out submitter.
  await fileRequest(partnerRequests, { contactEmail: 'ops@acme.example', useCase: 'embed the widget' })
  const { base, close } = await serve(createApiRouter({ api: emptyApi, identity: fakeIdentity, partnerRequests }))
  try {
    const res = await getOwnRequest(base, { 'x-commitment': 'commitment-abc' })
    assert.equal(res.status, 404)
    assert.equal(res.body.error.code, 'not_found.partner_request')
  } finally { close() }
})

test('GET /v1/me/partner-request: 401 before anything else when no credential is presented', async () => {
  const partnerRequests = new MemoryPartnerRequest()
  const { base, close } = await serve(createApiRouter({ api: emptyApi, identity: fakeIdentity, partnerRequests }))
  try {
    const res = await getOwnRequest(base)
    assert.equal(res.status, 401)
  } finally { close() }
})

test('GET /v1/me/partner-request: 503 when this deployment wired no intake store — never a silent 404', async () => {
  const { base, close } = await serve(createApiRouter({ api: emptyApi, identity: fakeIdentity }))
  try {
    const res = await getOwnRequest(base, { 'x-api-key': 'applicant-key' })
    assert.equal(res.status, 503)
    assert.equal(res.body.error.code, 'internal.unavailable')
  } finally { close() }
})
