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
import { verifyApiKeyToAccountId, type ApiKeyEntry, type ApiKeyUsersCollection } from '../../../../src/crystal/apiKeys.js'
import { makeCredentialAcceptors, type AcceptorDeps } from '../../../../src/allocutio/api/apiAcceptors.js'
import { IdentityResolver as ApiIdentityResolver } from '../../../../src/allocutio/api/IdentityResolver.js'
import type { Persona, PersonaGenus } from '../../../../src/types/persona.js'

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
  // `Identity` also carries `resolveCaller` — identity plus the limits the CREDENTIAL imposes
  // (a partner API key's per-run spend ceiling). This route never admits spend, so it is
  // `resolve` plus an empty limit set: exactly the shape a key with no ceiling resolves to.
  async resolveCaller(creds: Credentials) {
    return { auctor: await this.resolve(creds) }
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
  async updateOne(
    filter: Record<string, unknown>,
    update: Record<string, unknown>,
    options?: { upsert?: boolean; arrayFilters?: Record<string, unknown>[] },
  ): Promise<unknown> {
    const id = String(filter._id)
    let doc = this.docs.get(id)
    if (!doc) {
      if (!options?.upsert) return { matchedCount: 0 }
      doc = { _id: id, apiKeys: [] }
      this.docs.set(id, doc)
    }
    const push = (update as { $push?: { apiKeys: ApiKeyEntry } }).$push
    if (push?.apiKeys) doc.apiKeys.push(push.apiKeys)
    const set = (update as { $set?: Record<string, unknown> })['$set']
    if (set && 'apiKeys.$[elem].status' in set) {
      const filterSpec = options?.arrayFilters?.[0] as { 'elem.name'?: string; 'elem.status'?: string } | undefined
      for (const k of doc.apiKeys) {
        if (filterSpec?.['elem.name'] !== undefined && k.name !== filterSpec['elem.name']) continue
        if (filterSpec?.['elem.status'] !== undefined && k.status !== filterSpec['elem.status']) continue
        k.status = set['apiKeys.$[elem].status'] as ApiKeyEntry['status']
      }
    }
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

function postApiKey(base: string, headers: Record<string, string> = {}): Promise<{ status: number; body: any }> {
  return new Promise((resolve, reject) => {
    const req = http.request(`${base}/v1/me/partner/api-key`, { method: 'POST', headers }, (res) => {
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

// ---------------------------------------------------------------------------
// POST /v1/me/partner/api-key — self-serve issue/rotate. NEVER reachable from
// the admin approval surface (partnerAdminRouter.ts) — this is the only place
// a partner's raw key is ever returned, to the partner's own authenticated
// request, never to whoever approved their application.
// ---------------------------------------------------------------------------

test('POST /v1/me/partner/api-key: mints a key that round-trips to the EXACT calling animaId (real chain, not assumed)', async () => {
  const animaId = 'anima-partner'
  const partners = makePartnerStore([
    { animaId, status: 'active', sourceRequestId: 'req-1', natum: new Date() },
  ])
  const personae = fakePersonae()
  const usersCol = new FakeUsersCollection()
  const router = createApiRouter({ api: emptyApi, identity: fakeIdentity, partners, apiKeys: { personae, usersCol } })
  const s = await serve(router)
  try {
    const res = await postApiKey(s.base, { 'x-api-key': 'partner-key' })
    assert.equal(res.status, 200)
    assert.match(res.body.apiKey, /^ms2_[0-9a-f]{48}$/)

    // THE load-bearing assertion: the returned raw key round-trips through the REAL
    // verifyApiKeyToAccountId -> makeCredentialAcceptors -> IdentityResolver chain to
    // the EXACT animaId that called this route — not assumed, proven. A fake `animae`
    // that throws on create() proves no new anima was minted along the way.
    const acc: AcceptorDeps['personae'] = personae
    const animae: AcceptorDeps['animae'] = { async create() { throw new Error('must not mint a new anima') } }
    const acceptors = makeCredentialAcceptors({ personae: acc, animae, verifyApiKeyToAccountId: (k: string) => verifyApiKeyToAccountId(usersCol, k) })
    const resolver = new ApiIdentityResolver(acceptors)
    const resolved = await resolver.resolve({ apiKey: res.body.apiKey })
    assert.deepEqual(resolved, { animaId })
  } finally { s.close() }
})

test('POST /v1/me/partner/api-key: rotating retires the PREVIOUS key — old one no longer resolves', async () => {
  const animaId = 'anima-partner'
  const partners = makePartnerStore([{ animaId, status: 'active', sourceRequestId: 'req-1', natum: new Date() }])
  const personae = fakePersonae()
  const usersCol = new FakeUsersCollection()
  const router = createApiRouter({ api: emptyApi, identity: fakeIdentity, partners, apiKeys: { personae, usersCol } })
  const s = await serve(router)
  try {
    const first = await postApiKey(s.base, { 'x-api-key': 'partner-key' })
    const second = await postApiKey(s.base, { 'x-api-key': 'partner-key' })
    assert.notEqual(first.body.apiKey, second.body.apiKey)

    const acceptors = makeCredentialAcceptors({
      personae, animae: { async create() { throw new Error('must not mint a new anima') } },
      verifyApiKeyToAccountId: (k: string) => verifyApiKeyToAccountId(usersCol, k),
    })
    const resolver = new ApiIdentityResolver(acceptors)
    // The old key is dead.
    await assert.rejects(() => resolver.resolve({ apiKey: first.body.apiKey }))
    // The new one works.
    assert.deepEqual(await resolver.resolve({ apiKey: second.body.apiKey }), { animaId })
    // Exactly one live key on the account.
    assert.equal(usersCol.docs.get(animaId)?.apiKeys.filter(k => k.status === 'active').length, 1)
  } finally { s.close() }
})

test('POST /v1/me/partner/api-key: 404 not_found.partner for a non-partner caller — mints nothing', async () => {
  const partners = makePartnerStore([])
  const usersCol = new FakeUsersCollection()
  const router = createApiRouter({ api: emptyApi, identity: fakeIdentity, partners, apiKeys: { personae: fakePersonae(), usersCol } })
  const s = await serve(router)
  try {
    const res = await postApiKey(s.base, { 'x-api-key': 'stranger-key' })
    assert.equal(res.status, 404)
    assert.equal(res.body.error.code, 'not_found.partner')
    assert.equal(usersCol.docs.size, 0)
  } finally { s.close() }
})

test('POST /v1/me/partner/api-key: unauthenticated caller gets 401 before any store lookup', async () => {
  const partners = makePartnerStore([{ animaId: 'anima-partner', status: 'active', sourceRequestId: 'req-1', natum: new Date() }])
  const router = createApiRouter({ api: emptyApi, identity: fakeIdentity, partners, apiKeys: { personae: fakePersonae(), usersCol: new FakeUsersCollection() } })
  const s = await serve(router)
  try {
    const res = await postApiKey(s.base)
    assert.equal(res.status, 401)
  } finally { s.close() }
})

test('POST /v1/me/partner/api-key: 503 when apiKeys deps are not wired', async () => {
  const partners = makePartnerStore([{ animaId: 'anima-partner', status: 'active', sourceRequestId: 'req-1', natum: new Date() }])
  const router = createApiRouter({ api: emptyApi, identity: fakeIdentity, partners }) // `apiKeys` omitted
  const s = await serve(router)
  try {
    const res = await postApiKey(s.base, { 'x-api-key': 'partner-key' })
    assert.equal(res.status, 503)
  } finally { s.close() }
})
