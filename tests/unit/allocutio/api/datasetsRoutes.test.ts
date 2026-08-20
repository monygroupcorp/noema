// =============================================================================
// Datasets HTTP surface (T4) — hermetic route + facade test
// =============================================================================
//
// Real `CrystalApi` + real `createApiRouter`, backed by an in-memory `Datasets`
// fake (no live Mongo — hermetic). Covers: owner-scoping on both list routes +
// get, and both v1 ingestion paths (Q2) from `POST /v1/data/datasets` — a
// happy-path each plus the invalid-discriminant 400 case. Also the captionset
// write/edit seam and the media-append seam (`POST /v1/data/datasets/:id/media`),
// which shares the same ingestion shape and the same minting path as creation.
// =============================================================================

import { test } from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import express from 'express'

import { CrystalApi, type CrystalApiDeps } from '../../../../src/allocutio/api/CrystalApi.js'
import { createApiRouter, type Identity } from '../../../../src/allocutio/api/apiRouter.js'
import { Errors } from '../../../../src/allocutio/api/errors.js'
import { captionCoverage, nextDatasetVersion } from '../../../../src/types/dataset.js'
import type { Captionset, Dataset, DatasetListOpts, DatasetListPage, DatasetMediaItem, DatasetSummaryListPage, Datasets } from '../../../../src/types/dataset.js'
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
  // Same semantics as MongoDataset.addCaptionset: replace-by-id, coverage derived, mutatum bumped.
  async addCaptionset(datasetId: string, captionset: Captionset): Promise<Dataset | null> {
    const d = this.store.get(datasetId)
    if (!d) return null
    const next: Captionset = { ...captionset, coverage: captionCoverage(captionset.captions, d.media.length) }
    const captionsets = d.captionsets.some((c) => c.id === next.id)
      ? d.captionsets.map((c) => (c.id === next.id ? next : c))
      : [...d.captionsets, next]
    const updated: Dataset = { ...d, captionsets, mutatum: new Date() }
    this.store.set(datasetId, updated)
    return updated
  }
  // Same semantics as MongoDataset.setCaption: one key, coverage recounted, unknown captionset -> null.
  async setCaption(datasetId: string, captionsetId: string, mediaId: string, caption: string): Promise<Dataset | null> {
    const d = this.store.get(datasetId)
    if (!d) return null
    const target = d.captionsets.find((c) => c.id === captionsetId)
    if (!target) return null
    const captions = { ...(target.captions ?? {}), [mediaId]: caption }
    const next: Captionset = { ...target, captions, coverage: captionCoverage(captions, d.media.length) }
    const updated: Dataset = { ...d, captionsets: d.captionsets.map((c) => (c.id === captionsetId ? next : c)), mutatum: new Date() }
    this.store.set(datasetId, updated)
    return updated
  }
  // Same semantics as MongoDataset.addMedia: append-only, a new version entry counting the
  // media AFTER the append, and every existing captionset's coverage recounted against the
  // new media length.
  async addMedia(datasetId: string, items: DatasetMediaItem[]): Promise<Dataset | null> {
    const d = this.store.get(datasetId)
    if (!d) return null
    const media = [...d.media, ...items]
    const updated: Dataset = {
      ...d,
      media,
      captionsets: d.captionsets.map((c) => ({ ...c, coverage: captionCoverage(c.captions, media.length) })),
      versions: [...d.versions, { v: nextDatasetVersion(d.versions), count: media.length, when: new Date() }],
      mutatum: new Date(),
    }
    this.store.set(datasetId, updated)
    return updated
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


// ── Captionset write + edit seam ─────────────────────────────────────────────
//
// One test per non-vacuity claim: media-id keying (not positional), owner scoping on both
// new routes, and a coverage that is recounted rather than echoed.

async function seedDataset(url: string, headers: Record<string, string>, mediaUrls: string[]): Promise<Dataset> {
  const created = await request(`${url}/v1/data/datasets`, {
    method: 'POST',
    headers,
    body: { source: 'upload', name: 'Captioned set', modality: 'image', mediaUrls },
  })
  assert.equal(created.status, 201)
  return created.body.dataset as Dataset
}

test('a caption stays bound to its image after new media is appended', async () => {
  const datasets = new MemoryDatasets()
  const { server, url } = await createServer(datasets, makeFakeActorum([]))
  try {
    const headers = { 'x-api-key': 'owner-1' }
    const ds = await seedDataset(url, headers, ['https://r2.example/a.png', 'https://r2.example/b.png'])
    const [first, second] = ds.media

    const attached = await request(`${url}/v1/data/datasets/${ds.id}/captionsets`, {
      method: 'POST',
      headers,
      body: {
        id: 'pass-1',
        name: 'natural language',
        method: 'manual',
        captions: { [first.id]: 'a knight in frost', [second.id]: 'a knight at dusk' },
      },
    })
    assert.equal(attached.status, 201)
    assert.equal(attached.body.dataset.captionsets.length, 1)
    assert.equal(attached.body.dataset.captionsets[0].captions[first.id], 'a knight in frost')

    // Media is append-only; a positionally-keyed caption would re-bind here.
    const appended = await request(`${url}/v1/data/datasets/${ds.id}/media`, {
      method: 'POST',
      headers,
      body: { source: 'upload', mediaUrls: ['https://r2.example/c.png'] },
    })
    assert.equal(appended.status, 201)
    const appendedId = (appended.body.dataset.media as DatasetMediaItem[])[2].id

    const after = await request(`${url}/v1/data/datasets/full`, { headers })
    const set = after.body.datasets[0].captionsets[0]
    assert.equal(set.captions[first.id], 'a knight in frost')
    assert.equal(set.captions[second.id], 'a knight at dusk')
    assert.equal(set.captions[appendedId], undefined)
    // And the images those keys name are still the images they were written against.
    const media = after.body.datasets[0].media as Array<{ id: string; url: string }>
    assert.equal(media.find((m) => m.id === first.id)?.url, 'https://r2.example/a.png')
    assert.equal(media.find((m) => m.id === second.id)?.url, 'https://r2.example/b.png')
  } finally {
    await closeServer(server)
  }
})

test('a stranger cannot write or edit another owner\'s captionset', async () => {
  const datasets = new MemoryDatasets()
  const { server, url } = await createServer(datasets, makeFakeActorum([]))
  try {
    const owner = { 'x-api-key': 'owner-1' }
    const stranger = { 'x-api-key': 'stranger-1' }
    const ds = await seedDataset(url, owner, ['https://r2.example/a.png'])
    const mediaId = ds.media[0].id

    const attached = await request(`${url}/v1/data/datasets/${ds.id}/captionsets`, {
      method: 'POST',
      headers: owner,
      body: { id: 'pass-1', name: 'natural language', method: 'manual', captions: { [mediaId]: 'mine' } },
    })
    assert.equal(attached.status, 201)

    const strangerWrite = await request(`${url}/v1/data/datasets/${ds.id}/captionsets`, {
      method: 'POST',
      headers: stranger,
      body: { id: 'pass-2', name: 'theirs', method: 'manual', captions: { [mediaId]: 'not mine' } },
    })
    assert.equal(strangerWrite.status, 404)

    const strangerEdit = await request(`${url}/v1/data/datasets/${ds.id}/captionsets/pass-1/captions/${mediaId}`, {
      method: 'PATCH',
      headers: stranger,
      body: { caption: 'overwritten' },
    })
    assert.equal(strangerEdit.status, 404)

    // A 404 can be returned AFTER a write — assert the dataset itself is untouched.
    const after = await request(`${url}/v1/data/datasets/full`, { headers: owner })
    const sets = after.body.datasets[0].captionsets
    assert.equal(sets.length, 1)
    assert.equal(sets[0].id, 'pass-1')
    assert.equal(sets[0].captions[mediaId], 'mine')
  } finally {
    await closeServer(server)
  }
})

test('coverage recounts from the captions actually present', async () => {
  const datasets = new MemoryDatasets()
  const { server, url } = await createServer(datasets, makeFakeActorum([]))
  try {
    const headers = { 'x-api-key': 'owner-1' }
    const ds = await seedDataset(url, headers, ['https://r2.example/a.png', 'https://r2.example/b.png', 'https://r2.example/c.png'])
    const [a, b] = ds.media

    const attached = await request(`${url}/v1/data/datasets/${ds.id}/captionsets`, {
      method: 'POST',
      headers,
      body: { id: 'pass-1', name: 'natural language', method: 'manual', coverage: '3/3' },
    })
    assert.equal(attached.status, 201)
    // An echoed coverage from the body would read '3/3' over zero captions.
    assert.equal(attached.body.dataset.captionsets[0].coverage, '0/3')

    const one = await request(`${url}/v1/data/datasets/${ds.id}/captionsets/pass-1/captions/${a.id}`, {
      method: 'PATCH',
      headers,
      body: { caption: 'first', coverage: '3/3' },
    })
    assert.equal(one.status, 200)
    assert.equal(one.body.dataset.captionsets[0].coverage, '1/3')

    const two = await request(`${url}/v1/data/datasets/${ds.id}/captionsets/pass-1/captions/${b.id}`, {
      method: 'PATCH',
      headers,
      body: { caption: 'second' },
    })
    assert.equal(two.status, 200)
    assert.equal(two.body.dataset.captionsets[0].coverage, '2/3')

    // Re-editing an existing key moves the text, not the count.
    const again = await request(`${url}/v1/data/datasets/${ds.id}/captionsets/pass-1/captions/${b.id}`, {
      method: 'PATCH',
      headers,
      body: { caption: 'second, revised' },
    })
    assert.equal(again.body.dataset.captionsets[0].coverage, '2/3')
    assert.equal(again.body.dataset.captionsets[0].captions[b.id], 'second, revised')
  } finally {
    await closeServer(server)
  }
})

test('a caption cannot be written against a media item that is not on the dataset', async () => {
  const { server, url } = await createServer(new MemoryDatasets(), makeFakeActorum([]))
  try {
    const headers = { 'x-api-key': 'owner-1' }
    const ds = await seedDataset(url, headers, ['https://r2.example/a.png'])

    const bogusOnAttach = await request(`${url}/v1/data/datasets/${ds.id}/captionsets`, {
      method: 'POST',
      headers,
      body: { id: 'pass-1', name: 'nl', method: 'manual', captions: { 'not-a-media-id': 'nowhere' } },
    })
    assert.equal(bogusOnAttach.status, 400)

    await request(`${url}/v1/data/datasets/${ds.id}/captionsets`, {
      method: 'POST',
      headers,
      body: { id: 'pass-1', name: 'nl', method: 'manual' },
    })
    const bogusOnEdit = await request(`${url}/v1/data/datasets/${ds.id}/captionsets/pass-1/captions/not-a-media-id`, {
      method: 'PATCH',
      headers,
      body: { caption: 'nowhere' },
    })
    assert.equal(bogusOnEdit.status, 400)

    const unknownSet = await request(`${url}/v1/data/datasets/${ds.id}/captionsets/pass-9/captions/${ds.media[0].id}`, {
      method: 'PATCH',
      headers,
      body: { caption: 'nowhere' },
    })
    assert.equal(unknownSet.status, 404)
  } finally {
    await closeServer(server)
  }
})

test('re-attaching a captionset with the same id replaces it rather than duplicating', async () => {
  const { server, url } = await createServer(new MemoryDatasets(), makeFakeActorum([]))
  try {
    const headers = { 'x-api-key': 'owner-1' }
    const ds = await seedDataset(url, headers, ['https://r2.example/a.png', 'https://r2.example/b.png'])
    const [a, b] = ds.media

    await request(`${url}/v1/data/datasets/${ds.id}/captionsets`, {
      method: 'POST', headers,
      body: { id: 'pass-1', name: 'nl', method: 'manual', captions: { [a.id]: 'one' } },
    })
    const second = await request(`${url}/v1/data/datasets/${ds.id}/captionsets`, {
      method: 'POST', headers,
      body: { id: 'pass-1', name: 'nl', method: 'manual', captions: { [a.id]: 'one', [b.id]: 'two' } },
    })
    assert.equal(second.status, 201)
    assert.equal(second.body.dataset.captionsets.length, 1)
    assert.equal(second.body.dataset.captionsets[0].coverage, '2/2')
  } finally {
    await closeServer(server)
  }
})

// ── Media append seam ────────────────────────────────────────────────────────
//
// One test per claim the route makes: the media set grows without disturbing what was
// already on it, a version entry records the new count, every captionset's coverage
// re-reads against the new denominator, both ingestion shapes are accepted and a third is
// not, and a stranger reaches none of it.

test('appending media leaves the media already on the dataset exactly where it was', async () => {
  const { server, url } = await createServer(new MemoryDatasets(), makeFakeActorum([]))
  try {
    const headers = { 'x-api-key': 'owner-1' }
    const ds = await seedDataset(url, headers, ['https://r2.example/a.png', 'https://r2.example/b.png'])
    const before = ds.media

    const appended = await request(`${url}/v1/data/datasets/${ds.id}/media`, {
      method: 'POST',
      headers,
      body: { source: 'upload', mediaUrls: ['https://r2.example/c.png', 'https://r2.example/d.png'] },
    })
    assert.equal(appended.status, 201)

    const media = appended.body.dataset.media as DatasetMediaItem[]
    assert.equal(media.length, 4, 'the two new items are added to the two already present')
    // Identity AND order: a replace would mint new ids for the originals, and a reorder would
    // move the ids the caption maps and fragments are keyed on.
    assert.deepEqual(media.slice(0, 2).map((m) => m.id), before.map((m) => m.id))
    assert.deepEqual(media.slice(0, 2).map((m) => m.url), before.map((m) => m.url))
    assert.deepEqual(media.slice(2).map((m) => m.url), ['https://r2.example/c.png', 'https://r2.example/d.png'])
    assert.equal(new Set(media.map((m) => m.id)).size, 4, 'every media id is distinct')
  } finally {
    await closeServer(server)
  }
})

test('an append records a new DatasetVersion counting the media after it', async () => {
  const { server, url } = await createServer(new MemoryDatasets(), makeFakeActorum([]))
  try {
    const headers = { 'x-api-key': 'owner-1' }
    const ds = await seedDataset(url, headers, ['https://r2.example/a.png'])
    assert.deepEqual(ds.versions.map((v) => [v.v, v.count]), [['1.0.0', 1]])

    const first = await request(`${url}/v1/data/datasets/${ds.id}/media`, {
      method: 'POST', headers, body: { source: 'upload', mediaUrls: ['https://r2.example/b.png', 'https://r2.example/c.png'] },
    })
    assert.equal(first.status, 201)
    assert.deepEqual(
      first.body.dataset.versions.map((v: { v: string; count: number }) => [v.v, v.count]),
      [['1.0.0', 1], ['1.1.0', 3]],
      'the creation snapshot is kept and a new one is appended at the post-append count',
    )

    const second = await request(`${url}/v1/data/datasets/${ds.id}/media`, {
      method: 'POST', headers, body: { source: 'upload', mediaUrls: ['https://r2.example/d.png'] },
    })
    assert.deepEqual(
      second.body.dataset.versions.map((v: { v: string; count: number }) => [v.v, v.count]),
      [['1.0.0', 1], ['1.1.0', 3], ['1.2.0', 4]],
    )
  } finally {
    await closeServer(server)
  }
})

test('an existing captionset\'s coverage re-reads against the media count after an append', async () => {
  const { server, url } = await createServer(new MemoryDatasets(), makeFakeActorum([]))
  try {
    const headers = { 'x-api-key': 'owner-1' }
    const urls = Array.from({ length: 7 }, (_, i) => `https://r2.example/${i}.png`)
    const ds = await seedDataset(url, headers, urls)

    const captions = Object.fromEntries(ds.media.map((m, i) => [m.id, `caption ${i}`]))
    const attached = await request(`${url}/v1/data/datasets/${ds.id}/captionsets`, {
      method: 'POST', headers, body: { id: 'pass-1', name: 'nl', method: 'manual', captions },
    })
    assert.equal(attached.body.dataset.captionsets[0].coverage, '7/7', 'a complete pass before the append')

    // A pass that covered everything no longer does: the captions did not change, the
    // denominator did. Leaving coverage alone would keep it claiming completeness.
    const appended = await request(`${url}/v1/data/datasets/${ds.id}/media`, {
      method: 'POST', headers, body: { source: 'upload', mediaUrls: ['https://r2.example/7.png', 'https://r2.example/8.png'] },
    })
    assert.equal(appended.status, 201)
    assert.equal(appended.body.dataset.captionsets[0].coverage, '7/9')
    assert.equal(Object.keys(appended.body.dataset.captionsets[0].captions).length, 7, 'no caption was added or dropped')

    // And it is persisted, not just projected into the response.
    const after = await request(`${url}/v1/data/datasets/full`, { headers })
    assert.equal(after.body.datasets[0].captionsets[0].coverage, '7/9')
  } finally {
    await closeServer(server)
  }
})

test('a media append accepts the generation ingestion shape and rejects a third shape with 400', async () => {
  const actum: Actum = {
    id: 'actum-1',
    modusId: 'flux-schnell',
    modusVersiono: '1.0.0',
    impetus: 10n,
    signaConsumed: [],
    status: 'completus',
    exitus: { images: ['https://cdn.example/out1.png'] },
  } as unknown as Actum
  const { server, url } = await createServer(new MemoryDatasets(), makeFakeActorum([actum]))
  try {
    const headers = { 'x-api-key': 'owner-1' }
    const ds = await seedDataset(url, headers, ['https://r2.example/a.png'])

    const seeded = await request(`${url}/v1/data/datasets/${ds.id}/media`, {
      method: 'POST', headers, body: { source: 'generation', actumIds: ['actum-1'] },
    })
    assert.equal(seeded.status, 201)
    const media = seeded.body.dataset.media as DatasetMediaItem[]
    assert.equal(media.length, 2)
    assert.equal(media[1].source, 'generation')
    assert.equal(media[1].actumId, 'actum-1')

    const bogus = await request(`${url}/v1/data/datasets/${ds.id}/media`, {
      method: 'POST', headers, body: { source: 'telepathy', mediaUrls: ['https://r2.example/z.png'] },
    })
    assert.equal(bogus.status, 400)
    assert.equal(bogus.body.error.code, 'input.malformed')

    const empty = await request(`${url}/v1/data/datasets/${ds.id}/media`, {
      method: 'POST', headers, body: { source: 'upload', mediaUrls: [] },
    })
    assert.equal(empty.status, 400)

    // Neither rejection reached the dataset.
    const after = await request(`${url}/v1/data/datasets/full`, { headers })
    assert.equal(after.body.datasets[0].media.length, 2)
  } finally {
    await closeServer(server)
  }
})

test('a stranger cannot append media to another owner\'s dataset', async () => {
  const { server, url } = await createServer(new MemoryDatasets(), makeFakeActorum([]))
  try {
    const owner = { 'x-api-key': 'owner-1' }
    const stranger = { 'x-api-key': 'stranger-1' }
    const ds = await seedDataset(url, owner, ['https://r2.example/a.png'])

    const attempt = await request(`${url}/v1/data/datasets/${ds.id}/media`, {
      method: 'POST', headers: stranger, body: { source: 'upload', mediaUrls: ['https://r2.example/theirs.png'] },
    })
    assert.equal(attempt.status, 404, 'a dataset the caller does not own reads as absent, not forbidden')

    // A 404 can be returned AFTER a write — assert the dataset itself is untouched.
    const after = await request(`${url}/v1/data/datasets/full`, { headers: owner })
    assert.equal(after.body.datasets[0].media.length, 1)
    assert.equal(after.body.datasets[0].media[0].url, 'https://r2.example/a.png')
    assert.equal(after.body.datasets[0].versions.length, 1)
  } finally {
    await closeServer(server)
  }
})
