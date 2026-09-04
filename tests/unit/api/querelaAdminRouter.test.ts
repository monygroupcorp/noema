// querelaAdminRouter — GET/PATCH /v1/admin/reports. Pure unit test (fake
// in-memory store, no live Mongo): the platform-admin gate refuses a non-admin
// with the same error shape other admin routes use, an admin can list reports
// across every owner (not just one owner's — that's `findByOwner`), the kind/
// status filters narrow the list, and PATCH updates status via the existing
// `update()` and the change is reflected in a subsequent list call.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import express from 'express'
import { createQuerelaAdminRouter } from '../../../src/api/querela/querelaAdminRouter.js'
import type { Querela, QuerelaStore } from '../../../src/types/Querela.js'
import type { AuctorKey } from '../../../src/flow/types.js'
import type { Credentials } from '../../../src/allocutio/api/IdentityResolver.js'
import { Errors } from '../../../src/allocutio/api/errors.js'

const PLATFORM_ANIMA_ID = 'platform'

class MemoryQuerela implements QuerelaStore {
  records: Querela[] = []
  async create(input: Omit<Querela, 'id' | 'natum' | 'mutatum'>): Promise<Querela> {
    const now = new Date()
    const q: Querela = { ...input, id: `q-${this.records.length + 1}`, natum: now, mutatum: now }
    this.records.push(q)
    return q
  }
  async find(id: string): Promise<Querela | null> {
    return this.records.find(q => q.id === id) ?? null
  }
  async findByOwner(ownerKey: string, status?: 'new' | 'closed'): Promise<Querela[]> {
    return this.records.filter(q => q.ownerKey === ownerKey && (status === undefined || q.status === status))
  }
  async update(id: string, patch: Partial<Pick<Querela, 'status'>>): Promise<Querela> {
    const q = this.records.find(r => r.id === id)
    if (!q) throw new Error('not found')
    Object.assign(q, patch, { mutatum: new Date() })
    return q
  }
  async findByOwnerAndHash(ownerKey: string, contentHash: string): Promise<Querela | null> {
    return this.records.find(q => q.ownerKey === ownerKey && q.contentHash === contentHash) ?? null
  }
  async list(filter?: { kind?: Querela['kind']; status?: Querela['status'] }): Promise<Querela[]> {
    return this.records.filter(q =>
      (filter?.kind === undefined || q.kind === filter.kind) &&
      (filter?.status === undefined || q.status === filter.status),
    )
  }
}

function makeQuerela(overrides: Partial<Omit<Querela, 'id' | 'natum' | 'mutatum'>> = {}): Omit<Querela, 'id' | 'natum' | 'mutatum'> {
  return {
    ownerKey: 'anima:owner-1',
    kind: 'bug',
    status: 'new',
    description: 'the button does nothing',
    contentHash: `hash-${Math.random()}`,
    ...overrides,
  }
}

// Mirrors the real IdentityResolver's contract (src/allocutio/api/IdentityResolver.ts):
// a missing/unresolvable credential throws an ApiError, never a plain Error, so this
// router's `resolveAdmin` — which lets `identity.resolve`'s own ApiError propagate
// unchanged rather than remapping it — sees the same shape it would in production.
const fakeIdentity = {
  async resolve(creds: Credentials): Promise<AuctorKey> {
    if (creds.authorization?.startsWith('Bearer ')) return { animaId: creds.authorization.slice('Bearer '.length) }
    if (creds.commitment) return { commitment: creds.commitment }
    throw Errors.authMissing()
  },
}

function makeServer(querelae: QuerelaStore) {
  const app = express()
  app.use(express.json())
  app.use('/v1/admin/reports', createQuerelaAdminRouter({ querelae, identity: fakeIdentity }))
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

function request(
  method: string,
  url: string,
  headers: Record<string, string>,
  body?: unknown,
): Promise<{ status: number; body: any }> {
  return new Promise((resolvePromise, reject) => {
    const payload = body !== undefined ? JSON.stringify(body) : undefined
    const u = new URL(url)
    const req = http.request(
      {
        method,
        hostname: u.hostname,
        port: u.port,
        path: u.pathname + u.search,
        headers: { ...headers, ...(payload !== undefined ? { 'content-type': 'application/json' } : {}) },
      },
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

// ---------------------------------------------------------------------------
// (b) the platform-admin gate — same error shape other admin routes use
// ---------------------------------------------------------------------------

test('GET /v1/admin/reports refuses a non-admin identity with 403 auth.forbidden', async () => {
  const store = new MemoryQuerela()
  await store.create(makeQuerela())
  const { server, url } = await makeServer(store)
  try {
    const res = await request('GET', `${url}/v1/admin/reports`, NON_ADMIN_HEADERS)
    assert.equal(res.status, 403)
    assert.equal(res.body.error.code, 'auth.forbidden')
  } finally { await closeServer(server) }
})

test('GET /v1/admin/reports refuses an unresolvable identity with 401', async () => {
  const store = new MemoryQuerela()
  const { server, url } = await makeServer(store)
  try {
    const res = await request('GET', `${url}/v1/admin/reports`, {})
    assert.equal(res.status, 401)
  } finally { await closeServer(server) }
})

test('PATCH /v1/admin/reports/:id refuses a non-admin identity and writes nothing', async () => {
  const store = new MemoryQuerela()
  const created = await store.create(makeQuerela())
  const { server, url } = await makeServer(store)
  try {
    const res = await request('PATCH', `${url}/v1/admin/reports/${created.id}`, NON_ADMIN_HEADERS, { status: 'closed' })
    assert.equal(res.status, 403)
    assert.equal(res.body.error.code, 'auth.forbidden')
    assert.equal((await store.find(created.id))?.status, 'new')
  } finally { await closeServer(server) }
})

// ---------------------------------------------------------------------------
// (a) list across different owners
// ---------------------------------------------------------------------------

test('GET /v1/admin/reports returns reports submitted by different owners', async () => {
  const store = new MemoryQuerela()
  await store.create(makeQuerela({ ownerKey: 'anima:owner-1' }))
  await store.create(makeQuerela({ ownerKey: 'commitment:owner-2' }))
  await store.create(makeQuerela({ ownerKey: 'bursa:owner-3' }))
  const { server, url } = await makeServer(store)
  try {
    const res = await request('GET', `${url}/v1/admin/reports`, ADMIN_HEADERS)
    assert.equal(res.status, 200)
    assert.equal(res.body.reports.length, 3)
    assert.deepEqual(
      res.body.reports.map((r: Querela) => r.ownerKey).sort(),
      ['anima:owner-1', 'bursa:owner-3', 'commitment:owner-2'],
    )
  } finally { await closeServer(server) }
})

// ---------------------------------------------------------------------------
// (d) filters narrow results
// ---------------------------------------------------------------------------

test('GET /v1/admin/reports?kind= narrows to that kind', async () => {
  const store = new MemoryQuerela()
  await store.create(makeQuerela({ kind: 'bug' }))
  await store.create(makeQuerela({ kind: 'feature', feature: 'dark mode' }))
  await store.create(makeQuerela({ kind: 'feedback' }))
  const { server, url } = await makeServer(store)
  try {
    const res = await request('GET', `${url}/v1/admin/reports?kind=feature`, ADMIN_HEADERS)
    assert.equal(res.status, 200)
    assert.equal(res.body.reports.length, 1)
    assert.equal(res.body.reports[0].kind, 'feature')
  } finally { await closeServer(server) }
})

test('GET /v1/admin/reports?status= narrows to that status', async () => {
  const store = new MemoryQuerela()
  const closed = await store.create(makeQuerela())
  await store.update(closed.id, { status: 'closed' })
  await store.create(makeQuerela())
  const { server, url } = await makeServer(store)
  try {
    const res = await request('GET', `${url}/v1/admin/reports?status=closed`, ADMIN_HEADERS)
    assert.equal(res.status, 200)
    assert.equal(res.body.reports.length, 1)
    assert.equal(res.body.reports[0].id, closed.id)
  } finally { await closeServer(server) }
})

test('GET /v1/admin/reports?kind= and ?status= combine', async () => {
  const store = new MemoryQuerela()
  const target = await store.create(makeQuerela({ kind: 'bug', status: 'new' }))
  await store.update(target.id, { status: 'closed' })
  await store.create(makeQuerela({ kind: 'bug', status: 'new' }))
  await store.create(makeQuerela({ kind: 'feedback', status: 'new' }))
  const closedFeedback = await store.create(makeQuerela({ kind: 'feedback', status: 'new' }))
  await store.update(closedFeedback.id, { status: 'closed' })
  const { server, url } = await makeServer(store)
  try {
    const res = await request('GET', `${url}/v1/admin/reports?kind=bug&status=closed`, ADMIN_HEADERS)
    assert.equal(res.status, 200)
    assert.equal(res.body.reports.length, 1)
    assert.equal(res.body.reports[0].id, target.id)
  } finally { await closeServer(server) }
})

test('GET /v1/admin/reports rejects an unknown kind with 400', async () => {
  const store = new MemoryQuerela()
  const { server, url } = await makeServer(store)
  try {
    const res = await request('GET', `${url}/v1/admin/reports?kind=nonsense`, ADMIN_HEADERS)
    assert.equal(res.status, 400)
  } finally { await closeServer(server) }
})

// ---------------------------------------------------------------------------
// (c) PATCH updates status via update(), reflected in a subsequent list call
// ---------------------------------------------------------------------------

test('PATCH /v1/admin/reports/:id closes a report via the existing update(), reflected in a later list', async () => {
  const store = new MemoryQuerela()
  const created = await store.create(makeQuerela({ status: 'new' }))
  const { server, url } = await makeServer(store)
  try {
    const patchRes = await request('PATCH', `${url}/v1/admin/reports/${created.id}`, ADMIN_HEADERS, { status: 'closed' })
    assert.equal(patchRes.status, 200)
    assert.equal(patchRes.body.report.status, 'closed')
    assert.equal(patchRes.body.report.id, created.id)

    const listRes = await request('GET', `${url}/v1/admin/reports`, ADMIN_HEADERS)
    assert.equal(listRes.body.reports.find((r: Querela) => r.id === created.id)?.status, 'closed')
  } finally { await closeServer(server) }
})

test('PATCH /v1/admin/reports/:id rejects an invalid status with 400', async () => {
  const store = new MemoryQuerela()
  const created = await store.create(makeQuerela())
  const { server, url } = await makeServer(store)
  try {
    const res = await request('PATCH', `${url}/v1/admin/reports/${created.id}`, ADMIN_HEADERS, { status: 'archived' })
    assert.equal(res.status, 400)
  } finally { await closeServer(server) }
})

test('PATCH /v1/admin/reports/:id on an unknown id returns 404 not_found.querela', async () => {
  const store = new MemoryQuerela()
  const { server, url } = await makeServer(store)
  try {
    const res = await request('PATCH', `${url}/v1/admin/reports/nope`, ADMIN_HEADERS, { status: 'closed' })
    assert.equal(res.status, 404)
    assert.equal(res.body.error.code, 'not_found.querela')
  } finally { await closeServer(server) }
})
