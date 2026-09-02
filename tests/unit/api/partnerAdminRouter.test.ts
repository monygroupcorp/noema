// partnerAdminRouter — GET/PATCH /v1/admin/partner-requests. Pure unit test
// (fake in-memory stores, no live Mongo): the platform-admin gate refuses a
// non-admin with the SAME error shape querelaAdminRouter uses, listing/status
// filters, and the identity-critical provisioning-on-approval behavior:
//   - approving a request WITH an animaId creates exactly one Partner record
//     and returns an API key that round-trips (through the REAL
//     verifyApiKeyToAccountId -> makeCredentialAcceptors -> IdentityResolver
//     chain) to that EXACT animaId;
//   - approving a request WITHOUT an animaId only flips status — no Partner,
//     no key;
//   - a request that already has a decision cannot be decided again (409).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import express from 'express'
import { createPartnerAdminRouter } from '../../../src/api/partner/partnerAdminRouter.js'
import { MemoryPartnerRequest } from '../../../src/crystal/MemoryPartnerRequest.js'
import { MemoryPartner } from '../../../src/crystal/MemoryPartner.js'
import { emailKeyOf } from '../../../src/api/partner/partnerRequestRouter.js'
import { verifyApiKeyToAccountId, type ApiKeyEntry, type ApiKeyUsersCollection } from '../../../src/crystal/apiKeys.js'
import { makeCredentialAcceptors, type AcceptorDeps } from '../../../src/allocutio/api/apiAcceptors.js'
import { IdentityResolver as ApiIdentityResolver } from '../../../src/allocutio/api/IdentityResolver.js'
import type { AuctorKey } from '../../../src/flow/types.js'
import type { Credentials } from '../../../src/allocutio/api/IdentityResolver.js'
import type { Persona, PersonaGenus } from '../../../src/types/persona.js'
import { Errors } from '../../../src/allocutio/api/errors.js'

const PLATFORM_ANIMA_ID = 'platform'

class FakeUsersCollection implements ApiKeyUsersCollection {
  docs = new Map<string, { _id: string; apiKeys: ApiKeyEntry[] }>()
  async findOne(filter: Record<string, unknown>): Promise<{ _id: unknown; apiKeys?: ApiKeyEntry[] } | null> {
    if (filter._id !== undefined) return this.docs.get(String(filter._id)) ?? null
    const prefix = filter['apiKeys.keyPrefix']
    if (typeof prefix === 'string') {
      for (const doc of this.docs.values()) if (doc.apiKeys.some(k => k.keyPrefix === prefix)) return doc
    }
    return null
  }
  async updateOne(filter: Record<string, unknown>, update: Record<string, unknown>, options?: { upsert?: boolean }): Promise<unknown> {
    const id = String(filter._id)
    let doc = this.docs.get(id)
    if (!doc) {
      if (!options?.upsert) return { matchedCount: 0 }
      doc = { _id: id, apiKeys: [] }
      this.docs.set(id, doc)
    }
    const push = (update as { $push?: { apiKeys: ApiKeyEntry } }).$push
    if (push?.apiKeys) doc.apiKeys.push(push.apiKeys)
    return { matchedCount: 1 }
  }
}

function fakePersonae() {
  const byKey = new Map<string, Persona>()
  return {
    async findByExternus(genus: PersonaGenus, externusId: string): Promise<Persona | null> {
      return byKey.get(`${genus}\0${externusId}`) ?? null
    },
    async findOrCreate(genus: PersonaGenus, externusId: string, defaults?: { animaId: string }): Promise<Persona> {
      const existing = byKey.get(`${genus}\0${externusId}`)
      if (existing) return existing
      const p: Persona = {
        id: `persona-${byKey.size + 1}`, activeAnimaId: defaults!.animaId, animaIds: [defaults!.animaId],
        genus, externusId, status: 'active', natum: new Date(), visum: new Date(),
      }
      byKey.set(`${genus}\0${externusId}`, p)
      return p
    },
  }
}

const fakeIdentity = {
  async resolve(creds: Credentials): Promise<AuctorKey> {
    if (creds.authorization?.startsWith('Bearer ')) return { animaId: creds.authorization.slice('Bearer '.length) }
    if (creds.commitment) return { commitment: creds.commitment }
    throw Errors.authMissing()
  },
}

function makeServer(partnerRequests: MemoryPartnerRequest, partners: MemoryPartner, personae: ReturnType<typeof fakePersonae>, usersCol: FakeUsersCollection) {
  const app = express()
  app.use(express.json())
  app.use('/v1/admin/partner-requests', createPartnerAdminRouter({ partnerRequests, partners, identity: fakeIdentity, personae, usersCol }))
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
  return { partnerRequests: new MemoryPartnerRequest(), partners: new MemoryPartner(), personae: fakePersonae(), usersCol: new FakeUsersCollection() }
}

// ---------------------------------------------------------------------------
// (d) the platform-admin gate — same error shape querelaAdminRouter uses
// ---------------------------------------------------------------------------

test('GET /v1/admin/partner-requests refuses a non-admin identity with 403 auth.forbidden', async () => {
  const { partnerRequests, partners, personae, usersCol } = setup()
  const { server, url } = await makeServer(partnerRequests, partners, personae, usersCol)
  try {
    const res = await request('GET', `${url}/v1/admin/partner-requests`, NON_ADMIN_HEADERS)
    assert.equal(res.status, 403)
    assert.equal(res.body.error.code, 'auth.forbidden')
  } finally { await closeServer(server) }
})

test('GET /v1/admin/partner-requests refuses an unresolvable identity with 401', async () => {
  const { partnerRequests, partners, personae, usersCol } = setup()
  const { server, url } = await makeServer(partnerRequests, partners, personae, usersCol)
  try {
    const res = await request('GET', `${url}/v1/admin/partner-requests`, {})
    assert.equal(res.status, 401)
  } finally { await closeServer(server) }
})

test('PATCH /v1/admin/partner-requests/:id refuses a non-admin identity, writes nothing, mints no key', async () => {
  const { partnerRequests, partners, personae, usersCol } = setup()
  const created = await partnerRequests.create({ contactEmail: 'x@example.com', useCase: 'x', emailKey: emailKeyOf('x@example.com'), animaId: 'anima-1' })
  const { server, url } = await makeServer(partnerRequests, partners, personae, usersCol)
  try {
    const res = await request('PATCH', `${url}/v1/admin/partner-requests/${created.id}`, NON_ADMIN_HEADERS, { status: 'approved' })
    assert.equal(res.status, 403)
    assert.equal(res.body.error.code, 'auth.forbidden')
    assert.equal((await partnerRequests.find(created.id))?.status, 'pending')
    assert.equal(await partners.find('anima-1'), null)
    assert.equal(usersCol.docs.size, 0)
  } finally { await closeServer(server) }
})

// ---------------------------------------------------------------------------
// listing + filters
// ---------------------------------------------------------------------------

test('GET /v1/admin/partner-requests lists across all submitters; ?status= narrows', async () => {
  const { partnerRequests, partners, personae, usersCol } = setup()
  await partnerRequests.create({ contactEmail: 'a@example.com', useCase: 'a', emailKey: emailKeyOf('a@example.com') })
  const toApprove = await partnerRequests.create({ contactEmail: 'b@example.com', useCase: 'b', emailKey: emailKeyOf('b@example.com'), animaId: 'anima-b' })
  await partnerRequests.update(toApprove.id, { status: 'approved', decidedAt: new Date(), decidedBy: PLATFORM_ANIMA_ID })
  const { server, url } = await makeServer(partnerRequests, partners, personae, usersCol)
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
  const { partnerRequests, partners, personae, usersCol } = setup()
  const { server, url } = await makeServer(partnerRequests, partners, personae, usersCol)
  try {
    const res = await request('GET', `${url}/v1/admin/partner-requests?status=garbage`, ADMIN_HEADERS)
    assert.equal(res.status, 400)
  } finally { await closeServer(server) }
})

// ---------------------------------------------------------------------------
// (e) approving WITH an animaId — the identity-critical path
// ---------------------------------------------------------------------------

test('PATCH .../:id {status:approved} on a request WITH animaId creates exactly one Partner and a key that round-trips to that EXACT animaId', async () => {
  const { partnerRequests, partners, personae, usersCol } = setup()
  const animaId = 'anima-partner-1'
  const created = await partnerRequests.create({
    contactEmail: 'partner@example.com', org: 'Acme', useCase: 'embed', emailKey: emailKeyOf('partner@example.com'), animaId,
  })
  const { server, url } = await makeServer(partnerRequests, partners, personae, usersCol)
  try {
    const res = await request('PATCH', `${url}/v1/admin/partner-requests/${created.id}`, ADMIN_HEADERS, { status: 'approved' })
    assert.equal(res.status, 200)
    assert.equal(res.body.request.status, 'approved')
    assert.equal(res.body.request.decidedBy, PLATFORM_ANIMA_ID)
    assert.ok(res.body.request.decidedAt)
    assert.match(res.body.apiKey, /^ms2_[0-9a-f]{48}$/)
    assert.equal(res.body.partner.animaId, animaId)
    assert.equal(res.body.partner.org, 'Acme')
    assert.equal(res.body.partner.sourceRequestId, created.id)

    // Exactly one Partner record for this animaId.
    const allPartners = await partners.list()
    assert.equal(allPartners.length, 1)
    assert.equal(allPartners[0].animaId, animaId)

    // THE load-bearing assertion: the returned raw key round-trips through the REAL
    // verifyApiKeyToAccountId -> makeCredentialAcceptors -> IdentityResolver chain to
    // the EXACT animaId the request carried — not assumed, proven.
    const acc: AcceptorDeps['personae'] = personae
    const animae: AcceptorDeps['animae'] = { async create() { throw new Error('must not mint a new anima for an existing partner') } }
    const acceptors = makeCredentialAcceptors({ personae: acc, animae, verifyApiKeyToAccountId: (k: string) => verifyApiKeyToAccountId(usersCol, k) })
    const resolver = new ApiIdentityResolver(acceptors)
    const resolved = await resolver.resolve({ apiKey: res.body.apiKey })
    assert.deepEqual(resolved, { animaId })
  } finally { await closeServer(server) }
})

test('PATCH .../:id {status:approved} on a request WITHOUT animaId only flips status — no Partner, no key', async () => {
  const { partnerRequests, partners, personae, usersCol } = setup()
  const created = await partnerRequests.create({ contactEmail: 'anon@example.com', useCase: 'x', emailKey: emailKeyOf('anon@example.com') })
  const { server, url } = await makeServer(partnerRequests, partners, personae, usersCol)
  try {
    const res = await request('PATCH', `${url}/v1/admin/partner-requests/${created.id}`, ADMIN_HEADERS, { status: 'approved' })
    assert.equal(res.status, 200)
    assert.equal(res.body.request.status, 'approved')
    assert.equal(res.body.apiKey, undefined)
    assert.equal(res.body.partner, undefined)
    assert.equal((await partners.list()).length, 0)
    assert.equal(usersCol.docs.size, 0)
  } finally { await closeServer(server) }
})

test('PATCH .../:id {status:declined} never provisions, even when animaId is present', async () => {
  const { partnerRequests, partners, personae, usersCol } = setup()
  const created = await partnerRequests.create({ contactEmail: 'nope@example.com', useCase: 'x', emailKey: emailKeyOf('nope@example.com'), animaId: 'anima-decline' })
  const { server, url } = await makeServer(partnerRequests, partners, personae, usersCol)
  try {
    const res = await request('PATCH', `${url}/v1/admin/partner-requests/${created.id}`, ADMIN_HEADERS, { status: 'declined' })
    assert.equal(res.status, 200)
    assert.equal(res.body.request.status, 'declined')
    assert.equal(res.body.apiKey, undefined)
    assert.equal(await partners.find('anima-decline'), null)
  } finally { await closeServer(server) }
})

test('PATCH .../:id on an already-decided request is refused with 409 conflict.already_decided, and mints no second key', async () => {
  const { partnerRequests, partners, personae, usersCol } = setup()
  const animaId = 'anima-twice'
  const created = await partnerRequests.create({ contactEmail: 'twice@example.com', useCase: 'x', emailKey: emailKeyOf('twice@example.com'), animaId })
  const { server, url } = await makeServer(partnerRequests, partners, personae, usersCol)
  try {
    const first = await request('PATCH', `${url}/v1/admin/partner-requests/${created.id}`, ADMIN_HEADERS, { status: 'approved' })
    assert.equal(first.status, 200)
    const second = await request('PATCH', `${url}/v1/admin/partner-requests/${created.id}`, ADMIN_HEADERS, { status: 'approved' })
    assert.equal(second.status, 409)
    assert.equal(second.body.error.code, 'conflict.already_decided')
    assert.equal(usersCol.docs.get(animaId)?.apiKeys.length, 1, 'only ONE key ever minted despite the second PATCH')
  } finally { await closeServer(server) }
})

test('PATCH .../:id with an unknown id is 404', async () => {
  const { partnerRequests, partners, personae, usersCol } = setup()
  const { server, url } = await makeServer(partnerRequests, partners, personae, usersCol)
  try {
    const res = await request('PATCH', `${url}/v1/admin/partner-requests/nope`, ADMIN_HEADERS, { status: 'approved' })
    assert.equal(res.status, 404)
  } finally { await closeServer(server) }
})

test('PATCH .../:id rejects a malformed status body', async () => {
  const { partnerRequests, partners, personae, usersCol } = setup()
  const created = await partnerRequests.create({ contactEmail: 'x@example.com', useCase: 'x', emailKey: emailKeyOf('x@example.com') })
  const { server, url } = await makeServer(partnerRequests, partners, personae, usersCol)
  try {
    const res = await request('PATCH', `${url}/v1/admin/partner-requests/${created.id}`, ADMIN_HEADERS, { status: 'pending' })
    assert.equal(res.status, 400)
  } finally { await closeServer(server) }
})
