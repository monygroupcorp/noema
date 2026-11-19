// Abuse reports — the reporting mechanism and repeat-violator suspension MiniMax H3's licence
// (Section V.5) requires. Pure unit test over both report routers (in-memory store, no Mongo):
//   - anyone can report a run; the report's subject is the run's OWNER, read from the run,
//     never from the body;
//   - an admin verdict of `violation` is a strike against that owner, counted once per run;
//   - at the strike limit the owner reads as suspended under the run's terms, which is the same
//     count the run entry point refuses on (useTermsGate.test.ts).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import express from 'express'
import { createQuerelaRouter } from '../../../src/api/querela/querelaRouter.js'
import { createQuerelaAdminRouter } from '../../../src/api/querela/querelaAdminRouter.js'
import { ownerKeyOf } from '../../../src/crystal/ownerKey.js'
import { USE_TERMS } from '../../../src/crystal/useTerms.js'
import type { Querela, QuerelaStore } from '../../../src/types/Querela.js'
import type { AuctorKey } from '../../../src/flow/types.js'
import type { Credentials } from '../../../src/allocutio/api/IdentityResolver.js'

const PLATFORM_ANIMA_ID = process.env.PLATFORM_ANIMA_ID ?? 'platform'
const OFFENDER = ownerKeyOf({ animaId: 'offender' })
const H3_LIMIT = USE_TERMS['minimax-h3'].strikeLimit

class MemoryQuerela implements QuerelaStore {
  records: Querela[] = []
  async create(input: Omit<Querela, 'id' | 'natum' | 'mutatum'>): Promise<Querela> {
    const now = new Date()
    const q: Querela = { ...input, id: `q-${this.records.length + 1}`, natum: now, mutatum: now }
    this.records.push(q)
    return q
  }
  async find(id: string) { return this.records.find(q => q.id === id) ?? null }
  async findByOwner(ownerKey: string) { return this.records.filter(q => q.ownerKey === ownerKey) }
  async update(id: string, patch: Partial<Pick<Querela, 'status' | 'verdict'>>) {
    const q = this.records.find(r => r.id === id)
    if (!q) throw new Error('not found')
    Object.assign(q, patch, { mutatum: new Date() })
    return q
  }
  async findByOwnerAndHash(ownerKey: string, contentHash: string) {
    return this.records.find(q => q.ownerKey === ownerKey && q.contentHash === contentHash) ?? null
  }
  async list() { return [...this.records] }
  // Same semantics as MongoQuerela: distinct runs among confirmed violations.
  async countViolations(subjectOwnerKey: string, useTerms: string) {
    const runs = new Set(this.records
      .filter(q => q.kind === 'abuse' && q.verdict === 'violation' && q.subjectOwnerKey === subjectOwnerKey && (q.useTerms ?? []).includes(useTerms))
      .map(q => q.capturedState?.runId))
    return runs.size
  }
}

const fakeIdentity = {
  async resolve(creds: Credentials): Promise<AuctorKey> {
    if (creds.authorization?.startsWith('Bearer ')) return { animaId: creds.authorization.slice('Bearer '.length) }
    throw new Error('auth.missing')
  },
}

// Three runs by the offender under H3, one plain run by someone else.
const RUNS: Record<string, { ownerKey: string; useTerms: string[] }> = {
  'run-a': { ownerKey: OFFENDER, useTerms: ['minimax-h3'] },
  'run-b': { ownerKey: OFFENDER, useTerms: ['minimax-h3'] },
  'run-c': { ownerKey: OFFENDER, useTerms: ['minimax-h3'] },
  'run-plain': { ownerKey: ownerKeyOf({ animaId: 'bystander' }), useTerms: [] },
}

async function withServer(store: MemoryQuerela, fn: (url: string) => Promise<void>) {
  const app = express()
  app.use(express.json())
  app.use('/v1/reports', createQuerelaRouter({ querelae: store, identity: fakeIdentity, resolveRun: async (id) => RUNS[id] ?? null }))
  app.use('/v1/admin/reports', createQuerelaAdminRouter({ querelae: store, identity: fakeIdentity }))
  const server = await new Promise<http.Server>((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)) })
  try {
    await fn(`http://127.0.0.1:${(server.address() as { port: number }).port}`)
  } finally {
    await new Promise<void>((r) => server.close(() => r()))
  }
}

async function call(method: string, url: string, who: string, body?: unknown): Promise<{ status: number; body: any }> {
  const res = await fetch(url, {
    method,
    headers: { authorization: `Bearer ${who}`, 'content-type': 'application/json' },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  })
  const text = await res.text()
  return { status: res.status, body: text ? JSON.parse(text) : null }
}

const report = (url: string, who: string, runId: string | undefined, extra: Record<string, unknown> = {}) =>
  call('POST', `${url}/v1/reports`, who, { kind: 'abuse', description: 'this output impersonates a real person', capturedState: { runId }, ...extra })

test('an abuse report names its run, and the subject is the run owner — not anyone the body names', async () => {
  const store = new MemoryQuerela()
  await withServer(store, async (url) => {
    const res = await report(url, 'reporter', 'run-a', { subjectOwnerKey: 'anima:innocent', useTerms: [] })
    assert.equal(res.status, 200)
    const q = store.records[0]
    assert.equal(q.kind, 'abuse')
    assert.equal(q.subjectOwnerKey, OFFENDER)
    assert.deepEqual(q.useTerms, ['minimax-h3'])
    assert.equal(q.capturedState?.runId, 'run-a')
    assert.equal(q.verdict, null)
  })
})

test('an abuse report with no run, or an unknown run, is refused', async () => {
  const store = new MemoryQuerela()
  await withServer(store, async (url) => {
    assert.equal((await report(url, 'reporter', undefined)).status, 400)
    assert.equal((await report(url, 'reporter', 'no-such-run')).status, 404)
    assert.equal(store.records.length, 0)
  })
})

test('one reporter reporting the same run twice files one report', async () => {
  const store = new MemoryQuerela()
  await withServer(store, async (url) => {
    const a = await report(url, 'reporter', 'run-a')
    const b = await report(url, 'reporter', 'run-a', { description: 'said differently' })
    assert.equal(a.body.id, b.body.id)
    assert.equal(store.records.length, 1)
  })
})

test('confirmed violations on distinct runs suspend the owner at the limit; several reports of one run count once', async () => {
  const store = new MemoryQuerela()
  await withServer(store, async (url) => {
    // Two people report run-a; both are confirmed. That is ONE violation.
    const r1 = (await report(url, 'reporter-1', 'run-a')).body.id
    const r2 = (await report(url, 'reporter-2', 'run-a')).body.id
    const v1 = await call('PATCH', `${url}/v1/admin/reports/${r1}`, PLATFORM_ANIMA_ID, { verdict: 'violation' })
    assert.equal(v1.status, 200)
    assert.equal(v1.body.report.status, 'closed', 'a verdict closes the report')
    const v2 = await call('PATCH', `${url}/v1/admin/reports/${r2}`, PLATFORM_ANIMA_ID, { verdict: 'violation' })
    assert.deepEqual(v2.body.subject, [{ terms: 'minimax-h3', strikes: 1, suspended: H3_LIMIT <= 1 }])

    // A dismissed report on run-b is not a strike.
    const r3 = (await report(url, 'reporter-1', 'run-b')).body.id
    const v3 = await call('PATCH', `${url}/v1/admin/reports/${r3}`, PLATFORM_ANIMA_ID, { verdict: 'dismissed' })
    assert.deepEqual(v3.body.subject, [{ terms: 'minimax-h3', strikes: 1, suspended: false }])

    // A confirmed report on run-c is the second violation: a repeat violator.
    const r4 = (await report(url, 'reporter-1', 'run-c')).body.id
    const v4 = await call('PATCH', `${url}/v1/admin/reports/${r4}`, PLATFORM_ANIMA_ID, { verdict: 'violation' })
    assert.deepEqual(v4.body.subject, [{ terms: 'minimax-h3', strikes: 2, suspended: 2 >= H3_LIMIT }])
    assert.equal(await store.countViolations(OFFENDER, 'minimax-h3'), 2)
  })
})

test('a verdict is admin-only, and only an abuse report takes one', async () => {
  const store = new MemoryQuerela()
  await withServer(store, async (url) => {
    const id = (await report(url, 'reporter', 'run-a')).body.id
    const self = await call('PATCH', `${url}/v1/admin/reports/${id}`, 'reporter', { verdict: 'violation' })
    assert.equal(self.status, 403)
    assert.equal(await store.countViolations(OFFENDER, 'minimax-h3'), 0)

    const bug = (await call('POST', `${url}/v1/reports`, 'reporter', { kind: 'bug', description: 'broken' })).body.id
    const res = await call('PATCH', `${url}/v1/admin/reports/${bug}`, PLATFORM_ANIMA_ID, { verdict: 'violation' })
    assert.equal(res.status, 400)

    const bad = await call('PATCH', `${url}/v1/admin/reports/${id}`, PLATFORM_ANIMA_ID, { verdict: 'guilty' })
    assert.equal(bad.status, 400)
  })
})

test('a status-only triage still works as before', async () => {
  const store = new MemoryQuerela()
  await withServer(store, async (url) => {
    const bug = (await call('POST', `${url}/v1/reports`, 'reporter', { kind: 'bug', description: 'broken' })).body.id
    const res = await call('PATCH', `${url}/v1/admin/reports/${bug}`, PLATFORM_ANIMA_ID, { status: 'closed' })
    assert.equal(res.status, 200)
    assert.equal(res.body.report.status, 'closed')
    assert.equal(res.body.subject, undefined)
  })
})
