// querelaRouter — POST /v1/reports. Pure unit test (fake in-memory store, no
// live Mongo): validation, dedup (identical report from same owner does not
// create a second record), and per-owner rate-limit rejection (429).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import express from 'express'
import { createQuerelaRouter } from '../../../src/api/querela/querelaRouter.js'
import type { Querela, QuerelaStore } from '../../../src/types/Querela.js'
import type { AuctorKey } from '../../../src/flow/types.js'
import type { Credentials } from '../../../src/allocutio/api/IdentityResolver.js'

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

const fakeIdentity = {
  async resolve(creds: Credentials): Promise<AuctorKey> {
    if (creds.authorization?.startsWith('Bearer ')) return { animaId: creds.authorization.slice('Bearer '.length) }
    if (creds.commitment) return { commitment: creds.commitment }
    throw new Error('auth.missing')
  },
}

function makeServer(querelae: QuerelaStore) {
  const app = express()
  app.use(express.json())
  app.use('/v1/reports', createQuerelaRouter({ querelae, identity: fakeIdentity }))
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

function post(url: string, headers: Record<string, string>, body: unknown): Promise<{ status: number; body: any }> {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body)
    const u = new URL(url)
    const req = http.request(
      { method: 'POST', hostname: u.hostname, port: u.port, path: u.pathname, headers: { ...headers, 'content-type': 'application/json' } },
      res => {
        const chunks: Buffer[] = []
        res.on('data', c => chunks.push(c))
        res.on('end', () => {
          const raw = Buffer.concat(chunks).toString('utf8')
          resolve({ status: res.statusCode ?? 0, body: raw ? JSON.parse(raw) : null })
        })
        res.on('error', reject)
      },
    )
    req.on('error', reject)
    req.write(payload)
    req.end()
  })
}

test('POST /v1/reports rejects unresolvable identity with 401', async () => {
  const { server, url } = await makeServer(new MemoryQuerela())
  try {
    const res = await post(`${url}/v1/reports`, {}, { kind: 'bug', description: 'broken' })
    assert.equal(res.status, 401)
  } finally { await closeServer(server) }
})

test('POST /v1/reports rejects missing kind', async () => {
  const { server, url } = await makeServer(new MemoryQuerela())
  try {
    const res = await post(`${url}/v1/reports`, { authorization: 'Bearer anima-1' }, { description: 'broken' })
    assert.equal(res.status, 400)
  } finally { await closeServer(server) }
})

test('POST /v1/reports rejects missing description', async () => {
  const { server, url } = await makeServer(new MemoryQuerela())
  try {
    const res = await post(`${url}/v1/reports`, { authorization: 'Bearer anima-1' }, { kind: 'bug' })
    assert.equal(res.status, 400)
  } finally { await closeServer(server) }
})

test('POST /v1/reports persists a report for each identity kind (animaId, commitment, bursaToken)', async () => {
  const store = new MemoryQuerela()
  const { server, url } = await makeServer(store)
  try {
    const anima = await post(`${url}/v1/reports`, { authorization: 'Bearer anima-1' }, { kind: 'bug', description: 'crash on load' })
    assert.equal(anima.status, 200)
    const commitment = await post(`${url}/v1/reports`, {}, { kind: 'feedback', description: 'nice app', commitment: 'commit-1' })
    assert.equal(commitment.status, 200)
    const bursa = await post(`${url}/v1/reports`, {}, { kind: 'feature', description: 'want dark mode', feature: 'theme', bursaToken: 'tok-1' })
    assert.equal(bursa.status, 200)
    assert.equal(store.records.length, 3)
    assert.deepEqual(store.records.map(r => r.kind).sort(), ['bug', 'feature', 'feedback'])
  } finally { await closeServer(server) }
})

test('POST /v1/reports dedups an identical report from the same owner', async () => {
  const store = new MemoryQuerela()
  const { server, url } = await makeServer(store)
  try {
    const first = await post(`${url}/v1/reports`, { authorization: 'Bearer anima-1' }, { kind: 'bug', description: 'crash on load' })
    const second = await post(`${url}/v1/reports`, { authorization: 'Bearer anima-1' }, { kind: 'bug', description: 'crash on load' })
    assert.equal(first.status, 200)
    assert.equal(second.status, 200)
    assert.equal(first.body.id, second.body.id)
    assert.equal(store.records.length, 1)
  } finally { await closeServer(server) }
})

test('POST /v1/reports does not dedup reports with different content from the same owner', async () => {
  const store = new MemoryQuerela()
  const { server, url } = await makeServer(store)
  try {
    await post(`${url}/v1/reports`, { authorization: 'Bearer anima-1' }, { kind: 'bug', description: 'crash on load' })
    await post(`${url}/v1/reports`, { authorization: 'Bearer anima-1' }, { kind: 'bug', description: 'crash on save' })
    assert.equal(store.records.length, 2)
  } finally { await closeServer(server) }
})

test('POST /v1/reports rejects over the per-owner rate limit with 429', async () => {
  const store = new MemoryQuerela()
  const { server, url } = await makeServer(store)
  try {
    for (let i = 0; i < 20; i++) {
      const res = await post(`${url}/v1/reports`, { authorization: 'Bearer anima-1' }, { kind: 'feedback', description: `report ${i}` })
      assert.equal(res.status, 200)
    }
    const over = await post(`${url}/v1/reports`, { authorization: 'Bearer anima-1' }, { kind: 'feedback', description: 'report 21' })
    assert.equal(over.status, 429)
  } finally { await closeServer(server) }
})
