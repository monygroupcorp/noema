// partnerAdminRouter — GET/PATCH /v1/admin/partner-requests. Pure unit test
// (fake in-memory stores, no live Mongo): the platform-admin gate refuses a
// non-admin with the SAME error shape querelaAdminRouter uses, listing/status
// filters, and the provisioning-on-approval behavior:
//   - approving a request WITH an animaId creates exactly one Partner record
//     — and mints NO API key. Key issuance is self-serve (see
//     apiRouter.partnerApiKey.test.ts for that surface) precisely because the
//     admin approving a request is frequently not the partner; this router
//     must never hand a credential to whoever clicked Approve.
//   - approving a request WITHOUT an animaId only flips status — no Partner;
//   - a request that already has a decision cannot be decided again (409).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import express from 'express'
import { createPartnerAdminRouter } from '../../../src/api/partner/partnerAdminRouter.js'
import { MemoryPartnerRequest } from '../../../src/crystal/MemoryPartnerRequest.js'
import { MemoryPartner } from '../../../src/crystal/MemoryPartner.js'
import { emailKeyOf } from '../../../src/api/partner/partnerRequestRouter.js'
import type { AuctorKey } from '../../../src/flow/types.js'
import type { Credentials } from '../../../src/allocutio/api/IdentityResolver.js'
import { Errors } from '../../../src/allocutio/api/errors.js'

const PLATFORM_ANIMA_ID = 'platform'

const fakeIdentity = {
  async resolve(creds: Credentials): Promise<AuctorKey> {
    if (creds.authorization?.startsWith('Bearer ')) return { animaId: creds.authorization.slice('Bearer '.length) }
    if (creds.commitment) return { commitment: creds.commitment }
    throw Errors.authMissing()
  },
}

function makeServer(partnerRequests: MemoryPartnerRequest, partners: MemoryPartner) {
  const app = express()
  app.use(express.json())
  app.use('/v1/admin/partner-requests', createPartnerAdminRouter({ partnerRequests, partners, identity: fakeIdentity }))
  return new Promise<{ server: http.Server; url: string }>((resolve, reject) => {
    const server = app.listen(0, '127.0.0.1', () => {
      const addr = server.address() as { port: number }
      resolve({ server, url: `http://127.0.0.1:${addr.port}` })
    })
    server.on('error', reject)
  })
}

function closeServer(server: http.Server): Promise<void> {
  return new Promise((resolve, reject) => server.close(err => (err ? reject(err) : resolve())))
}

function request(method: string, url: string, headers: Record<string, string>, body?: unknown): Promise<{ status: number; body: any }> {
  return new Promise((resolvePromise, reject) => {
    const payload = body !== undefined ? JSON.stringify(body) : undefined
    const u = new URL(url)
    const req = http.request(
      { method, hostname: u.hostname, port: u.port, path: u.pathname + u.search, headers: { ...headers, ...(payload !== undefined ? { 'content-type': 'application/json' } : {}) } },
      res => {
        const chunks: Buffer[] = []
        res.on('data', c => chunks.push(c))
        res.on('end', () => {
          const raw = Buffer.concat(chunks).toString('utf8')
          resolvePromise({ status: res.statusCode ?? 0, body: raw ? JSON.parse(raw) : null })
        })
        res.on('error', reject)
      },
    )
    req.on('error', reject)
    if (payload !== undefined) req.write(payload)
    req.end()
  })
}

const ADMIN_HEADERS = { authorization: `Bearer ${PLATFORM_ANIMA_ID}` }
const NON_ADMIN_HEADERS = { authorization: 'Bearer some-other-anima' }

function setup() {
  return { partnerRequests: new MemoryPartnerRequest(), partners: new MemoryPartner() }
}

// ---------------------------------------------------------------------------
// (d) the platform-admin gate — same error shape querelaAdminRouter uses
// ---------------------------------------------------------------------------

test('GET /v1/admin/partner-requests refuses a non-admin identity with 403 auth.forbidden', async () => {
  const { partnerRequests, partners } = setup()
  const { server, url } = await makeServer(partnerRequests, partners)
  try {
    const res = await request('GET', `${url}/v1/admin/partner-requests`, NON_ADMIN_HEADERS)
    assert.equal(res.status, 403)
    assert.equal(res.body.error.code, 'auth.forbidden')
  } finally { await closeServer(server) }
})

test('GET /v1/admin/partner-requests refuses an unresolvable identity with 401', async () => {
  const { partnerRequests, partners } = setup()
  const { server, url } = await makeServer(partnerRequests, partners)
  try {
    const res = await request('GET', `${url}/v1/admin/partner-requests`, {})
    assert.equal(res.status, 401)
  } finally { await closeServer(server) }
})

test('PATCH /v1/admin/partner-requests/:id refuses a non-admin identity and writes nothing', async () => {
  const { partnerRequests, partners } = setup()
  const created = await partnerRequests.create({ contactEmail: 'x@example.com', useCase: 'x', emailKey: emailKeyOf('x@example.com'), animaId: 'anima-1' })
  const { server, url } = await makeServer(partnerRequests, partners)
  try {
    const res = await request('PATCH', `${url}/v1/admin/partner-requests/${created.id}`, NON_ADMIN_HEADERS, { status: 'approved' })
    assert.equal(res.status, 403)
    assert.equal(res.body.error.code, 'auth.forbidden')
    assert.equal((await partnerRequests.find(created.id))?.status, 'pending')
    assert.equal(await partners.find('anima-1'), null)
  } finally { await closeServer(server) }
})

// ---------------------------------------------------------------------------
// listing + filters
// ---------------------------------------------------------------------------

test('GET /v1/admin/partner-requests lists across all submitters; ?status= narrows', async () => {
  const { partnerRequests, partners } = setup()
  await partnerRequests.create({ contactEmail: 'a@example.com', useCase: 'a', emailKey: emailKeyOf('a@example.com') })
  const toApprove = await partnerRequests.create({ contactEmail: 'b@example.com', useCase: 'b', emailKey: emailKeyOf('b@example.com'), animaId: 'anima-b' })
  await partnerRequests.update(toApprove.id, { status: 'approved', decidedAt: new Date(), decidedBy: PLATFORM_ANIMA_ID })
  const { server, url } = await makeServer(partnerRequests, partners)
  try {
    const all = await request('GET', `${url}/v1/admin/partner-requests`, ADMIN_HEADERS)
    assert.equal(all.status, 200)
    assert.equal(all.body.requests.length, 2)

    const pending = await request('GET', `${url}/v1/admin/partner-requests?status=pending`, ADMIN_HEADERS)
    assert.equal(pending.body.requests.length, 1)
    assert.equal(pending.body.requests[0].contactEmail, 'a@example.com')

    const approved = await request('GET', `${url}/v1/admin/partner-requests?status=approved`, ADMIN_HEADERS)
    assert.equal(approved.body.requests.length, 1)
    assert.equal(approved.body.requests[0].contactEmail, 'b@example.com')
  } finally { await closeServer(server) }
})

test('GET /v1/admin/partner-requests?status=garbage is 400', async () => {
  const { partnerRequests, partners } = setup()
  const { server, url } = await makeServer(partnerRequests, partners)
  try {
    const res = await request('GET', `${url}/v1/admin/partner-requests?status=garbage`, ADMIN_HEADERS)
    assert.equal(res.status, 400)
  } finally { await closeServer(server) }
})

// ---------------------------------------------------------------------------
// (e) approving WITH an animaId — provisions a Partner, mints NO key
// ---------------------------------------------------------------------------

test('PATCH .../:id {status:approved} on a request WITH animaId creates exactly one Partner and returns NO apiKey', async () => {
  const { partnerRequests, partners } = setup()
  const animaId = 'anima-partner-1'
  const created = await partnerRequests.create({
    contactEmail: 'partner@example.com', org: 'Acme', useCase: 'embed', emailKey: emailKeyOf('partner@example.com'), animaId,
  })
  const { server, url } = await makeServer(partnerRequests, partners)
  try {
    const res = await request('PATCH', `${url}/v1/admin/partner-requests/${created.id}`, ADMIN_HEADERS, { status: 'approved' })
    assert.equal(res.status, 200)
    assert.equal(res.body.request.status, 'approved')
    assert.equal(res.body.request.decidedBy, PLATFORM_ANIMA_ID)
    assert.ok(res.body.request.decidedAt)
    assert.equal(res.body.apiKey, undefined, 'approval must never hand a key to the admin — self-serve only')
    assert.equal(res.body.partner.animaId, animaId)
    assert.equal(res.body.partner.org, 'Acme')
    assert.equal(res.body.partner.sourceRequestId, created.id)

    // Exactly one Partner record for this animaId.
    const allPartners = await partners.list()
    assert.equal(allPartners.length, 1)
    assert.equal(allPartners[0].animaId, animaId)
  } finally { await closeServer(server) }
})

test('PATCH .../:id {status:approved} on a request WITHOUT animaId only flips status — no Partner', async () => {
  const { partnerRequests, partners } = setup()
  const created = await partnerRequests.create({ contactEmail: 'anon@example.com', useCase: 'x', emailKey: emailKeyOf('anon@example.com') })
  const { server, url } = await makeServer(partnerRequests, partners)
  try {
    const res = await request('PATCH', `${url}/v1/admin/partner-requests/${created.id}`, ADMIN_HEADERS, { status: 'approved' })
    assert.equal(res.status, 200)
    assert.equal(res.body.request.status, 'approved')
    assert.equal(res.body.apiKey, undefined)
    assert.equal(res.body.partner, undefined)
    assert.equal((await partners.list()).length, 0)
  } finally { await closeServer(server) }
})

test('PATCH .../:id {status:declined} never provisions, even when animaId is present', async () => {
  const { partnerRequests, partners } = setup()
  const created = await partnerRequests.create({ contactEmail: 'nope@example.com', useCase: 'x', emailKey: emailKeyOf('nope@example.com'), animaId: 'anima-decline' })
  const { server, url } = await makeServer(partnerRequests, partners)
  try {
    const res = await request('PATCH', `${url}/v1/admin/partner-requests/${created.id}`, ADMIN_HEADERS, { status: 'declined' })
    assert.equal(res.status, 200)
    assert.equal(res.body.request.status, 'declined')
    assert.equal(res.body.apiKey, undefined)
    assert.equal(await partners.find('anima-decline'), null)
  } finally { await closeServer(server) }
})

test('PATCH .../:id on an already-decided request is refused with 409 conflict.already_decided', async () => {
  const { partnerRequests, partners } = setup()
  const animaId = 'anima-twice'
  const created = await partnerRequests.create({ contactEmail: 'twice@example.com', useCase: 'x', emailKey: emailKeyOf('twice@example.com'), animaId })
  const { server, url } = await makeServer(partnerRequests, partners)
  try {
    const first = await request('PATCH', `${url}/v1/admin/partner-requests/${created.id}`, ADMIN_HEADERS, { status: 'approved' })
    assert.equal(first.status, 200)
    const second = await request('PATCH', `${url}/v1/admin/partner-requests/${created.id}`, ADMIN_HEADERS, { status: 'approved' })
    assert.equal(second.status, 409)
    assert.equal(second.body.error.code, 'conflict.already_decided')
  } finally { await closeServer(server) }
})

test('PATCH .../:id with an unknown id is 404', async () => {
  const { partnerRequests, partners } = setup()
  const { server, url } = await makeServer(partnerRequests, partners)
  try {
    const res = await request('PATCH', `${url}/v1/admin/partner-requests/nope`, ADMIN_HEADERS, { status: 'approved' })
    assert.equal(res.status, 404)
  } finally { await closeServer(server) }
})

test('PATCH .../:id rejects a malformed status body', async () => {
  const { partnerRequests, partners } = setup()
  const created = await partnerRequests.create({ contactEmail: 'x@example.com', useCase: 'x', emailKey: emailKeyOf('x@example.com') })
  const { server, url } = await makeServer(partnerRequests, partners)
  try {
    const res = await request('PATCH', `${url}/v1/admin/partner-requests/${created.id}`, ADMIN_HEADERS, { status: 'pending' })
    assert.equal(res.status, 400)
  } finally { await closeServer(server) }
})
