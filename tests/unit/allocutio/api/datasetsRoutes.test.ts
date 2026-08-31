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
import { isPrivateMarker, privateMarker } from '../../../../src/crystal/MediaFetcher.js'
import { coverageOver, isArchived, liveMedia, nextDatasetVersion } from '../../../../src/types/dataset.js'
import type { Captionset, Dataset, DatasetListOpts, DatasetListPage, DatasetMediaItem, DatasetSummaryListPage, Datasets } from '../../../../src/types/dataset.js'
import type { Sodalitas, Sodalitates, Sodalitatum } from '../../../../src/types/sodalitas.js'
import type { Actorum } from '../../../../src/types/cursus.js'
import type { Actum } from '../../../../src/types/actum.js'
import type { Fragment } from '../../../../src/crystal/muse/taxonomy.js'
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
  // Same access predicate MongoDataset._page puts in the query: the caller's own datasets
  // UNION the datasets shared with a team the caller is a member of (`opts.sodalitasIds`).
  // With no team ids this is the bare owner filter it has always been.
  async list(opts: DatasetListOpts): Promise<DatasetListPage> {
    const teamIds = new Set(opts.sodalitasIds ?? [])
    const mayRead = (d: Dataset): boolean =>
      d.owner === opts.owner || (d.sodalitasId !== undefined && teamIds.has(d.sodalitasId))
    return { entries: [...this.store.values()].filter((d) => mayRead(d) && !isArchived(d)) }
  }
  async listSummaries(opts: DatasetListOpts): Promise<DatasetSummaryListPage> {
    const { entries } = await this.list(opts)
    return { entries: entries.map((d) => ({ id: d.id, name: d.name, images: liveMedia(d.media).length, updatedAt: d.mutatum.toISOString() })) }
  }
  // Same semantics as MongoDataset.addCaptionset: replace-by-id, coverage derived, mutatum bumped.
  async addCaptionset(datasetId: string, captionset: Captionset): Promise<Dataset | null> {
    const d = this.store.get(datasetId)
    if (!d) return null
    const next: Captionset = { ...captionset, coverage: coverageOver(captionset.captions, d.media) }
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
    const next: Captionset = { ...target, captions, coverage: coverageOver(captions, d.media) }
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
      captionsets: d.captionsets.map((c) => ({ ...c, coverage: coverageOver(c.captions, media) })),
      versions: [...d.versions, { v: nextDatasetVersion(d.versions), count: media.length, when: new Date() }],
      mutatum: new Date(),
    }
    this.store.set(datasetId, updated)
    return updated
  }

  // ── Archive (noema-266) ──────────────────────────────────────────────────
  // Mirrors MongoDataset exactly: `list`/`listSummaries` exclude archived datasets and `find`
  // does not; archiving or restoring media recomputes every captionset's coverage through the
  // same shared `coverageOver`, so this double cannot claim arithmetic the store would not.
  async archiveDataset(datasetId: string): Promise<Dataset | null> {
    const d = this.store.get(datasetId)
    if (!d) return null
    if (d.archivum) return d
    const now = new Date()
    const updated: Dataset = { ...d, archivum: now, mutatum: now }
    this.store.set(datasetId, updated)
    return updated
  }
  async restoreDataset(datasetId: string): Promise<Dataset | null> {
    const d = this.store.get(datasetId)
    if (!d) return null
    if (!d.archivum) return d
    const { archivum: _gone, ...rest } = d
    const updated: Dataset = { ...rest, mutatum: new Date() }
    this.store.set(datasetId, updated)
    return updated
  }
  // Not reached by any route under test here (the decompose/save path writes it). It throws
  // rather than returning a default, so a future test that does reach it cannot pass on a lie.
  async setFragments(_datasetId: string, _mediaId: string, _fragments: Fragment[]): Promise<Dataset | null> {
    throw new Error('MemoryDatasets.setFragments is not exercised by these routes')
  }
  async archiveMedia(datasetId: string, mediaId: string): Promise<Dataset | null> {
    return this._setMediaArchivum(datasetId, mediaId, new Date())
  }
  async restoreMedia(datasetId: string, mediaId: string): Promise<Dataset | null> {
    return this._setMediaArchivum(datasetId, mediaId, null)
  }
  private async _setMediaArchivum(datasetId: string, mediaId: string, archivum: Date | null): Promise<Dataset | null> {
    const d = this.store.get(datasetId)
    if (!d) return null
    const target = d.media.find((m) => m.id === mediaId)
    if (!target) return null
    if (Boolean(target.archivum) === Boolean(archivum)) return d
    const media = d.media.map((m) => {
      if (m.id !== mediaId) return m
      if (archivum) return { ...m, archivum }
      const { archivum: _gone, ...rest } = m
      return rest
    })
    const updated: Dataset = {
      ...d,
      media,
      captionsets: d.captionsets.map((c) => ({ ...c, coverage: coverageOver(c.captions, media) })),
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
    async findByCallbackNonce() { throw new Error('unused') },
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

// ── In-memory Sodalitatum double — the team primitive the dataset overlay reuses ──
//
// Flat membership, exactly as `src/types/sodalitas.ts` declares it. `find` is what
// `_ownsDataset` consults per dataset; `listByMember` is what the two list routes resolve the
// caller's team ids through. Nothing here is dataset-aware: the overlay is `Collectio`'s
// unchanged, so the team store cannot be the place a dataset test passes on a special case.
class MemorySodalitatum implements Sodalitatum {
  private store = new Map<string, Sodalitas>()
  private seq = 0

  async find(id: string): Promise<Sodalitas | null> { return this.store.get(id) ?? null }
  async create(input: Omit<Sodalitas, 'id' | 'natum'>): Promise<Sodalitas> {
    const t: Sodalitas = { ...input, id: `team-${++this.seq}`, natum: new Date() }
    this.store.set(t.id, t)
    return t
  }
  async update(id: string, patch: Partial<Pick<Sodalitas, 'membra' | 'nomen'>>): Promise<Sodalitas> {
    const t = this.store.get(id)
    if (!t) throw new Error(`no team ${id}`)
    const next: Sodalitas = { ...t, ...patch }
    this.store.set(id, next)
    return next
  }
  async listByMember(animaId: string): Promise<Sodalitates> {
    return [...this.store.values()].filter((t) => t.membra.includes(animaId))
  }
}

// An ATTRIBUTING Signorum stub: a run is owned by the anima whose id is encoded in the signum
// it consumed. Unlike `fakeSignorum` (everyone owns everything) this can tell two callers
// apart, which is what a "a member may only contribute their OWN generations" claim needs —
// with the permissive stub that test would pass vacuously.
const attributingSignorum = {
  async ownsAny(by: { animaId: string } | { commitment: string }, signumIds: string[]) {
    if (!('animaId' in by)) return false
    return signumIds.includes(`sig-of-${by.animaId}`)
  },
}

// ── A private-outputs store double (noema-347's `CrystalApiDeps.privateOutputs`) ──
//
// The real one is an R2 bucket with no public binding; presigning is a LOCAL signature over a
// key, which is exactly what this stands in for. It records every key it was asked to sign, so
// a test can assert that resolution happened at read time and on the key that was stored — not
// that some plausible-looking string came back.
function fakePrivateOutputs(opts: { refuse?: boolean } = {}): {
  signed: string[]
  cfg: { store: { getSignedDownloadUrl(key: string, o?: { expiresIn?: number }): Promise<string> } }
} {
  const signed: string[] = []
  return {
    signed,
    cfg: {
      store: {
        async getSignedDownloadUrl(key: string): Promise<string> {
          signed.push(key)
          if (opts.refuse) throw new Error('private-outputs store refused')
          return `https://private.example/${key}?X-Amz-Signature=deadbeef`
        },
      },
    },
  }
}

function createServer(
  datasets: Datasets,
  actorum: Actorum,
  sodalitatum?: Sodalitatum,
  signorum: unknown = fakeSignorum,
  privateOutputs?: ReturnType<typeof fakePrivateOutputs>['cfg'],
): Promise<{ server: http.Server; url: string; api: CrystalApi }> {
  const deps = {
    datasets,
    actorum,
    signorum,
    ...(sodalitatum ? { sodalitatum } : {}),
    ...(privateOutputs ? { privateOutputs } : {}),
  } as unknown as CrystalApiDeps
  const api = new CrystalApi(deps)
  return new Promise((resolveP, reject) => {
    const app = express()
    app.use(express.json())
    app.use('/v1', createApiRouter({ api: api as unknown as Parameters<typeof createApiRouter>[0]['api'], identity: fakeIdentity }))
    const server = app.listen(0, '127.0.0.1', () => {
      const addr = server.address() as { port: number }
      resolveP({ server, url: `http://127.0.0.1:${addr.port}`, api })
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

// ── Empty create (noema-380) ───────────────────────────────────────────────
// A dataset can be opened with no media and filled afterwards through the append route that
// already exists. `source` is OMITTED for that — the absence of an ingestion path, not a third
// one — so `_mintMedia` keeps exactly two arms and stays the only place media is minted.

test('POST /v1/data/datasets with no source creates an empty dataset that reads and lists correctly', async () => {
  const { server, url, api } = await createServer(new MemoryDatasets(), makeFakeActorum([]))
  try {
    const headers = { 'x-api-key': 'owner-1' }
    const created = await request(`${url}/v1/data/datasets`, {
      method: 'POST',
      headers,
      body: { name: 'To be filled', modality: 'image' },
    })
    assert.equal(created.status, 201)
    const ds = created.body.dataset
    assert.deepEqual(ds.media, [])
    assert.deepEqual(ds.captionsets, [])
    assert.equal(ds.custody, 'local')
    // The version history has the same shape a seeded dataset gets: one entry at 1.0.0,
    // counting the media it was created with. An empty `versions` is what would read as broken.
    assert.equal(ds.versions.length, 1)
    assert.equal(ds.versions[0].v, '1.0.0')
    assert.equal(ds.versions[0].count, 0)

    const resolved = await api.getDataset({ animaId: 'owner-1' }, ds.id)
    assert.deepEqual(resolved.media, [])
    assert.equal(resolved.versions.length, 1)

    const full = await request(`${url}/v1/data/datasets/full`, { headers })
    assert.equal(full.status, 200)
    assert.equal(full.body.datasets.length, 1)
    assert.equal(full.body.datasets[0].id, ds.id)

    const summary = await request(`${url}/v1/data/datasets`, { headers })
    assert.equal(summary.status, 200)
    assert.equal(summary.body.datasets.length, 1)
    // An empty dataset counts zero images — it is listed, not hidden and not undefined.
    assert.equal(summary.body.datasets[0].images, 0)
  } finally {
    await closeServer(server)
  }
})

test('a dataset created empty is populated through the existing append route, and its versions stay in sequence', async () => {
  const { server, url } = await createServer(new MemoryDatasets(), makeFakeActorum([]))
  try {
    const headers = { 'x-api-key': 'owner-1' }
    const created = await request(`${url}/v1/data/datasets`, {
      method: 'POST', headers, body: { name: 'Filled later', modality: 'image' },
    })
    assert.equal(created.status, 201)
    const id = created.body.dataset.id

    const appended = await request(`${url}/v1/data/datasets/${id}/media`, {
      method: 'POST',
      headers,
      body: { source: 'upload', mediaUrls: ['https://r2.example/a.png', 'https://r2.example/b.png'] },
    })
    assert.equal(appended.status, 201)
    assert.equal(appended.body.dataset.media.length, 2)
    // 1.0.0 (count 0, at creation) -> 1.1.0 (count 2, the first append). The append reads its
    // next version off the history the empty create left, so nothing is skipped.
    assert.deepEqual(appended.body.dataset.versions.map((v: { v: string }) => v.v), ['1.0.0', '1.1.0'])
    assert.deepEqual(appended.body.dataset.versions.map((v: { count: number }) => v.count), [0, 2])

    const second = await request(`${url}/v1/data/datasets/${id}/media`, {
      method: 'POST', headers, body: { source: 'upload', mediaUrls: ['https://r2.example/c.png'] },
    })
    assert.equal(second.status, 201)
    assert.deepEqual(second.body.dataset.versions.map((v: { v: string }) => v.v), ['1.0.0', '1.1.0', '1.2.0'])

    const summary = await request(`${url}/v1/data/datasets`, { headers })
    assert.equal(summary.body.datasets[0].images, 3)
  } finally {
    await closeServer(server)
  }
})

test('a captionset on a dataset created empty covers 0/0 and recounts once media lands', async () => {
  const { server, url } = await createServer(new MemoryDatasets(), makeFakeActorum([]))
  try {
    const headers = { 'x-api-key': 'owner-1' }
    const created = await request(`${url}/v1/data/datasets`, {
      method: 'POST', headers, body: { name: 'Empty then captioned', modality: 'image' },
    })
    const id = created.body.dataset.id

    // Coverage over an empty media set is a truthful 0/0, not a division that reads as broken.
    const attached = await request(`${url}/v1/data/datasets/${id}/captionsets`, {
      method: 'POST', headers, body: { id: 'cs-1', name: 'First pass', method: 'manual' },
    })
    assert.equal(attached.status, 201)
    assert.equal(attached.body.dataset.captionsets[0].coverage, '0/0')

    const appended = await request(`${url}/v1/data/datasets/${id}/media`, {
      method: 'POST', headers, body: { source: 'upload', mediaUrls: ['https://r2.example/a.png'] },
    })
    assert.equal(appended.body.dataset.captionsets[0].coverage, '0/1')
  } finally {
    await closeServer(server)
  }
})

test("POST /v1/data/datasets still rejects a declared source that supplies no media", async () => {
  const { server, url } = await createServer(new MemoryDatasets(), makeFakeActorum([]))
  try {
    const headers = { 'x-api-key': 'owner-1' }
    // Declining to name a source is now allowed; naming one and then supplying nothing is not.
    const emptyUpload = await request(`${url}/v1/data/datasets`, {
      method: 'POST', headers, body: { source: 'upload', name: 'Nothing to upload', modality: 'image', mediaUrls: [] },
    })
    assert.equal(emptyUpload.status, 400)
    assert.equal(emptyUpload.body.error.code, 'input.malformed')

    const emptyGeneration = await request(`${url}/v1/data/datasets`, {
      method: 'POST', headers, body: { source: 'generation', name: 'Nothing to seed', modality: 'image', actumIds: [] },
    })
    assert.equal(emptyGeneration.status, 400)
    assert.equal(emptyGeneration.body.error.code, 'input.malformed')
  } finally {
    await closeServer(server)
  }
})

test('POST /v1/data/datasets rejects media fields supplied with no source rather than dropping them', async () => {
  const { server, url } = await createServer(new MemoryDatasets(), makeFakeActorum([]))
  try {
    const headers = { 'x-api-key': 'owner-1' }
    const withUrls = await request(`${url}/v1/data/datasets`, {
      method: 'POST', headers, body: { name: 'Media, no source', modality: 'image', mediaUrls: ['https://r2.example/a.png'] },
    })
    assert.equal(withUrls.status, 400)
    assert.equal(withUrls.body.error.code, 'input.malformed')

    const withActa = await request(`${url}/v1/data/datasets`, {
      method: 'POST', headers, body: { name: 'Acta, no source', modality: 'image', actumIds: ['actum-1'] },
    })
    assert.equal(withActa.status, 400)
    assert.equal(withActa.body.error.code, 'input.malformed')
  } finally {
    await closeServer(server)
  }
})

test('an empty create still requires a name and a valid modality', async () => {
  const { server, url } = await createServer(new MemoryDatasets(), makeFakeActorum([]))
  try {
    const headers = { 'x-api-key': 'owner-1' }
    const noName = await request(`${url}/v1/data/datasets`, {
      method: 'POST', headers, body: { modality: 'image' },
    })
    assert.equal(noName.status, 400)
    assert.equal(noName.body.error.code, 'input.malformed')

    const badModality = await request(`${url}/v1/data/datasets`, {
      method: 'POST', headers, body: { name: 'Unnameable modality', modality: 'telepathy' },
    })
    assert.equal(badModality.status, 400)
    assert.equal(badModality.body.error.code, 'input.malformed')
  } finally {
    await closeServer(server)
  }
})

test('POST /v1/data/datasets/:id/media still requires a source — an append always ingests', async () => {
  const { server, url } = await createServer(new MemoryDatasets(), makeFakeActorum([]))
  try {
    const headers = { 'x-api-key': 'owner-1' }
    const created = await request(`${url}/v1/data/datasets`, {
      method: 'POST', headers, body: { name: 'Append needs a source', modality: 'image' },
    })
    const id = created.body.dataset.id
    const res = await request(`${url}/v1/data/datasets/${id}/media`, {
      method: 'POST', headers, body: { mediaUrls: ['https://r2.example/a.png'] },
    })
    assert.equal(res.status, 400)
    assert.equal(res.body.error.code, 'input.malformed')
  } finally {
    await closeServer(server)
  }
})

test('a dataset created empty and shared with a team is contributable by a member', async () => {
  const teams = new MemorySodalitatum()
  const team = await teams.create({ nomen: 'Atelier', auctor: 'owner-1', membra: ['owner-1', 'member-2'] })
  const { server, url } = await createServer(new MemoryDatasets(), makeFakeActorum([]), teams)
  try {
    const created = await request(`${url}/v1/data/datasets`, {
      method: 'POST',
      headers: { 'x-api-key': 'owner-1' },
      body: { name: 'Shared and empty', modality: 'image', teamId: team.id },
    })
    assert.equal(created.status, 201)
    assert.equal(created.body.dataset.sodalitasId, team.id)
    assert.deepEqual(created.body.dataset.media, [])

    const contributed = await request(`${url}/v1/data/datasets/${created.body.dataset.id}/media`, {
      method: 'POST',
      headers: { 'x-api-key': 'member-2' },
      body: { source: 'upload', mediaUrls: ['https://r2.example/theirs.png'] },
    })
    assert.equal(contributed.status, 201)
    assert.equal(contributed.body.dataset.media.length, 1)
    assert.equal(contributed.body.dataset.media[0].addedBy, 'member-2')
  } finally {
    await closeServer(server)
  }
})

test('a stranger never sees another owner\'s datasets on either list route or get', async () => {
  // Extended for team sharing (noema-374): the owner holds a private dataset AND one shared
  // with a team. A stranger is in neither, and must still see nothing — the overlay adds the
  // named team's members as readers, it does not open the lists.
  const teams = new MemorySodalitatum()
  const team = await teams.create({ nomen: 'House look', auctor: 'owner-1', membra: ['owner-1'] })
  const { server, url } = await createServer(new MemoryDatasets(), makeFakeActorum([]), teams)
  try {
    const owner = { 'x-api-key': 'owner-1' }
    const stranger = { 'x-api-key': 'stranger-1' }
    const created = await request(`${url}/v1/data/datasets`, {
      method: 'POST',
      headers: owner,
      body: { source: 'upload', name: 'Mine', modality: 'image', mediaUrls: ['https://r2.example/a.png'] },
    })
    const id = created.body.dataset.id

    const shared = await request(`${url}/v1/data/datasets`, {
      method: 'POST',
      headers: owner,
      body: { source: 'upload', name: 'Ours', modality: 'image', mediaUrls: ['https://r2.example/b.png'], teamId: team.id },
    })
    assert.equal(shared.status, 201)
    assert.equal(shared.body.dataset.sodalitasId, team.id)

    const strangerFull = await request(`${url}/v1/data/datasets/full`, { headers: stranger })
    assert.equal(strangerFull.body.datasets.length, 0)
    const strangerSummary = await request(`${url}/v1/data/datasets`, { headers: stranger })
    assert.equal(strangerSummary.body.datasets.length, 0)

    const ownerFull = await request(`${url}/v1/data/datasets/full`, { headers: owner })
    assert.deepEqual((ownerFull.body.datasets as Dataset[]).map((d) => d.id).sort(), [id, shared.body.dataset.id].sort())
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
  // Extended for team sharing (noema-374): the dataset is shared with a team, and the stranger
  // is not in it. Captioning is contribution — a MEMBER may do it — so this asserts the gate
  // still closes for everyone else, on a dataset that is genuinely shared rather than private.
  const datasets = new MemoryDatasets()
  const teams = new MemorySodalitatum()
  const team = await teams.create({ nomen: 'House look', auctor: 'owner-1', membra: ['owner-1'] })
  const { server, url } = await createServer(datasets, makeFakeActorum([]), teams)
  try {
    const owner = { 'x-api-key': 'owner-1' }
    const stranger = { 'x-api-key': 'stranger-1' }
    const seeded = await request(`${url}/v1/data/datasets`, {
      method: 'POST',
      headers: owner,
      body: { source: 'upload', name: 'Captioned set', modality: 'image', mediaUrls: ['https://r2.example/a.png'], teamId: team.id },
    })
    assert.equal(seeded.status, 201)
    const ds = seeded.body.dataset as Dataset
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

// ── Archive + restore (noema-266) ────────────────────────────────────────────
//
// One test per non-vacuity claim of the archive design: an archived dataset leaves the two
// lists but is still resolvable, an archived media item leaves the working set and moves every
// captionset's stored coverage with it, both are restorable, and both routes scope to the
// authenticated caller.

test('an archived dataset is gone from list and listSummaries', async () => {
  const { server, url } = await createServer(new MemoryDatasets(), makeFakeActorum([]))
  try {
    const headers = { 'x-api-key': 'owner-1' }
    const kept = await seedDataset(url, headers, ['https://r2.example/keep.png'])
    const gone = await seedDataset(url, headers, ['https://r2.example/gone.png'])

    const archived = await request(`${url}/v1/data/datasets/${gone.id}/archive`, { method: 'POST', headers })
    assert.equal(archived.status, 200)
    assert.ok(archived.body.dataset.archivum, 'archive stamps a timestamp, not a boolean')

    const full = await request(`${url}/v1/data/datasets/full`, { headers })
    assert.deepEqual((full.body.datasets as Dataset[]).map((d) => d.id), [kept.id])

    const summaries = await request(`${url}/v1/data/datasets`, { headers })
    assert.deepEqual((summaries.body.datasets as Array<{ id: string }>).map((d) => d.id), [kept.id])
  } finally {
    await closeServer(server)
  }
})

test('an archived dataset is still returned by find, so nothing that referenced it breaks', async () => {
  const datasets = new MemoryDatasets()
  const { server, url } = await createServer(datasets, makeFakeActorum([]))
  try {
    const headers = { 'x-api-key': 'owner-1' }
    const ds = await seedDataset(url, headers, ['https://r2.example/a.png'])
    assert.equal((await request(`${url}/v1/data/datasets/${ds.id}/archive`, { method: 'POST', headers })).status, 200)

    // Archive is not erasure. `find` is the seam every reference resolves through — a Muse
    // session's mother dataset, a session dataset behind a saved piece, a past run's lineage.
    const found = await datasets.find(ds.id)
    assert.equal(found?.id, ds.id)
    assert.equal(found?.media.length, 1)
    assert.ok(found?.archivum)
  } finally {
    await closeServer(server)
  }
})

test('archiving media recomputes every captionset\'s coverage against the media that is left', async () => {
  const { server, url } = await createServer(new MemoryDatasets(), makeFakeActorum([]))
  try {
    const headers = { 'x-api-key': 'owner-1' }
    const ds = await seedDataset(url, headers, [
      'https://r2.example/a.png', 'https://r2.example/b.png', 'https://r2.example/c.png',
    ])
    const [a, b, c] = ds.media

    const attached = await request(`${url}/v1/data/datasets/${ds.id}/captionsets`, {
      method: 'POST',
      headers,
      body: { id: 'pass-1', name: 'natural language', method: 'manual', captions: { [a.id]: 'one' } },
    })
    assert.equal(attached.status, 201)
    assert.equal(attached.body.dataset.captionsets[0].coverage, '1/3')

    // Coverage is STORED, not derived at read time: an archive that skipped the recomputation
    // would leave this pass reading 1/3 against an image no longer in the set.
    const archivedB = await request(`${url}/v1/data/datasets/${ds.id}/media/${b.id}/archive`, { method: 'POST', headers })
    assert.equal(archivedB.status, 200)
    assert.equal(archivedB.body.dataset.captionsets[0].coverage, '1/2')

    // Archiving the captioned item moves the numerator too — the caption stays on the record
    // (it is keyed by media id) but it is not coverage of the working set.
    const archivedA = await request(`${url}/v1/data/datasets/${ds.id}/media/${a.id}/archive`, { method: 'POST', headers })
    assert.equal(archivedA.status, 200)
    assert.equal(archivedA.body.dataset.captionsets[0].coverage, '0/1')
    assert.equal(archivedA.body.dataset.captionsets[0].captions[a.id], 'one')

    // And the summary count is the live count, not the row count.
    const summaries = await request(`${url}/v1/data/datasets`, { headers })
    assert.equal(summaries.body.datasets[0].images, 1)
    assert.equal(summaries.body.datasets[0].id, ds.id)
    assert.equal(c.id, ds.media[2].id)
  } finally {
    await closeServer(server)
  }
})

test('an archived media item is absent from the media a reader is handed', async () => {
  const { server, url } = await createServer(new MemoryDatasets(), makeFakeActorum([]))
  try {
    const headers = { 'x-api-key': 'owner-1' }
    const ds = await seedDataset(url, headers, ['https://r2.example/a.png', 'https://r2.example/b.png'])

    const archived = await request(`${url}/v1/data/datasets/${ds.id}/media/${ds.media[0].id}/archive`, { method: 'POST', headers })
    assert.equal(archived.status, 200)

    const media = archived.body.dataset.media as DatasetMediaItem[]
    assert.equal(media.length, 2, 'the item stays on the record — caption maps and fragments are keyed on its id')
    assert.ok(media[0].archivum)
    assert.equal(media[1].archivum, undefined)
  } finally {
    await closeServer(server)
  }
})

test('an archived dataset and an archived media item can both be restored', async () => {
  const { server, url } = await createServer(new MemoryDatasets(), makeFakeActorum([]))
  try {
    const headers = { 'x-api-key': 'owner-1' }
    const ds = await seedDataset(url, headers, ['https://r2.example/a.png', 'https://r2.example/b.png'])
    const mediaId = ds.media[0].id

    assert.equal((await request(`${url}/v1/data/datasets/${ds.id}/media/${mediaId}/archive`, { method: 'POST', headers })).status, 200)
    assert.equal((await request(`${url}/v1/data/datasets/${ds.id}/archive`, { method: 'POST', headers })).status, 200)
    assert.equal((await request(`${url}/v1/data/datasets/full`, { headers })).body.datasets.length, 0)

    const restored = await request(`${url}/v1/data/datasets/${ds.id}/restore`, { method: 'POST', headers })
    assert.equal(restored.status, 200)
    assert.equal(restored.body.dataset.archivum, undefined, 'restore removes the field rather than flipping a second flag')

    const back = await request(`${url}/v1/data/datasets/full`, { headers })
    assert.equal(back.body.datasets.length, 1)
    assert.equal(back.body.datasets[0].id, ds.id)

    const restoredMedia = await request(`${url}/v1/data/datasets/${ds.id}/media/${mediaId}/restore`, { method: 'POST', headers })
    assert.equal(restoredMedia.status, 200)
    assert.equal((restoredMedia.body.dataset.media as DatasetMediaItem[])[0].archivum, undefined)

    const summaries = await request(`${url}/v1/data/datasets`, { headers })
    assert.equal(summaries.body.datasets[0].images, 2)
  } finally {
    await closeServer(server)
  }
})

test('archiving a dataset the caller does not own is refused', async () => {
  const { server, url } = await createServer(new MemoryDatasets(), makeFakeActorum([]))
  try {
    const owner = { 'x-api-key': 'owner-1' }
    const stranger = { 'x-api-key': 'stranger-1' }
    const ds = await seedDataset(url, owner, ['https://r2.example/a.png'])
    const mediaId = ds.media[0].id

    const attempt = await request(`${url}/v1/data/datasets/${ds.id}/archive`, { method: 'POST', headers: stranger })
    assert.equal(attempt.status, 404, 'a dataset the caller does not own reads as absent, not forbidden')

    const mediaAttempt = await request(`${url}/v1/data/datasets/${ds.id}/media/${mediaId}/archive`, { method: 'POST', headers: stranger })
    assert.equal(mediaAttempt.status, 404)

    const restoreAttempt = await request(`${url}/v1/data/datasets/${ds.id}/restore`, { method: 'POST', headers: stranger })
    assert.equal(restoreAttempt.status, 404)

    // A 404 can be returned AFTER a write — assert the dataset itself is untouched.
    const after = await request(`${url}/v1/data/datasets/full`, { headers: owner })
    assert.equal(after.body.datasets.length, 1)
    assert.equal(after.body.datasets[0].archivum, undefined)
    assert.equal((after.body.datasets[0].media as DatasetMediaItem[])[0].archivum, undefined)
  } finally {
    await closeServer(server)
  }
})

test('archiving a media id that names no item on the dataset is a 400', async () => {
  const { server, url } = await createServer(new MemoryDatasets(), makeFakeActorum([]))
  try {
    const headers = { 'x-api-key': 'owner-1' }
    const ds = await seedDataset(url, headers, ['https://r2.example/a.png'])

    const res = await request(`${url}/v1/data/datasets/${ds.id}/media/not-a-media-id/archive`, { method: 'POST', headers })
    assert.equal(res.status, 400)
    assert.equal(res.body.error.code, 'input.malformed')
  } finally {
    await closeServer(server)
  }
})

// ── Team sharing (noema-374) ─────────────────────────────────────────────────
//
// `Dataset.sodalitasId` — `Collectio.sodalitasId`'s overlay reused, not a second sharing
// vocabulary. One test per claim the design makes, and one per claim it deliberately does NOT
// make: a member reads, a member contributes and is recorded as having done so, the Actum gate
// does NOT widen with the dataset gate, the destructive verbs stay with the owner, and a
// non-member is closed out of every route on the surface.

/** Owner + one team + a dataset shared with it. `member-1` is in the team; `stranger-1` is not. */
async function seedSharedDataset(mediaUrls: string[] = ['https://r2.example/a.png'], signorum: unknown = fakeSignorum): Promise<{
  server: http.Server; url: string; api: CrystalApi; teamId: string; dataset: Dataset
}> {
  const teams = new MemorySodalitatum()
  const team = await teams.create({ nomen: 'House look', auctor: 'owner-1', membra: ['owner-1', 'member-1'] })
  const { server, url, api } = await createServer(new MemoryDatasets(), makeFakeActorum([]), teams, signorum)
  const created = await request(`${url}/v1/data/datasets`, {
    method: 'POST',
    headers: { 'x-api-key': 'owner-1' },
    body: { source: 'upload', name: 'House look', modality: 'image', mediaUrls, teamId: team.id },
  })
  assert.equal(created.status, 201, 'the shared dataset was created')
  return { server, url, api, teamId: team.id, dataset: created.body.dataset as Dataset }
}

test('creating a dataset with a teamId stores the team as an overlay, leaving owner a scalar', async () => {
  const { server, dataset, teamId } = await seedSharedDataset()
  try {
    assert.equal(dataset.owner, 'owner-1', 'the owner stays the single creating anima')
    assert.equal(dataset.sodalitasId, teamId, 'the team is recorded as an overlay beside it')
  } finally {
    await closeServer(server)
  }
})

test('a dataset cannot be shared with a team the caller does not belong to', async () => {
  const teams = new MemorySodalitatum()
  const other = await teams.create({ nomen: "Someone else's", auctor: 'owner-2', membra: ['owner-2'] })
  const datasets = new MemoryDatasets()
  const { server, url } = await createServer(datasets, makeFakeActorum([]), teams)
  try {
    const attempt = await request(`${url}/v1/data/datasets`, {
      method: 'POST',
      headers: { 'x-api-key': 'owner-1' },
      body: { source: 'upload', name: 'Not mine to share', modality: 'image', mediaUrls: ['https://r2.example/a.png'], teamId: other.id },
    })
    assert.equal(attempt.status, 404, 'a team the caller is not a member of reads as absent')

    const bogus = await request(`${url}/v1/data/datasets`, {
      method: 'POST',
      headers: { 'x-api-key': 'owner-1' },
      body: { source: 'upload', name: 'Nowhere', modality: 'image', mediaUrls: ['https://r2.example/a.png'], teamId: 'team-does-not-exist' },
    })
    assert.equal(bogus.status, 404)

    // Membership is affirmed before anything is minted — neither refusal left a dataset behind.
    assert.deepEqual((await datasets.list({ owner: 'owner-1' })).entries, [])
  } finally {
    await closeServer(server)
  }
})

test('a team member reads a shared dataset on both list routes and through getDataset', async () => {
  const { server, url, api, dataset } = await seedSharedDataset()
  try {
    const member = { 'x-api-key': 'member-1' }

    const full = await request(`${url}/v1/data/datasets/full`, { headers: member })
    assert.equal(full.status, 200)
    assert.deepEqual((full.body.datasets as Dataset[]).map((d) => d.id), [dataset.id])

    const summary = await request(`${url}/v1/data/datasets`, { headers: member })
    assert.equal(summary.status, 200)
    assert.deepEqual((summary.body.datasets as Array<{ id: string }>).map((d) => d.id), [dataset.id])

    // The id-resolving read itself, not only the lists it feeds.
    const resolved = await api.getDataset({ animaId: 'member-1' }, dataset.id)
    assert.equal(resolved.id, dataset.id)
    assert.equal(resolved.owner, 'owner-1', 'reading it does not make the member its owner')
  } finally {
    await closeServer(server)
  }
})

test('a team member contributes media to a shared dataset, and the item records who added it', async () => {
  const { server, url, dataset } = await seedSharedDataset()
  try {
    const member = { 'x-api-key': 'member-1' }
    const appended = await request(`${url}/v1/data/datasets/${dataset.id}/media`, {
      method: 'POST', headers: member, body: { source: 'upload', mediaUrls: ['https://r2.example/theirs.png'] },
    })
    assert.equal(appended.status, 201)

    const media = appended.body.dataset.media as DatasetMediaItem[]
    assert.equal(media.length, 2)
    assert.equal(media[1].url, 'https://r2.example/theirs.png')
    // Attribution is the point of the field: a shared set whose items all read as the owner's
    // cannot be audited, curated or credited.
    assert.equal(media[1].addedBy, 'member-1', "the contributor's anima id, not the owner's")
    assert.equal(media[0].addedBy, 'owner-1', 'and the seed media is still attributed to the owner')

    // The owner sees the contribution, and the dataset is still theirs.
    const ownerView = await request(`${url}/v1/data/datasets/full`, { headers: { 'x-api-key': 'owner-1' } })
    assert.equal((ownerView.body.datasets[0].media as DatasetMediaItem[]).length, 2)
    assert.equal(ownerView.body.datasets[0].owner, 'owner-1')
  } finally {
    await closeServer(server)
  }
})

test('a team member may caption a shared dataset', async () => {
  const { server, url, dataset } = await seedSharedDataset()
  try {
    const member = { 'x-api-key': 'member-1' }
    const mediaId = dataset.media[0].id

    const attached = await request(`${url}/v1/data/datasets/${dataset.id}/captionsets`, {
      method: 'POST', headers: member,
      body: { id: 'pass-1', name: 'nl', method: 'manual', captions: { [mediaId]: 'a knight in frost' } },
    })
    assert.equal(attached.status, 201)
    assert.equal(attached.body.dataset.captionsets[0].coverage, '1/1')

    const edited = await request(`${url}/v1/data/datasets/${dataset.id}/captionsets/pass-1/captions/${mediaId}`, {
      method: 'PATCH', headers: member, body: { caption: 'a knight at dusk' },
    })
    assert.equal(edited.status, 200)
    assert.equal(edited.body.dataset.captionsets[0].captions[mediaId], 'a knight at dusk')
  } finally {
    await closeServer(server)
  }
})

test('a contributing team member may seed only from their OWN completed run', async () => {
  // THE GATE THAT DOES NOT WIDEN. Sharing a dataset gives a member a place to put work; it
  // gives them no claim on anyone's runs. Both Acta below are completed and both are named
  // against the same shared dataset — only the caller's own is admitted.
  const mine: Actum = {
    id: 'actum-member', modusId: 'flux-schnell', modusVersiono: '1.0.0', impetus: 10n,
    signaConsumed: ['sig-of-member-1'], status: 'completus',
    exitus: { images: ['https://cdn.example/mine.png'] },
  } as unknown as Actum
  const theirs: Actum = {
    id: 'actum-owner', modusId: 'flux-schnell', modusVersiono: '1.0.0', impetus: 10n,
    signaConsumed: ['sig-of-owner-1'], status: 'completus',
    exitus: { images: ['https://cdn.example/theirs.png'] },
  } as unknown as Actum

  const teams = new MemorySodalitatum()
  const team = await teams.create({ nomen: 'House look', auctor: 'owner-1', membra: ['owner-1', 'member-1'] })
  const { server, url } = await createServer(new MemoryDatasets(), makeFakeActorum([mine, theirs]), teams, attributingSignorum)
  try {
    const owner = { 'x-api-key': 'owner-1' }
    const member = { 'x-api-key': 'member-1' }
    const created = await request(`${url}/v1/data/datasets`, {
      method: 'POST', headers: owner,
      body: { source: 'upload', name: 'House look', modality: 'image', mediaUrls: ['https://r2.example/a.png'], teamId: team.id },
    })
    assert.equal(created.status, 201)
    const id = created.body.dataset.id

    const own = await request(`${url}/v1/data/datasets/${id}/media`, {
      method: 'POST', headers: member, body: { source: 'generation', actumIds: ['actum-member'] },
    })
    assert.equal(own.status, 201, "a member's own completed run is admitted")
    assert.equal((own.body.dataset.media as DatasetMediaItem[])[1].actumId, 'actum-member')
    assert.equal((own.body.dataset.media as DatasetMediaItem[])[1].addedBy, 'member-1')

    const notTheirs = await request(`${url}/v1/data/datasets/${id}/media`, {
      method: 'POST', headers: member, body: { source: 'generation', actumIds: ['actum-owner'] },
    })
    assert.equal(notTheirs.status, 404, "the owner's run is not the member's to contribute")

    // And the refusal reached nothing: the dataset still holds only the seed and the member's own.
    const after = await request(`${url}/v1/data/datasets/full`, { headers: owner })
    assert.equal((after.body.datasets[0].media as DatasetMediaItem[]).length, 2)
  } finally {
    await closeServer(server)
  }
})

test('a team member may not archive or restore a shared dataset, or its media', async () => {
  // The destructive verbs stay with the scalar owner: the overlay adds readers and
  // contributors, not a second principal who may retire the owner's set. A member gets the
  // same not_found a stranger gets, so the narrower refusal leaks nothing either.
  const { server, url, dataset } = await seedSharedDataset(['https://r2.example/a.png'])
  try {
    const member = { 'x-api-key': 'member-1' }
    const mediaId = dataset.media[0].id

    assert.equal((await request(`${url}/v1/data/datasets/${dataset.id}/archive`, { method: 'POST', headers: member })).status, 404)
    assert.equal((await request(`${url}/v1/data/datasets/${dataset.id}/restore`, { method: 'POST', headers: member })).status, 404)
    assert.equal((await request(`${url}/v1/data/datasets/${dataset.id}/media/${mediaId}/archive`, { method: 'POST', headers: member })).status, 404)
    assert.equal((await request(`${url}/v1/data/datasets/${dataset.id}/media/${mediaId}/restore`, { method: 'POST', headers: member })).status, 404)

    // A 404 can be returned AFTER a write — assert nothing was stamped.
    const after = await request(`${url}/v1/data/datasets/full`, { headers: { 'x-api-key': 'owner-1' } })
    assert.equal(after.body.datasets.length, 1)
    assert.equal(after.body.datasets[0].archivum, undefined)
    assert.equal((after.body.datasets[0].media as DatasetMediaItem[])[0].archivum, undefined)

    // The owner can still do it — the refusal above is about WHO, not a route that stopped working.
    assert.equal((await request(`${url}/v1/data/datasets/${dataset.id}/archive`, { method: 'POST', headers: { 'x-api-key': 'owner-1' } })).status, 200)
  } finally {
    await closeServer(server)
  }
})

test('a NON-member is refused on every dataset route of a team-shared dataset', async () => {
  // The closure assertion, restated against a dataset that is genuinely shared rather than
  // private: sharing with a named fellowship is not publishing. Every route on the surface,
  // read and write, and always not_found rather than forbidden so ids stay non-enumerable.
  const { server, url, api, dataset } = await seedSharedDataset(['https://r2.example/a.png'])
  try {
    const stranger = { 'x-api-key': 'stranger-1' }
    const id = dataset.id
    const mediaId = dataset.media[0].id

    // Both list routes.
    assert.deepEqual((await request(`${url}/v1/data/datasets/full`, { headers: stranger })).body.datasets, [])
    assert.deepEqual((await request(`${url}/v1/data/datasets`, { headers: stranger })).body.datasets, [])

    // The id-resolving read.
    await assert.rejects(
      () => api.getDataset({ animaId: 'stranger-1' }, id),
      (e: unknown) => (e as { code?: string }).code === 'not_found.dataset',
    )

    // Every write.
    const refusals: Array<[string, HttpResult]> = [
      ['media', await request(`${url}/v1/data/datasets/${id}/media`, { method: 'POST', headers: stranger, body: { source: 'upload', mediaUrls: ['https://r2.example/theirs.png'] } })],
      ['captionsets', await request(`${url}/v1/data/datasets/${id}/captionsets`, { method: 'POST', headers: stranger, body: { id: 'p', name: 'n', method: 'manual' } })],
      ['caption edit', await request(`${url}/v1/data/datasets/${id}/captionsets/p/captions/${mediaId}`, { method: 'PATCH', headers: stranger, body: { caption: 'theirs' } })],
      ['archive', await request(`${url}/v1/data/datasets/${id}/archive`, { method: 'POST', headers: stranger })],
      ['restore', await request(`${url}/v1/data/datasets/${id}/restore`, { method: 'POST', headers: stranger })],
      ['media archive', await request(`${url}/v1/data/datasets/${id}/media/${mediaId}/archive`, { method: 'POST', headers: stranger })],
      ['media restore', await request(`${url}/v1/data/datasets/${id}/media/${mediaId}/restore`, { method: 'POST', headers: stranger })],
    ]
    for (const [route, res] of refusals) {
      assert.equal(res.status, 404, `${route}: a non-member reads as absent, not forbidden`)
      assert.equal(res.body.error.code, 'not_found.dataset', `${route}: not_found, never forbidden`)
    }

    // A 404 can be returned AFTER a write — the dataset is exactly as the owner left it.
    const after = await request(`${url}/v1/data/datasets/full`, { headers: { 'x-api-key': 'owner-1' } })
    assert.equal(after.body.datasets.length, 1)
    assert.equal((after.body.datasets[0].media as DatasetMediaItem[]).length, 1)
    assert.equal(after.body.datasets[0].captionsets.length, 0)
    assert.equal(after.body.datasets[0].archivum, undefined)
  } finally {
    await closeServer(server)
  }
})

test('an unshared dataset stays owner-only even for a team-mate of the owner', async () => {
  // The overlay is opt-in per dataset, not per person: being in a team with someone does not
  // open the datasets they did NOT share with it. This is what keeps `sodalitasId: undefined`
  // — every dataset written before this field existed — closed.
  const teams = new MemorySodalitatum()
  await teams.create({ nomen: 'House look', auctor: 'owner-1', membra: ['owner-1', 'member-1'] })
  const { server, url, api } = await createServer(new MemoryDatasets(), makeFakeActorum([]), teams)
  try {
    const created = await request(`${url}/v1/data/datasets`, {
      method: 'POST', headers: { 'x-api-key': 'owner-1' },
      body: { source: 'upload', name: 'Private', modality: 'image', mediaUrls: ['https://r2.example/a.png'] },
    })
    assert.equal(created.status, 201)
    assert.equal(created.body.dataset.sodalitasId, undefined, 'no teamId means no overlay')

    const member = { 'x-api-key': 'member-1' }
    assert.deepEqual((await request(`${url}/v1/data/datasets/full`, { headers: member })).body.datasets, [])
    assert.deepEqual((await request(`${url}/v1/data/datasets`, { headers: member })).body.datasets, [])
    await assert.rejects(
      () => api.getDataset({ animaId: 'member-1' }, created.body.dataset.id),
      (e: unknown) => (e as { code?: string }).code === 'not_found.dataset',
    )
    const append = await request(`${url}/v1/data/datasets/${created.body.dataset.id}/media`, {
      method: 'POST', headers: member, body: { source: 'upload', mediaUrls: ['https://r2.example/theirs.png'] },
    })
    assert.equal(append.status, 404)
  } finally {
    await closeServer(server)
  }
})

test('removing a member from the team closes the dataset to them again', async () => {
  // Membership is read live off the Sodalitas, never snapshotted onto the dataset — that is
  // what makes the team store the single source of who may read, and what makes a removal
  // take effect without touching every dataset the team shares.
  const teams = new MemorySodalitatum()
  const team = await teams.create({ nomen: 'House look', auctor: 'owner-1', membra: ['owner-1', 'member-1'] })
  const { server, url } = await createServer(new MemoryDatasets(), makeFakeActorum([]), teams)
  try {
    const created = await request(`${url}/v1/data/datasets`, {
      method: 'POST', headers: { 'x-api-key': 'owner-1' },
      body: { source: 'upload', name: 'House look', modality: 'image', mediaUrls: ['https://r2.example/a.png'], teamId: team.id },
    })
    assert.equal(created.status, 201)
    const member = { 'x-api-key': 'member-1' }
    assert.equal((await request(`${url}/v1/data/datasets/full`, { headers: member })).body.datasets.length, 1)

    await teams.update(team.id, { membra: ['owner-1'] })

    assert.deepEqual((await request(`${url}/v1/data/datasets/full`, { headers: member })).body.datasets, [])
    const append = await request(`${url}/v1/data/datasets/${created.body.dataset.id}/media`, {
      method: 'POST', headers: member, body: { source: 'upload', mediaUrls: ['https://r2.example/theirs.png'] },
    })
    assert.equal(append.status, 404)
  } finally {
    await closeServer(server)
  }
})

test('a deployment with no team store wired shares nothing and refuses a teamId', async () => {
  // FAIL CLOSED. With no `sodalitatum` dep there is nothing that can affirm membership, so the
  // overlay grants no read at all — the convention `_ownedStudio` follows with no Conductor.
  const datasets = new MemoryDatasets()
  const { server, url, api } = await createServer(datasets, makeFakeActorum([]))
  try {
    const refused = await request(`${url}/v1/data/datasets`, {
      method: 'POST', headers: { 'x-api-key': 'owner-1' },
      body: { source: 'upload', name: 'Shared', modality: 'image', mediaUrls: ['https://r2.example/a.png'], teamId: 'team-1' },
    })
    assert.equal(refused.status, 404, 'a team cannot be named when no team store can affirm it')

    // A dataset already carrying an overlay is unreadable by a would-be member, not readable.
    const stored = await datasets.create({
      owner: 'owner-1', sodalitasId: 'team-1', name: 'Legacy shared', modality: 'image', custody: 'local',
      media: [], captionsets: [], versions: [],
    })
    await assert.rejects(
      () => api.getDataset({ animaId: 'member-1' }, stored.id),
      (e: unknown) => (e as { code?: string }).code === 'not_found.dataset',
    )
    assert.deepEqual((await request(`${url}/v1/data/datasets/full`, { headers: { 'x-api-key': 'member-1' } })).body.datasets, [])
  } finally {
    await closeServer(server)
  }
})

// =============================================================================
// Private-output media
// =============================================================================
//
// A run with private outputs records its media as an opaque `noema-private://<key>` marker
// rather than a fetchable URL (`src/crystal/MediaFetcher.ts`). These cover the two halves of
// carrying such a run into a dataset: the MINT admits the marker as a media reference, and the
// READ resolves it into a short-lived link behind the same ownership gate the run read uses.
//
// What is STORED is the marker, deliberately: a presigned link lapses in minutes and a dataset
// is durable, so persisting one would write a reference that dies while the record still lives.
// Every assertion below therefore checks the stored record and the served record separately.

/** A completed run whose exitus carries private markers. */
function privateActum(id: string, keys: string[], signum?: string): Actum {
  return {
    id,
    modusId: 'flux-schnell',
    modusVersiono: '1.0.0',
    impetus: 10n,
    signaConsumed: signum ? [signum] : [],
    status: 'completus',
    exitus: { images: keys.map((k) => privateMarker(k)) },
  } as unknown as Actum
}

test('a completed run whose exitus carries a private marker ingests, storing the marker and serving a link', async () => {
  const datasets = new MemoryDatasets()
  const priv = fakePrivateOutputs()
  const actum = privateActum('actum-private', ['private-outputs/abc123/one.png'])
  const { server, url } = await createServer(datasets, makeFakeActorum([actum]), undefined, fakeSignorum, priv.cfg)
  try {
    const headers = { 'x-api-key': 'owner-1' }
    const created = await request(`${url}/v1/data/datasets`, {
      method: 'POST',
      headers,
      body: { source: 'generation', name: 'Private set', modality: 'image', actumIds: ['actum-private'] },
    })
    assert.equal(created.status, 201, 'a private-marker exitus is media, not an empty run')
    const served = created.body.dataset.media as DatasetMediaItem[]
    assert.equal(served.length, 1)
    assert.equal(served[0].source, 'generation')
    assert.equal(served[0].actumId, 'actum-private')
    assert.equal(served[0].url, 'https://private.example/private-outputs/abc123/one.png?X-Amz-Signature=deadbeef')

    // The RECORD keeps the durable reference — the link the caller was handed is a view of it.
    const stored = await datasets.find(created.body.dataset.id)
    assert.ok(stored)
    assert.equal(stored.media[0].url, privateMarker('private-outputs/abc123/one.png'))
    assert.deepEqual(priv.signed, ['private-outputs/abc123/one.png'])
  } finally {
    await closeServer(server)
  }
})

test('a mixed exitus carries both its public URL and its private marker into the dataset', async () => {
  const datasets = new MemoryDatasets()
  const priv = fakePrivateOutputs()
  const actum: Actum = {
    id: 'actum-mixed',
    modusId: 'flux-schnell',
    modusVersiono: '1.0.0',
    impetus: 10n,
    signaConsumed: [],
    status: 'completus',
    exitus: { images: ['https://cdn.example/public.png', privateMarker('private-outputs/abc123/two.png')] },
  } as unknown as Actum
  const { server, url } = await createServer(datasets, makeFakeActorum([actum]), undefined, fakeSignorum, priv.cfg)
  try {
    const created = await request(`${url}/v1/data/datasets`, {
      method: 'POST',
      headers: { 'x-api-key': 'owner-1' },
      body: { source: 'generation', name: 'Mixed set', modality: 'image', actumIds: ['actum-mixed'] },
    })
    assert.equal(created.status, 201)
    const served = created.body.dataset.media as DatasetMediaItem[]
    assert.equal(served.length, 2, 'both references are media')
    assert.equal(served[0].url, 'https://cdn.example/public.png', 'a public URL passes through untouched')
    assert.equal(served[1].url, 'https://private.example/private-outputs/abc123/two.png?X-Amz-Signature=deadbeef')

    const stored = await datasets.find(created.body.dataset.id)
    assert.ok(stored)
    assert.deepEqual(stored.media.map((m) => m.url), [
      'https://cdn.example/public.png',
      privateMarker('private-outputs/abc123/two.png'),
    ])
    assert.deepEqual(priv.signed, ['private-outputs/abc123/two.png'], 'only the marker is presigned')
  } finally {
    await closeServer(server)
  }
})

test('POST /v1/data/datasets/:id/media appends a private-marker run to an existing dataset', async () => {
  const datasets = new MemoryDatasets()
  const priv = fakePrivateOutputs()
  const actum = privateActum('actum-private', ['private-outputs/abc123/three.png'])
  const { server, url } = await createServer(datasets, makeFakeActorum([actum]), undefined, fakeSignorum, priv.cfg)
  try {
    const headers = { 'x-api-key': 'owner-1' }
    const created = await request(`${url}/v1/data/datasets`, {
      method: 'POST',
      headers,
      body: { source: 'upload', name: 'Growing set', modality: 'image', mediaUrls: ['https://r2.example/a.png'] },
    })
    assert.equal(created.status, 201)
    const id = created.body.dataset.id

    const appended = await request(`${url}/v1/data/datasets/${id}/media`, {
      method: 'POST', headers, body: { source: 'generation', actumIds: ['actum-private'] },
    })
    assert.equal(appended.status, 201)
    const served = appended.body.dataset.media as DatasetMediaItem[]
    assert.equal(served.length, 2)
    assert.equal(served[1].url, 'https://private.example/private-outputs/abc123/three.png?X-Amz-Signature=deadbeef')

    const stored = await datasets.find(id)
    assert.ok(stored)
    assert.equal(stored.media[1].url, privateMarker('private-outputs/abc123/three.png'))
  } finally {
    await closeServer(server)
  }
})

test('a stored private marker is resolved on every owner-scoped dataset read', async () => {
  const datasets = new MemoryDatasets()
  const priv = fakePrivateOutputs()
  const actum = privateActum('actum-private', ['private-outputs/abc123/four.png'])
  const { server, url, api } = await createServer(datasets, makeFakeActorum([actum]), undefined, fakeSignorum, priv.cfg)
  try {
    const headers = { 'x-api-key': 'owner-1' }
    const created = await request(`${url}/v1/data/datasets`, {
      method: 'POST',
      headers,
      body: { source: 'generation', name: 'Private set', modality: 'image', actumIds: ['actum-private'] },
    })
    assert.equal(created.status, 201)
    const expected = 'https://private.example/private-outputs/abc123/four.png?X-Amz-Signature=deadbeef'

    // The full listing — what a person's own dataset screen renders.
    const full = await request(`${url}/v1/data/datasets/full`, { headers })
    assert.equal(full.status, 200)
    assert.equal((full.body.datasets[0].media as DatasetMediaItem[])[0].url, expected)

    // And the single-dataset read every contribute verb and the MCP dataset tool resolve through.
    const one = await api.getDataset({ animaId: 'owner-1' }, created.body.dataset.id)
    assert.equal(one.media[0].url, expected)

    // Resolution is a projection, never a write-back: the record still holds the marker.
    const stored = await datasets.find(created.body.dataset.id)
    assert.ok(stored)
    assert.ok(isPrivateMarker(stored.media[0].url))
  } finally {
    await closeServer(server)
  }
})

test('an unresolvable private marker is served as the opaque marker, never as a public URL', async () => {
  // Two deployments that cannot presign: one with no private-outputs store wired at all, one
  // whose store refuses. Both leave the marker exactly as stored. Degrading to a marker is
  // correct — the object sits in a bucket with no public binding, so a URL built from the key
  // would be a broken link that also reads as public.
  for (const priv of [undefined, fakePrivateOutputs({ refuse: true }).cfg]) {
    const datasets = new MemoryDatasets()
    const actum = privateActum('actum-private', ['private-outputs/abc123/five.png'])
    const { server, url } = await createServer(datasets, makeFakeActorum([actum]), undefined, fakeSignorum, priv)
    try {
      const headers = { 'x-api-key': 'owner-1' }
      const created = await request(`${url}/v1/data/datasets`, {
        method: 'POST',
        headers,
        body: { source: 'generation', name: 'Private set', modality: 'image', actumIds: ['actum-private'] },
      })
      assert.equal(created.status, 201, 'ingestion does not depend on being able to presign')
      const served = (created.body.dataset.media as DatasetMediaItem[])[0]
      assert.equal(served.url, privateMarker('private-outputs/abc123/five.png'))
      assert.ok(!/^https?:\/\//.test(served.url), 'never degraded to a public URL')
    } finally {
      await closeServer(server)
    }
  }
})

test('a private marker does not widen the ownership gate — a stranger\'s run is still not found', async () => {
  // The scheme check widened; the authorization check did not. Both runs below are completed
  // and both carry a private marker — only the caller's own is reachable.
  const mine = privateActum('actum-mine', ['private-outputs/aaa/mine.png'], 'sig-of-owner-1')
  const theirs = privateActum('actum-theirs', ['private-outputs/bbb/theirs.png'], 'sig-of-stranger-1')
  const priv = fakePrivateOutputs()
  const { server, url } = await createServer(
    new MemoryDatasets(), makeFakeActorum([mine, theirs]), undefined, attributingSignorum, priv.cfg,
  )
  try {
    const headers = { 'x-api-key': 'owner-1' }
    const refused = await request(`${url}/v1/data/datasets`, {
      method: 'POST',
      headers,
      body: { source: 'generation', name: 'Not mine', modality: 'image', actumIds: ['actum-theirs'] },
    })
    assert.equal(refused.status, 404)
    assert.equal(refused.body.error.code, 'not_found.run')
    assert.deepEqual(priv.signed, [], 'a refused run is never presigned')

    const own = await request(`${url}/v1/data/datasets`, {
      method: 'POST',
      headers,
      body: { source: 'generation', name: 'Mine', modality: 'image', actumIds: ['actum-mine'] },
    })
    assert.equal(own.status, 201)
  } finally {
    await closeServer(server)
  }
})

test('the empty-media refusal names the condition that fired it', async () => {
  // A completed run whose exitus holds neither an http(s) URL nor a private marker is what
  // actually produces no media, so the sentence says exactly that.
  const actum: Actum = {
    id: 'actum-nothing',
    modusId: 'llm-chat',
    modusVersiono: '1.0.0',
    impetus: 10n,
    signaConsumed: [],
    status: 'completus',
    exitus: { text: 'a paragraph, not an image' },
  } as unknown as Actum
  const { server, url } = await createServer(new MemoryDatasets(), makeFakeActorum([actum]))
  try {
    const res = await request(`${url}/v1/data/datasets`, {
      method: 'POST',
      headers: { 'x-api-key': 'owner-1' },
      body: { source: 'generation', name: 'Empty', modality: 'image', actumIds: ['actum-nothing'] },
    })
    assert.equal(res.status, 400)
    assert.equal(res.body.error.code, 'input.malformed')
    assert.match(res.body.error.message, /media reference/)
    assert.match(res.body.error.message, /private-output marker/)
  } finally {
    await closeServer(server)
  }
})
