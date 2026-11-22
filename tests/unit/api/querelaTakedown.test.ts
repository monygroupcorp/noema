// PATCH /v1/admin/reports/:id — the takedown wiring (minimax-h3-violation-takedown): a
// `verdict:'violation'` PATCH on an abuse report calls the injected `takedownRun(auctor, runId)`
// and folds its result onto the response as `takedown`, so an admin sees what the verdict
// actually pulled down — not just that a strike was recorded. A `dismissed` verdict, a
// status-only PATCH, and a non-abuse report must never call it: the output stays exactly where
// it was unless a violation is confirmed.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import express from 'express'
import { createQuerelaAdminRouter, type QuerelaTakedownResult } from '../../../src/api/querela/querelaAdminRouter.js'
import type { Querela, QuerelaStore } from '../../../src/types/Querela.js'
import type { AuctorKey } from '../../../src/flow/types.js'
import type { Credentials } from '../../../src/allocutio/api/IdentityResolver.js'

const PLATFORM_ANIMA_ID = 'platform'

class MemoryQuerela implements QuerelaStore {
  records: Querela[] = []
  async create(input: Omit<Querela, 'id' | 'natum' | 'mutatum'>): Promise<Querela> {
    const now = new Date()
    const q: Querela = { ...input, id: `q-${this.records.length + 1}`, natum: now, mutatum: now }
    this.records.push(q)
    return q
  }
  async find(id: string): Promise<Querela | null> { return this.records.find(q => q.id === id) ?? null }
  async findByOwner(ownerKey: string): Promise<Querela[]> { return this.records.filter(q => q.ownerKey === ownerKey) }
  async update(id: string, patch: Partial<Pick<Querela, 'status' | 'verdict'>>): Promise<Querela> {
    const q = this.records.find(r => r.id === id)
    if (!q) throw new Error('not found')
    Object.assign(q, patch, { mutatum: new Date() })
    return q
  }
  async findByOwnerAndHash(ownerKey: string, contentHash: string): Promise<Querela | null> {
    return this.records.find(q => q.ownerKey === ownerKey && q.contentHash === contentHash) ?? null
  }
  async list(): Promise<Querela[]> { return [...this.records] }
  async countViolations(): Promise<number> { return 0 }
}

function makeAbuseReport(overrides: Partial<Omit<Querela, 'id' | 'natum' | 'mutatum'>> = {}): Omit<Querela, 'id' | 'natum' | 'mutatum'> {
  return {
    ownerKey: 'commitment:reporter-1',
    kind: 'abuse',
    status: 'new',
    description: 'this output breaks the licence terms',
    contentHash: `hash-${Math.random()}`,
    subjectOwnerKey: 'anima:offender',
    useTerms: ['minimax-h3'],
    capturedState: { runId: 'act-reported' },
    verdict: null,
    ...overrides,
  }
}

const fakeIdentity = {
  async resolve(creds: Credentials): Promise<AuctorKey> {
    if (creds.authorization?.startsWith('Bearer ')) return { animaId: creds.authorization.slice('Bearer '.length) }
    throw new Error('auth.missing')
  },
}

function makeServer(querelae: QuerelaStore, takedownRun?: (auctor: AuctorKey, runId: string) => Promise<QuerelaTakedownResult>) {
  const app = express()
  app.use(express.json())
  app.use('/v1/admin/reports', createQuerelaAdminRouter({ querelae, identity: fakeIdentity, takedownRun }))
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

function patch(url: string, body: unknown): Promise<{ status: number; body: any }> {
  return new Promise((resolvePromise, reject) => {
    const payload = JSON.stringify(body)
    const u = new URL(url)
    const req = http.request(
      { method: 'PATCH', hostname: u.hostname, port: u.port, path: u.pathname, headers: { authorization: `Bearer ${PLATFORM_ANIMA_ID}`, 'content-type': 'application/json' } },
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
    req.write(payload)
    req.end()
  })
}

test('PATCH verdict:violation calls takedownRun(admin, runId) and folds the result into the response', async () => {
  const store = new MemoryQuerela()
  const created = await store.create(makeAbuseReport())
  const calls: Array<{ auctor: AuctorKey; runId: string }> = []
  const takedownRun = async (auctor: AuctorKey, runId: string): Promise<QuerelaTakedownResult> => {
    calls.push({ auctor, runId })
    return { retracted: ['ed-1'], skipped: [], privatizedVestigia: ['v-1'] }
  }
  const { server, url } = await makeServer(store, takedownRun)
  try {
    const res = await patch(`${url}/v1/admin/reports/${created.id}`, { verdict: 'violation' })
    assert.equal(res.status, 200)
    assert.equal(res.body.report.verdict, 'violation')
    assert.deepEqual(res.body.takedown, { retracted: ['ed-1'], skipped: [], privatizedVestigia: ['v-1'] })
    assert.deepEqual(calls, [{ auctor: { animaId: PLATFORM_ANIMA_ID }, runId: 'act-reported' }])
  } finally { await closeServer(server) }
})

test('PATCH verdict:dismissed never calls takedownRun — the output stays exactly where it was', async () => {
  const store = new MemoryQuerela()
  const created = await store.create(makeAbuseReport())
  let called = false
  const takedownRun = async (): Promise<QuerelaTakedownResult> => { called = true; return { retracted: [], skipped: [], privatizedVestigia: [] } }
  const { server, url } = await makeServer(store, takedownRun)
  try {
    const res = await patch(`${url}/v1/admin/reports/${created.id}`, { verdict: 'dismissed' })
    assert.equal(res.status, 200)
    assert.equal(res.body.takedown, undefined)
    assert.equal(called, false)
  } finally { await closeServer(server) }
})

test('PATCH status-only (no verdict) never calls takedownRun', async () => {
  const store = new MemoryQuerela()
  const created = await store.create(makeAbuseReport())
  let called = false
  const takedownRun = async (): Promise<QuerelaTakedownResult> => { called = true; return { retracted: [], skipped: [], privatizedVestigia: [] } }
  const { server, url } = await makeServer(store, takedownRun)
  try {
    const res = await patch(`${url}/v1/admin/reports/${created.id}`, { status: 'closed' })
    assert.equal(res.status, 200)
    assert.equal(res.body.takedown, undefined)
    assert.equal(called, false)
  } finally { await closeServer(server) }
})

test('PATCH verdict:violation with no takedownRun configured still records the verdict, and reports the gap rather than failing', async () => {
  const store = new MemoryQuerela()
  const created = await store.create(makeAbuseReport())
  const { server, url } = await makeServer(store, undefined)
  try {
    const res = await patch(`${url}/v1/admin/reports/${created.id}`, { verdict: 'violation' })
    assert.equal(res.status, 200)
    assert.equal(res.body.report.verdict, 'violation', 'the verdict/strike still records')
    assert.equal(typeof res.body.takedown?.error, 'string')
  } finally { await closeServer(server) }
})

test('PATCH verdict:violation whose takedownRun throws still records the verdict, with the error surfaced', async () => {
  const store = new MemoryQuerela()
  const created = await store.create(makeAbuseReport())
  const takedownRun = async (): Promise<QuerelaTakedownResult> => { throw new Error('editions store unreachable') }
  const { server, url } = await makeServer(store, takedownRun)
  try {
    const res = await patch(`${url}/v1/admin/reports/${created.id}`, { verdict: 'violation' })
    assert.equal(res.status, 200)
    assert.equal(res.body.report.verdict, 'violation')
    assert.equal(res.body.takedown.error, 'editions store unreachable')
  } finally { await closeServer(server) }
})

test('PATCH verdict:violation on a report with no captured runId skips takedownRun and reports why', async () => {
  const store = new MemoryQuerela()
  const created = await store.create(makeAbuseReport({ capturedState: null }))
  let called = false
  const takedownRun = async (): Promise<QuerelaTakedownResult> => { called = true; return { retracted: [], skipped: [], privatizedVestigia: [] } }
  const { server, url } = await makeServer(store, takedownRun)
  try {
    const res = await patch(`${url}/v1/admin/reports/${created.id}`, { verdict: 'violation' })
    assert.equal(res.status, 200)
    assert.equal(called, false)
    assert.equal(typeof res.body.takedown?.error, 'string')
  } finally { await closeServer(server) }
})
