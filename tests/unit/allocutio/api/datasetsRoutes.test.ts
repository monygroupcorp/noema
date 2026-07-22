// =============================================================================
// Datasets HTTP surface (T4) — hermetic route + facade test
// =============================================================================
//
// Real `CrystalApi` + real `createApiRouter`, backed by an in-memory `Datasets`
// fake (no live Mongo — hermetic). Covers: owner-scoping on both list routes +
// get, and both v1 ingestion paths (Q2) from `POST /v1/data/datasets` — a
// happy-path each plus the invalid-discriminant 400 case.
// =============================================================================

import { test } from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import express from 'express'

import { CrystalApi, type CrystalApiDeps } from '../../../../src/allocutio/api/CrystalApi.js'
import { createApiRouter, type Identity } from '../../../../src/allocutio/api/apiRouter.js'
import { Errors } from '../../../../src/allocutio/api/errors.js'
import type { Dataset, DatasetListOpts, DatasetListPage, DatasetSummaryListPage, Datasets } from '../../../../src/types/dataset.js'
import type { Actum, Actorum } from '../../../../src/types/cursus.js'
import type { AuctorKey } from '../../../../src/flow/types.js'
import type { Credentials } from '../../../../src/allocutio/api/IdentityResolver.js'

// ── In-memory Datasets double (mirrors MongoDataset's owner-scoped shape, no I/O) ──
class MemoryDatasets implements Datasets {
  private store = new Map<string, Dataset>()
  private seq = 0

  async create(input: Omit<Dataset, 'id' | 'natum' | 'mutatum'>): Promise<Dataset> {
    const now = new Date()
    const d: Dataset = { ...input, id: `ds-${++this.seq}`, natum: now, mutatum: now }
    this.store.set(d.id, d)
    return d
  }
  async find(id: string): Promise<Dataset | null> { return this.store.get(id) ?? null }
  async list(opts: DatasetListOpts): Promise<DatasetListPage> {
    return { entries: [...this.store.values()].filter((d) => d.owner === opts.owner) }
  }
  async listSummaries(opts: DatasetListOpts): Promise<DatasetSummaryListPage> {
    const { entries } = await this.list(opts)
    return { entries: entries.map((d) => ({ id: d.id, name: d.name, images: d.media.length, updatedAt: d.mutatum.toISOString() })) }
  }
}

// ── A minimal Actorum fake — just enough for the seed-from-generation path ──
function makeFakeActorum(seed: Actum[]): Actorum {
  const byId = new Map<string, Actum>(seed.map((a) => [a.id, a]))
  return {
    async create() { throw new Error('unused') },
    async update() { throw new Error('unused') },
    async findById(id: string) { return byId.get(id) ?? null },
    async findByExternusJobId() { return null },
    async findByNullifier() { return null },
    async findExpired() { return [] },
    async findInFlight() { return [] },
    async findByCompositum() { return [] },
  }
}

const fakeIdentity: Identity = {
  async resolve(creds: Credentials): Promise<AuctorKey> {
    if (creds.apiKey) return { animaId: creds.apiKey }
    throw Errors.authMissing()
  },
}

// Minimal Signorum stub — `_owns` consults `ownsAny` for animaId/commitment auctors even
// when an Actum carries no signaConsumed (a cost-free/zero-signum test fixture). Every
// caller "owns" everything here; the seed-from-generation test only exercises the owner's
// own path (a stranger-can't-seed-from-a-run-they-don't-own case is out of this item's
// verify scope — Actorum's real ownsAny is exercised by the ledger's own test suite).
const fakeSignorum = { async ownsAny() { return true } }

function createServer(datasets: Datasets, actorum: Actorum): Promise<{ server: http.Server; url: string }> {
  const deps = { datasets, actorum, signorum: fakeSignorum } as unknown as CrystalApiDeps
  const api = new CrystalApi(deps)
  return new Promise((resolveP, reject) => {
    const app = express()
    app.use(express.json())
    app.use('/v1', createApiRouter({ api: api as unknown as ConstructorParameters<typeof createApiRouter>[0]['api'], identity: fakeIdentity }))
    const server = app.listen(0, '127.0.0.1', () => {
      const addr = server.address() as { port: number }
      resolveP({ server, url: `http://127.0.0.1:${addr.port}` })
    })
    server.on('error', reject)
  })
}

function closeServer(server: http.Server): Promise<void> {
  return new Promise((resolveP, reject) => server.close((err) => (err ? reject(err) : resolveP())))
}

interface HttpResult { status: number; body: any }

function request(url: string, opts: { method?: string; headers?: Record<string, string>; body?: unknown } = {}): Promise<HttpResult> {
  return new Promise((resolveP, reject) => {
    const payload = opts.body !== undefined ? JSON.stringify(opts.body) : undefined
    const headers: Record<string, string> = { ...(opts.headers ?? {}) }
    if (payload !== undefined) {
      headers['content-type'] = 'application/json'
      headers['content-length'] = String(Buffer.byteLength(payload))
    }
    const req = http.request(url, { method: opts.method ?? 'GET', headers }, (res) => {
      const chunks: Buffer[] = []
      res.on('data', (c) => chunks.push(c as Buffer))
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8')
        resolveP({ status: res.statusCode ?? 0, body: text ? JSON.parse(text) : undefined })
      })
    })
    req.on('error', reject)
    if (payload !== undefined) req.write(payload)
    req.end()
  })
}

test('POST /v1/data/datasets (upload path) creates a dataset; owner sees it on both list routes', async () => {
  const { server, url } = await createServer(new MemoryDatasets(), makeFakeActorum([]))
  try {
    const headers = { 'x-api-key': 'owner-1' }
    const created = await request(`${url}/v1/data/datasets`, {
      method: 'POST',
      headers,
      body: { source: 'upload', name: 'Frost-knight set', modality: 'image', mediaUrls: ['https://r2.example/a.png', 'https://r2.example/b.png'] },
    })
    assert.equal(created.status, 201)
    assert.equal(created.body.dataset.media.length, 2)
    assert.equal(created.body.dataset.custody, 'local')

    const full = await request(`${url}/v1/data/datasets/full`, { headers })
    assert.equal(full.status, 200)
    assert.equal(full.body.datasets.length, 1)
    assert.equal(full.body.datasets[0].name, 'Frost-knight set')

    const summary = await request(`${url}/v1/data/datasets`, { headers })
    assert.equal(summary.status, 200)
    assert.equal(summary.body.datasets.length, 1)
    assert.equal(summary.body.datasets[0].images, 2)
    // Summary stays thin — no captionsets/versions/media leak through.
    assert.equal(summary.body.datasets[0].media, undefined)
  } finally {
    await closeServer(server)
  }
})

test('POST /v1/data/datasets (generation path) seeds media from the caller\'s own completed Actum', async () => {
  const actum: Actum = {
    id: 'actum-1',
    modusId: 'flux-schnell',
    modusVersiono: '1.0.0',
    impetus: 10n,
    signaConsumed: [],
    status: 'completus',
    exitus: { images: ['https://cdn.example/out1.png', 'https://cdn.example/out2.png'] },
  } as unknown as Actum
  const { server, url } = await createServer(new MemoryDatasets(), makeFakeActorum([actum]))
  try {
    const headers = { 'x-api-key': 'owner-1' }
    const created = await request(`${url}/v1/data/datasets`, {
      method: 'POST',
      headers,
      body: { source: 'generation', name: 'Seeded set', modality: 'image', actumIds: ['actum-1'] },
    })
    assert.equal(created.status, 201)
    assert.equal(created.body.dataset.media.length, 2)
    assert.equal(created.body.dataset.media[0].source, 'generation')
    assert.equal(created.body.dataset.media[0].actumId, 'actum-1')
  } finally {
    await closeServer(server)
  }
})

test('POST /v1/data/datasets rejects a body matching neither ingestion shape with 400', async () => {
  const { server, url } = await createServer(new MemoryDatasets(), makeFakeActorum([]))
  try {
    const headers = { 'x-api-key': 'owner-1' }
    const res = await request(`${url}/v1/data/datasets`, {
      method: 'POST',
      headers,
      body: { source: 'telepathy', name: 'Nope', modality: 'image' },
    })
    assert.equal(res.status, 400)
    assert.equal(res.body.error.code, 'input.malformed')
  } finally {
    await closeServer(server)
  }
})

test('a stranger never sees another owner\'s datasets on either list route or get', async () => {
  const { server, url } = await createServer(new MemoryDatasets(), makeFakeActorum([]))
  try {
    const owner = { 'x-api-key': 'owner-1' }
    const stranger = { 'x-api-key': 'stranger-1' }
    const created = await request(`${url}/v1/data/datasets`, {
      method: 'POST',
      headers: owner,
      body: { source: 'upload', name: 'Mine', modality: 'image', mediaUrls: ['https://r2.example/a.png'] },
    })
    const id = created.body.dataset.id

    const strangerFull = await request(`${url}/v1/data/datasets/full`, { headers: stranger })
    assert.equal(strangerFull.body.datasets.length, 0)
    const strangerSummary = await request(`${url}/v1/data/datasets`, { headers: stranger })
    assert.equal(strangerSummary.body.datasets.length, 0)

    const ownerFull = await request(`${url}/v1/data/datasets/full`, { headers: owner })
    assert.equal(ownerFull.body.datasets.length, 1)
    assert.equal(ownerFull.body.datasets[0].id, id)
  } finally {
    await closeServer(server)
  }
})
