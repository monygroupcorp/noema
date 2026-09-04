// =============================================================================
// The treasury persona works the B2B partner intake queue.
// =============================================================================
//
// `partnerAdminRouter` gates on one comparison — `auctor.animaId ===
// PLATFORM_ANIMA_ID` — and `partnerAdminRouter.test.ts` covers that gate against
// a FAKE identity that hands back whatever animaId the Bearer header names. That
// leaves the real question untested: can any credential a human can actually
// obtain resolve to that animaId? Until `seedPlatform` there was no `Anima` with
// that id at all, and no login pointed at it, so the answer was no — partner
// requests could be filed and never decided by anyone signing in through the
// product.
//
// This test walks the whole chain with the production pieces in between:
//   seedPlatform  →  the bind script's persona shape  →  mintSession
//     →  makeCredentialAcceptors.verifyJwt  →  IdentityResolver
//       →  GET/PATCH /v1/admin/partner-requests
//
// Only the two stores are doubles. If any link stops agreeing on the animaId —
// the seed's id, the session token's `typ:'session'` short-circuit, the gate's
// fallback literal — this fails.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import express from 'express'
import type { Db } from 'mongodb'
import { seedPlatform, PLATFORM_ANIMA_ID, PLATFORM_TREASURY_NOMEN } from '../../../src/crystal/seeds/platform.js'
import { makeCredentialAcceptors, type AcceptorDeps } from '../../../src/allocutio/api/apiAcceptors.js'
import { IdentityResolver } from '../../../src/allocutio/api/IdentityResolver.js'
import { mintSession } from '../../../src/crystal/sessionToken.js'
import { createPartnerAdminRouter } from '../../../src/api/partner/partnerAdminRouter.js'
import { createPartnerRequestRouter } from '../../../src/api/partner/partnerRequestRouter.js'
import { MemoryPartnerRequest } from '../../../src/crystal/MemoryPartnerRequest.js'
import { MemoryPartner } from '../../../src/crystal/MemoryPartner.js'

const JWT_SECRET = 'treasury-persona-test-secret'

// The address the bind script would be pointed at — lowercased, as it stores it.
const TREASURY_WALLET = '0xd5958561b9d77a4b7a12ef568b4b70efa4f9ee4e'
const OUTSIDER_WALLET = '0x1111111111111111111111111111111111111111'

// ── doubles ──────────────────────────────────────────────────────────────────

/** `animae`, backed by a map, with only the two seams used here: the raw-`Db`
 *  upsert `seedPlatform` writes through, and `AnimaStore.create` for minted souls. */
function fakeAnimae() {
  const rows = new Map<string, Record<string, unknown>>()
  let n = 0
  const db = {
    collection(name: string) {
      if (name !== 'animae') throw new Error(`fakeDb: unexpected collection ${name}`)
      return {
        async updateOne(filter: { id: string }, update: { $setOnInsert?: Record<string, unknown> }, opts?: { upsert?: boolean }) {
          if (!rows.has(filter.id) && opts?.upsert && update.$setOnInsert) rows.set(filter.id, update.$setOnInsert)
        },
      }
    },
  } as unknown as Db
  const store: AcceptorDeps['animae'] = {
    async create(input) {
      const id = `anima-${++n}`
      rows.set(id, { id, ...input })
      return { id, ...input } as never
    },
  }
  return { db, store, rows }
}

/** `personae` with the two seams the acceptors and the bind script use. */
function fakePersonae() {
  const byKey = new Map<string, { id: string; activeAnimaId: string }>()
  let n = 0
  const store: AcceptorDeps['personae'] = {
    async findByExternus(genus, ext) {
      return (byKey.get(`${genus}\0${ext}`) ?? null) as never
    },
    async findOrCreate(genus, ext, defaults) {
      const key = `${genus}\0${ext}`
      const existing = byKey.get(key)
      if (existing) return existing as never
      const p = { id: `persona-${++n}`, activeAnimaId: defaults!.animaId }
      byKey.set(key, p)
      return p as never
    },
  }
  return store
}

// ── harness ──────────────────────────────────────────────────────────────────

function makeServer(partnerRequests: MemoryPartnerRequest, partners: MemoryPartner, identity: IdentityResolver) {
  const app = express()
  app.use(express.json())
  app.use('/v1/partner-requests', createPartnerRequestRouter({ partnerRequests, identity }))
  app.use('/v1/admin/partner-requests', createPartnerAdminRouter({ partnerRequests, partners, identity }))
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

/** Everything wired the way `index.ts` wires it, plus the seeded treasury row. */
async function setup() {
  const animae = fakeAnimae()
  const personae = fakePersonae()
  await seedPlatform({ db: animae.db })
  const identity = new IdentityResolver(makeCredentialAcceptors({ personae, animae: animae.store, jwtSecret: JWT_SECRET }))
  return { animae, personae, identity, partnerRequests: new MemoryPartnerRequest(), partners: new MemoryPartner() }
}

/** Bind a wallet login to `animaId` exactly as `2026_09_01_bind_treasury_wallet.ts` does,
 *  then log in the way `POST /auth/wallet/recover` does: a session on `activeAnimaId`. */
async function signInAs(personae: AcceptorDeps['personae'], address: string, animaId: string): Promise<Record<string, string>> {
  const persona = await personae.findOrCreate('web', address, { animaId })
  return { authorization: `Bearer ${mintSession(persona.activeAnimaId, JWT_SECRET).token}` }
}

// ── the seed ─────────────────────────────────────────────────────────────────

test('seedPlatform creates the Anima the platform-admin gate compares against', async () => {
  const animae = fakeAnimae()
  await seedPlatform({ db: animae.db })

  const row = animae.rows.get(PLATFORM_ANIMA_ID)
  assert.ok(row, 'no Anima was seeded for the platform treasury')
  assert.equal(row!.id, PLATFORM_ANIMA_ID)
  assert.equal(row!.nomen, PLATFORM_TREASURY_NOMEN)
})

test('seedPlatform is idempotent and never clobbers an operator-edited row', async () => {
  const animae = fakeAnimae()
  await seedPlatform({ db: animae.db })
  // An operator renamed the treasury after the first boot.
  animae.rows.set(PLATFORM_ANIMA_ID, { ...animae.rows.get(PLATFORM_ANIMA_ID)!, nomen: 'House' })

  await seedPlatform({ db: animae.db })

  assert.equal(animae.rows.get(PLATFORM_ANIMA_ID)!.nomen, 'House', 'a later boot overwrote the row')
  assert.equal(animae.rows.size, 1, 'a second row was created for the same treasury')
})

// ── the persona reaches the gate ─────────────────────────────────────────────

test('a wallet bound to the treasury resolves, through the real acceptors, to the admin identity', async () => {
  const { personae, identity } = await setup()
  const headers = await signInAs(personae, TREASURY_WALLET, PLATFORM_ANIMA_ID)
  const auctor = await identity.resolve({ authorization: headers.authorization! })
  assert.deepEqual(auctor, { animaId: PLATFORM_ANIMA_ID })
})

// ── the whole intake round trip ──────────────────────────────────────────────

test('the treasury persona lists and approves a partner request, provisioning the Partner', async () => {
  const { personae, identity, partnerRequests, partners } = await setup()
  const { server, url } = await makeServer(partnerRequests, partners, identity)
  try {
    // An applicant signs in as their own soul and files an intake request, so the
    // request carries the animaId approval provisions against.
    const applicant = await signInAs(personae, OUTSIDER_WALLET, 'anima-applicant')
    const filed = await request('POST', `${url}/v1/partner-requests`, applicant, {
      contactEmail: 'partner@example.com',
      useCase: 'embed noema in our product',
      org: 'Example Co',
    })
    assert.equal(filed.status, 200)

    const treasury = await signInAs(personae, TREASURY_WALLET, PLATFORM_ANIMA_ID)

    const queue = await request('GET', `${url}/v1/admin/partner-requests?status=pending`, treasury)
    assert.equal(queue.status, 200, 'the treasury persona could not read the intake queue')
    assert.equal(queue.body.requests.length, 1)
    assert.equal(queue.body.requests[0].animaId, 'anima-applicant')

    const decided = await request('PATCH', `${url}/v1/admin/partner-requests/${filed.body.id}`, treasury, { status: 'approved' })
    assert.equal(decided.status, 200, 'the treasury persona could not decide a request')
    assert.equal(decided.body.request.status, 'approved')
    assert.equal(decided.body.request.decidedBy, PLATFORM_ANIMA_ID)
    assert.equal(decided.body.partner.animaId, 'anima-applicant')
    assert.equal((await partners.find('anima-applicant'))?.sourceRequestId, filed.body.id)
  } finally { await closeServer(server) }
})

test('a wallet bound to any other anima is still refused by the same surface', async () => {
  const { personae, identity, partnerRequests, partners } = await setup()
  const created = await partnerRequests.create({
    contactEmail: 'x@example.com', useCase: 'x', emailKey: 'email:x', animaId: 'anima-applicant',
  })
  const { server, url } = await makeServer(partnerRequests, partners, identity)
  try {
    const outsider = await signInAs(personae, OUTSIDER_WALLET, 'anima-outsider')

    const queue = await request('GET', `${url}/v1/admin/partner-requests`, outsider)
    assert.equal(queue.status, 403)
    assert.equal(queue.body.error.code, 'auth.forbidden')

    const decided = await request('PATCH', `${url}/v1/admin/partner-requests/${created.id}`, outsider, { status: 'approved' })
    assert.equal(decided.status, 403)
    assert.equal((await partnerRequests.find(created.id))?.status, 'pending')
    assert.equal(await partners.find('anima-applicant'), null)
  } finally { await closeServer(server) }
})
