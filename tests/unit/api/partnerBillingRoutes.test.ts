// =============================================================================
// The B2B partner surface, end to end over HTTP
// =============================================================================
//
// The five `/v1/me/partner/*` routes a customer drives itself, plus the admin billing desk,
// exercised against the real routers over a real socket. What they are here to hold:
//
//   · a key cannot be issued before the agreement is signed AND a billing account is on file,
//     and the refusal says which one is missing;
//   · a signature is an acceptance of a NAMED version, and a stale one is refused;
//   · the meter a customer reads is the one the invoice is drawn from;
//   · an invoice is the platform's to issue and the customer's to read and pay.
//
// Hermetic: Memory stores, a fake identity seam, no Mongo and no Stripe key.
// =============================================================================

import { test } from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import express from 'express'

import { createApiRouter, type ApiFacade, type Identity } from '../../../src/allocutio/api/apiRouter.js'
import { createPartnerBillingRouter } from '../../../src/api/partner/partnerBillingRouter.js'
import { Errors } from '../../../src/allocutio/api/errors.js'
import { MemoryPartner } from '../../../src/crystal/MemoryPartner.js'
import { MemoryPartnerContract } from '../../../src/crystal/MemoryPartnerContract.js'
import { MemoryPartnerUsage } from '../../../src/crystal/MemoryPartnerUsage.js'
import { MemoryPartnerInvoice } from '../../../src/crystal/MemoryPartnerInvoice.js'
import { PARTNER_CONTRACT_VERSION, PARTNER_CONTRACT_PATH } from '../../../src/crystal/partnerContract.js'
import { priceImpetus } from '../../../src/ledger/partnerInvoicing.js'
import type { Credentials } from '../../../src/allocutio/api/IdentityResolver.js'
import type { AuctorKey } from '../../../src/flow/types.js'
import type { Persona, PersonaGenus } from '../../../src/types/persona.js'
import type { ApiKeyEntry, ApiKeyUsersCollection } from '../../../src/crystal/apiKeys.js'

const PARTNER = 'anima-partner'
const STRANGER = 'anima-stranger'
const ADMIN = process.env.PLATFORM_ANIMA_ID ?? 'platform'

// ── fakes ────────────────────────────────────────────────────────────────────

const emptyApi = {} as unknown as ApiFacade

const identity: Identity = {
  async resolve(creds: Credentials): Promise<AuctorKey> {
    if (creds.apiKey === 'partner-key') return { animaId: PARTNER }
    if (creds.apiKey === 'stranger-key') return { animaId: STRANGER }
    if (creds.apiKey === 'admin-key') return { animaId: ADMIN }
    throw Errors.authMissing()
  },
  async resolveCaller(creds: Credentials) {
    return { auctor: await this.resolve(creds) }
  },
}

class FakeUsersCollection implements ApiKeyUsersCollection {
  docs = new Map<string, { _id: string; apiKeys: ApiKeyEntry[] }>()
  async findOne(filter: Record<string, unknown>) {
    if (filter._id !== undefined) return this.docs.get(String(filter._id)) ?? null
    const prefix = filter['apiKeys.keyPrefix']
    if (typeof prefix === 'string') {
      for (const doc of this.docs.values()) if (doc.apiKeys.some(k => k.keyPrefix === prefix)) return doc
    }
    return null
  }
  async updateOne(filter: Record<string, unknown>, update: Record<string, unknown>, options?: { upsert?: boolean; arrayFilters?: Record<string, unknown>[] }) {
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
    async findByExternus(genus: PersonaGenus, ext: string) { return byKey.get(`${genus}\0${ext}`) ?? null },
    async findOrCreate(genus: PersonaGenus, ext: string, defaults?: { animaId: string }) {
      const existing = byKey.get(`${genus}\0${ext}`)
      if (existing) return existing
      const p: Persona = {
        id: `persona-${byKey.size + 1}`, activeAnimaId: defaults!.animaId, animaIds: [defaults!.animaId],
        genus, externusId: ext, status: 'active', natum: new Date(), visum: new Date(),
      }
      byKey.set(`${genus}\0${ext}`, p)
      return p
    },
  }
}

/** A partner stack. `billing` seeds a billing account; `signed` a current-version signature;
 *  `api` replaces the facade for the one test that drives `POST /v1/runs`. */
async function stack(opts: { billing?: boolean; signed?: boolean; api?: ApiFacade; identity?: Identity } = {}) {
  const partners = new MemoryPartner()
  await partners.create({ animaId: PARTNER, sourceRequestId: 'req-1', org: 'Acme Studio' })
  if (opts.billing) {
    await partners.setBilling(PARTNER, { billingEmail: 'ap@acme.example', billedTo: 'Acme Studio Ltd', netDays: 30, setAt: new Date() })
  }
  const contracts = new MemoryPartnerContract()
  if (opts.signed) await contracts.sign({ animaId: PARTNER, version: PARTNER_CONTRACT_VERSION, signerName: 'A. Signer' })
  const usage = new MemoryPartnerUsage()
  const invoices = new MemoryPartnerInvoice()
  const usersCol = new FakeUsersCollection()

  const app = express()
  app.use(express.json())
  const seam = opts.identity ?? identity
  app.use('/v1', createApiRouter({
    api: opts.api ?? emptyApi,
    identity: seam,
    partners,
    partnerContracts: contracts,
    partnerUsage: usage,
    partnerInvoices: invoices,
    apiKeys: { personae: fakePersonae(), usersCol, partners, contracts },
  }))
  app.use('/v1/admin/partner-billing', createPartnerBillingRouter({ partners, usage, invoices, identity: seam }))

  const server = app.listen(0)
  await new Promise(r => server.once('listening', r))
  const addr = server.address()
  const base = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`
  return { partners, contracts, usage, invoices, usersCol, base, close: () => server.close() }
}

function call(base: string, method: string, path: string, opts: { key?: string; body?: unknown } = {}): Promise<{ status: number; body: any }> {
  return new Promise((resolve, reject) => {
    const payload = opts.body === undefined ? undefined : JSON.stringify(opts.body)
    const req = http.request(`${base}${path}`, {
      method,
      headers: {
        ...(opts.key ? { 'x-api-key': opts.key } : {}),
        ...(payload ? { 'content-type': 'application/json', 'content-length': String(Buffer.byteLength(payload)) } : {}),
      },
    }, res => {
      let data = ''
      res.on('data', c => (data += c))
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body: data ? JSON.parse(data) : undefined }))
    })
    req.on('error', reject)
    if (payload) req.write(payload)
    req.end()
  })
}

// ── the contract ─────────────────────────────────────────────────────────────

test('GET /me/partner/contract: names the current version and where to read it', async () => {
  const s = await stack()
  try {
    const res = await call(s.base, 'GET', '/v1/me/partner/contract', { key: 'partner-key' })
    assert.equal(res.status, 200)
    assert.equal(res.body.version, PARTNER_CONTRACT_VERSION)
    assert.equal(res.body.path, PARTNER_CONTRACT_PATH)
    assert.equal(res.body.signed, false)
    assert.deepEqual(res.body.signedVersions, [])
  } finally { s.close() }
})

test('POST /me/partner/contract: signing the current version records who signed, and when', async () => {
  const s = await stack()
  try {
    const signed = await call(s.base, 'POST', '/v1/me/partner/contract', {
      key: 'partner-key',
      body: { version: PARTNER_CONTRACT_VERSION, signerName: '  Dana Reyes  ', signerTitle: 'COO' },
    })
    assert.equal(signed.status, 200)
    assert.equal(signed.body.signerName, 'Dana Reyes', 'trimmed')
    assert.equal(signed.body.signerTitle, 'COO')

    const after = await call(s.base, 'GET', '/v1/me/partner/contract', { key: 'partner-key' })
    assert.equal(after.body.signed, true)
    assert.deepEqual(after.body.signedVersions, [PARTNER_CONTRACT_VERSION])
  } finally { s.close() }
})

test('POST /me/partner/contract: a signature on a version the client did not name is refused', async () => {
  const s = await stack()
  try {
    const stale = await call(s.base, 'POST', '/v1/me/partner/contract', {
      key: 'partner-key',
      body: { version: 'api-1999-01-01', signerName: 'Dana Reyes' },
    })
    assert.equal(stale.status, 400)
    assert.match(stale.body.error.message, new RegExp(PARTNER_CONTRACT_VERSION))

    const none = await call(s.base, 'POST', '/v1/me/partner/contract', { key: 'partner-key', body: { version: PARTNER_CONTRACT_VERSION } })
    assert.equal(none.status, 400, 'and a signature with no signer is not a signature')

    const after = await call(s.base, 'GET', '/v1/me/partner/contract', { key: 'partner-key' })
    assert.equal(after.body.signed, false)
  } finally { s.close() }
})

test('the partner surface is closed to everyone who is not an active partner', async () => {
  const s = await stack({ billing: true, signed: true })
  try {
    for (const [method, path] of [
      ['GET', '/v1/me/partner/contract'],
      ['GET', '/v1/me/partner/usage?from=2026-09-01T00:00:00Z&to=2026-10-01T00:00:00Z'],
      ['GET', '/v1/me/partner/invoices'],
    ] as Array<[string, string]>) {
      const res = await call(s.base, method, path, { key: 'stranger-key' })
      assert.equal(res.status, 404, `${method} ${path}`)
      assert.equal(res.body.error.code, 'not_found.partner')
    }
    const anon = await call(s.base, 'GET', '/v1/me/partner/contract')
    assert.equal(anon.status, 401, 'and identity resolves before any store is read')
  } finally { s.close() }
})

// ── the key gate, over HTTP ──────────────────────────────────────────────────

test('POST /me/partner/api-key: refused, naming the agreement, until it is signed', async () => {
  const s = await stack({ billing: true })
  try {
    const res = await call(s.base, 'POST', '/v1/me/partner/api-key', { key: 'partner-key' })
    assert.equal(res.status, 422)
    assert.equal(res.body.error.code, 'partner.contract_unsigned')
    assert.equal(res.body.error.details.version, PARTNER_CONTRACT_VERSION, 'the client can link straight to what needs signing')
    assert.equal(s.usersCol.docs.size, 0, 'no key was minted')
  } finally { s.close() }
})

test('POST /me/partner/api-key: refused, naming the billing account, until one is on file', async () => {
  const s = await stack({ signed: true })
  try {
    const res = await call(s.base, 'POST', '/v1/me/partner/api-key', { key: 'partner-key' })
    assert.equal(res.status, 422)
    assert.equal(res.body.error.code, 'partner.billing_required')
    assert.equal(s.usersCol.docs.size, 0)
  } finally { s.close() }
})

test('sign, set billing, then mint — the whole path a customer walks', async () => {
  const s = await stack()
  try {
    assert.equal((await call(s.base, 'POST', '/v1/me/partner/api-key', { key: 'partner-key' })).status, 422)

    await call(s.base, 'POST', '/v1/me/partner/contract', { key: 'partner-key', body: { version: PARTNER_CONTRACT_VERSION, signerName: 'Dana Reyes' } })
    const billing = await call(s.base, 'PUT', '/v1/me/partner/billing', {
      key: 'partner-key',
      body: { billingEmail: 'ap@acme.example', billedTo: 'Acme Studio Ltd', netDays: 30 },
    })
    assert.equal(billing.status, 200)
    assert.equal(billing.body.billing.billedTo, 'Acme Studio Ltd')

    const key = await call(s.base, 'POST', '/v1/me/partner/api-key', { key: 'partner-key' })
    assert.equal(key.status, 200)
    assert.match(key.body.apiKey, /^ms2_[0-9a-f]{48}$/)
    assert.equal(
      s.usersCol.docs.get(PARTNER)?.apiKeys[0]?.contractVersion,
      PARTNER_CONTRACT_VERSION,
      'the key carries the version it was issued under',
    )
  } finally { s.close() }
})

test('PUT /me/partner/billing: refuses a malformed account rather than storing half of one', async () => {
  const s = await stack()
  try {
    for (const body of [
      { billingEmail: 'not-an-email', billedTo: 'Acme', netDays: 30 },
      { billingEmail: 'ap@acme.example', billedTo: '   ', netDays: 30 },
      { billingEmail: 'ap@acme.example', billedTo: 'Acme', netDays: -1 },
      { billingEmail: 'ap@acme.example', billedTo: 'Acme', netDays: 1000 },
      { billingEmail: 'ap@acme.example', billedTo: 'Acme', netDays: 30.5 },
    ]) {
      const res = await call(s.base, 'PUT', '/v1/me/partner/billing', { key: 'partner-key', body })
      assert.equal(res.status, 400, JSON.stringify(body))
    }
    assert.equal((await s.partners.find(PARTNER))?.billing, undefined, 'nothing was stored')
  } finally { s.close() }
})

// ── the meter and the invoice ────────────────────────────────────────────────

/** Three settled calls in September, against one flow. */
async function meterSeptember(usage: MemoryPartnerUsage) {
  for (let i = 0; i < 3; i++) {
    await usage.record({ actumId: `actum-${i}`, animaId: PARTNER, keyPrefix: 'ms2_aaaabbbb', modusId: 'flux-schnell', calledAt: new Date('2026-09-10T00:00:00Z') })
    await usage.settle(`actum-${i}`, { settledAt: new Date('2026-09-10T00:05:00Z'), impetus: '900', modusLabel: 'FLUX Schnell', models: ['intella-unet'] })
  }
}

test('GET /me/partner/usage: the customer reads the rows the invoice is drawn from', async () => {
  const s = await stack({ billing: true, signed: true })
  try {
    await meterSeptember(s.usage)
    const res = await call(s.base, 'GET', '/v1/me/partner/usage?from=2026-09-01T00:00:00Z&to=2026-10-01T00:00:00Z', { key: 'partner-key' })
    assert.equal(res.status, 200)
    assert.equal(res.body.rollup.calls, 3)
    assert.equal(res.body.rollup.impetus, '2700')
    assert.equal(res.body.calls.length, 3)
    assert.equal(res.body.calls[0].keyPrefix, 'ms2_aaaabbbb', 'counted against the key')
    assert.deepEqual(res.body.calls[0].models, ['intella-unet'])
  } finally { s.close() }
})

test('GET /me/partner/usage: both window bounds are required and must be ordered', async () => {
  const s = await stack({ billing: true, signed: true })
  try {
    for (const q of ['', '?from=2026-09-01T00:00:00Z', '?to=2026-10-01T00:00:00Z', '?from=nonsense&to=2026-10-01T00:00:00Z', '?from=2026-10-01T00:00:00Z&to=2026-09-01T00:00:00Z']) {
      assert.equal((await call(s.base, 'GET', `/v1/me/partner/usage${q}`, { key: 'partner-key' })).status, 400, q)
    }
  } finally { s.close() }
})

test('the admin issues the invoice; the customer reads it back', async () => {
  const s = await stack({ billing: true, signed: true })
  try {
    await meterSeptember(s.usage)

    const preview = await call(s.base, 'GET', `/v1/admin/partner-billing/${PARTNER}/usage?from=2026-09-01T00:00:00Z&to=2026-10-01T00:00:00Z`, { key: 'admin-key' })
    assert.equal(preview.status, 200)
    assert.equal(preview.body.rollup.impetus, '2700')

    const issued = await call(s.base, 'POST', `/v1/admin/partner-billing/${PARTNER}/invoices`, {
      key: 'admin-key',
      body: { from: '2026-09-01T00:00:00Z', to: '2026-10-01T00:00:00Z' },
    })
    assert.equal(issued.status, 200)
    assert.equal(issued.body.invoice.usdMicro, priceImpetus(2700n).toString())
    assert.equal(issued.body.invoice.billedTo, 'Acme Studio Ltd')

    const mine = await call(s.base, 'GET', '/v1/me/partner/invoices', { key: 'partner-key' })
    assert.equal(mine.status, 200)
    assert.equal(mine.body.invoices.length, 1)
    assert.equal(mine.body.invoices[0].id, issued.body.invoice.id)
    assert.equal(mine.body.invoices[0].status, 'open')
  } finally { s.close() }
})

test('issuing is admin-only, and a period is billed once', async () => {
  const s = await stack({ billing: true, signed: true })
  try {
    await meterSeptember(s.usage)
    const body = { from: '2026-09-01T00:00:00Z', to: '2026-10-01T00:00:00Z' }

    const asPartner = await call(s.base, 'POST', `/v1/admin/partner-billing/${PARTNER}/invoices`, { key: 'partner-key', body })
    assert.equal(asPartner.status, 403, 'a customer cannot issue its own bill')

    assert.equal((await call(s.base, 'POST', `/v1/admin/partner-billing/${PARTNER}/invoices`, { key: 'admin-key', body })).status, 200)
    const again = await call(s.base, 'POST', `/v1/admin/partner-billing/${PARTNER}/invoices`, { key: 'admin-key', body })
    assert.equal(again.status, 409)
    assert.equal(again.body.error.code, 'conflict.period_already_billed')
  } finally { s.close() }
})

test('a partner with no billing account cannot be invoiced', async () => {
  const s = await stack({ signed: true })
  try {
    const res = await call(s.base, 'POST', `/v1/admin/partner-billing/${PARTNER}/invoices`, {
      key: 'admin-key',
      body: { from: '2026-09-01T00:00:00Z', to: '2026-10-01T00:00:00Z' },
    })
    assert.equal(res.status, 422)
    assert.equal(res.body.error.code, 'partner.billing_required')
  } finally { s.close() }
})

test("one customer cannot pay, or even see, another's invoice", async () => {
  const s = await stack({ billing: true, signed: true })
  try {
    await meterSeptember(s.usage)
    const issued = await call(s.base, 'POST', `/v1/admin/partner-billing/${PARTNER}/invoices`, {
      key: 'admin-key',
      body: { from: '2026-09-01T00:00:00Z', to: '2026-10-01T00:00:00Z' },
    })
    const id = issued.body.invoice.id

    const res = await call(s.base, 'POST', `/v1/me/partner/invoices/${id}/checkout`, { key: 'stranger-key' })
    assert.equal(res.status, 404, 'a stranger is not a partner at all')

    // And an id that exists but is not the caller's reads as missing, not as forbidden — an
    // invoice id must not confirm another customer's billing exists.
    await s.partners.create({ animaId: STRANGER, sourceRequestId: 'req-2' })
    const asOtherPartner = await call(s.base, 'POST', `/v1/me/partner/invoices/${id}/checkout`, { key: 'stranger-key' })
    assert.equal(asOtherPartner.status, 404)
    assert.equal(asOtherPartner.body.error.code, 'not_found.partner_invoice')
  } finally { s.close() }
})

// ── the meter's FIRST half: POST /v1/runs counts the call against the key ─────

/** An identity seam whose API key resolves WITH its stored prefix — what the real acceptor
 *  returns for a partner key, and the only thing that tells the run route which key called. */
function keyedIdentity(keyPrefix?: string): Identity {
  return {
    async resolve(creds: Credentials): Promise<AuctorKey> {
      if (creds.apiKey === 'partner-key') return { animaId: PARTNER }
      if (creds.authorization) return { animaId: PARTNER }
      throw Errors.authMissing()
    },
    async resolveCaller(creds: Credentials) {
      const auctor = await this.resolve(creds)
      // A Bearer session carries no key, so it carries no prefix — the same shape every
      // non-API-key credential resolves to.
      return creds.apiKey && keyPrefix ? { auctor, keyPrefix } : { auctor }
    },
  }
}

const runningApi = (modusId: string) => ({
  async invokeFlow() {
    return { id: 'actum-run-1', status: 'nascens', modusId }
  },
}) as unknown as ApiFacade

test('POST /v1/runs: a partner-key call opens a meter row against that key', async () => {
  const s = await stack({ billing: true, signed: true, api: runningApi('flux-schnell'), identity: keyedIdentity('ms2_aaaabbbb') })
  try {
    const res = await call(s.base, 'POST', '/v1/runs', { key: 'partner-key', body: { modusId: 'flux-schnell', aditus: {} } })
    assert.equal(res.status, 200)

    const rows = await s.usage.list(PARTNER, new Date('2000-01-01'), new Date('2100-01-01'))
    assert.equal(rows.length, 1)
    assert.equal(rows[0].actumId, 'actum-run-1')
    assert.equal(rows[0].keyPrefix, 'ms2_aaaabbbb')
    assert.equal(rows[0].modusId, 'flux-schnell')
    assert.equal(rows[0].settledAt, undefined, 'the units are the completion webhook half')
  } finally { s.close() }
})

test('POST /v1/runs: a call made on a session token is not metered — the B2B meter is per key', async () => {
  const s = await stack({ billing: true, signed: true, api: runningApi('flux-schnell'), identity: keyedIdentity() })
  try {
    const res = await call(s.base, 'POST', '/v1/runs', { key: 'partner-key', body: { modusId: 'flux-schnell', aditus: {} } })
    assert.equal(res.status, 200, 'the run is admitted exactly as it would be')
    assert.deepEqual(await s.usage.list(PARTNER, new Date('2000-01-01'), new Date('2100-01-01')), [])
  } finally { s.close() }
})
