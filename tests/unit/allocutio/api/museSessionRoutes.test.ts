// =============================================================================
// Muse session HTTP surface — the save-back seam (hermetic route + facade test)
// =============================================================================
//
// Real `CrystalApi` + real `createApiRouter` over in-memory doubles, no live
// Mongo — the shape `datasetsRoutes.test.ts` established. It gets a file of its
// own rather than joining that one because the surface under test is the Muse
// SESSION, not the dataset: the dataset is where a save lands, but every call
// here goes through a session route.
//
// The four claims this file is gated on, each one a product decision that would
// otherwise be provable only by reading the code:
//
//   1. SAVING RUNS NO JOB AND SPENDS NOTHING. A generated piece does not need
//      decomposing: it was composed FROM fragments, so the lineage the ledger
//      recorded at fire time is already its tagging and a save is a set
//      insertion. The Actum double refuses to create a run, so a save path that
//      fired a caption or decompose pass reds this file.
//
//   2. A SAVED PIECE CARRIES THE FRAGMENTS IT WAS GENERATED FROM. The lineage
//      lands on the new media item as its `fragments`.
//
//   3. A SAVE LANDS ON THE SESSION VERSION, NEVER THE MOTHER (S7, S13). The
//      mother's stored record is compared before and after; the session's own
//      dataset is minted by the first save and appended to by the second.
//
//   4. SAVING A PIECE ADDS NO FRAGMENT THE FLOOR DID NOT ALREADY HAVE. A piece
//      is assembled from live fragments, so a save that introduced one would
//      mean the lineage and the floor had drifted apart.
//
// The doubles here implement their whole interface. A fake that declares
// `implements X` while omitting a method is not caught by `npm run typecheck` —
// `tsconfig.json` includes `src/**/*` only, and the runner strips types — so the
// completeness is the author's to keep, not the compiler's.
// =============================================================================

import { test } from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import express from 'express'

import { CrystalApi, type CrystalApiDeps } from '../../../../src/allocutio/api/CrystalApi.js'
import { createApiRouter, type Identity } from '../../../../src/allocutio/api/apiRouter.js'
import { Errors } from '../../../../src/allocutio/api/errors.js'
import { captionCoverage, nextDatasetVersion } from '../../../../src/types/dataset.js'
import type {
  Captionset, Dataset, DatasetListOpts, DatasetListPage, DatasetMediaItem,
  Datasets, DatasetSummaryListPage,
} from '../../../../src/types/dataset.js'
import type {
  CreateMuseSessionInput, MuseSessions, StoredMuseSession,
} from '../../../../src/types/museSession.js'
import type { MuseSession } from '../../../../src/crystal/muse/session.js'
import type { Fragment } from '../../../../src/crystal/muse/taxonomy.js'
import type { Actum, Actorum } from '../../../../src/types/cursus.js'
import type { AuctorKey } from '../../../../src/flow/types.js'
import type { Credentials } from '../../../../src/allocutio/api/IdentityResolver.js'

// ── Doubles ──────────────────────────────────────────────────────────────────

/** The whole `Datasets` surface, with MongoDataset's semantics and no I/O. */
class MemoryDatasets implements Datasets {
  store = new Map<string, Dataset>()
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
    return {
      entries: entries.map((d) => ({
        id: d.id, name: d.name, images: d.media.length, updatedAt: d.mutatum.toISOString(),
      })),
    }
  }
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
  async setCaption(datasetId: string, captionsetId: string, mediaId: string, caption: string): Promise<Dataset | null> {
    const d = this.store.get(datasetId)
    if (!d) return null
    const target = d.captionsets.find((c) => c.id === captionsetId)
    if (!target) return null
    const captions = { ...(target.captions ?? {}), [mediaId]: caption }
    const next: Captionset = { ...target, captions, coverage: captionCoverage(captions, d.media.length) }
    const updated: Dataset = {
      ...d,
      captionsets: d.captionsets.map((c) => (c.id === captionsetId ? next : c)),
      mutatum: new Date(),
    }
    this.store.set(datasetId, updated)
    return updated
  }
  // Same semantics as MongoDataset.setFragments: keyed by media id, never positional;
  // an unknown dataset or media id is null rather than an implicit create.
  async setFragments(datasetId: string, mediaId: string, fragments: Fragment[]): Promise<Dataset | null> {
    const d = this.store.get(datasetId)
    if (!d) return null
    if (!d.media.some((m) => m.id === mediaId)) return null
    const updated: Dataset = {
      ...d,
      media: d.media.map((m) => (m.id === mediaId ? { ...m, fragments: [...fragments] } : m)),
      mutatum: new Date(),
    }
    this.store.set(datasetId, updated)
    return updated
  }
}

/** The whole `MuseSessions` surface, in memory. */
class MemoryMuseSessions implements MuseSessions {
  store = new Map<string, StoredMuseSession>()
  private seq = 0

  async create(input: CreateMuseSessionInput): Promise<StoredMuseSession> {
    const now = new Date()
    const full: StoredMuseSession = {
      id: `sess-${++this.seq}`, owner: input.owner, session: input.session, natum: now, mutatum: now,
    }
    this.store.set(full.id, full)
    return full
  }
  async find(id: string): Promise<StoredMuseSession | null> { return this.store.get(id) ?? null }
  async listByOwner(owner: string, motherDatasetId: string): Promise<StoredMuseSession[]> {
    return [...this.store.values()]
      .filter((s) => s.owner === owner && s.session.motherDatasetId === motherDatasetId)
      .sort((a, b) => b.mutatum.getTime() - a.mutatum.getTime())
  }
  async save(id: string, session: MuseSession): Promise<StoredMuseSession | null> {
    const stored = this.store.get(id)
    if (!stored) return null
    const next: StoredMuseSession = { ...stored, session, mutatum: new Date() }
    this.store.set(id, next)
    return next
  }
}

/**
 * An Actorum that can be READ and never written.
 *
 * `create` and `update` throw: a run is how this product spends, so a save path that
 * launched a caption or a decompose pass — the thing rth's ruling says is unnecessary,
 * because the piece is already tagged — fails here rather than passing quietly.
 */
function readOnlyActorum(seed: Actum[]): Actorum {
  const byId = new Map<string, Actum>(seed.map((a) => [a.id, a]))
  return {
    async create() { throw new Error('a save must not create a run') },
    async update() { throw new Error('a save must not touch a run') },
    async findById(id: string) { return byId.get(id) ?? null },
    async findByExternusJobId() { return null },
    async findByNullifier() { return null },
    async findExpired() { return [] },
    async findInFlight() { return [] },
    async findByCompositum() { return [] },
  } as unknown as Actorum
}

/** Spending is a reservation against the ledger; nothing in this surface may make one. */
const noSpendSignorum = {
  async ownsAny() { return true },
  async reserve() { throw new Error('a save must not reserve impetus') },
  async settle() { throw new Error('a save must not settle a spend') },
}

const fakeIdentity: Identity = {
  async resolve(creds: Credentials): Promise<AuctorKey> {
    if (creds.apiKey) return { animaId: creds.apiKey }
    throw Errors.authMissing()
  },
}

function createServer(
  datasets: Datasets, museSessions: MuseSessions, actorum: Actorum,
): Promise<{ server: http.Server; url: string }> {
  const deps = { datasets, museSessions, actorum, signorum: noSpendSignorum } as unknown as CrystalApiDeps
  const api = new CrystalApi(deps)
  return new Promise((resolveP, reject) => {
    const app = express()
    app.use(express.json())
    app.use('/v1', createApiRouter({
      api: api as unknown as ConstructorParameters<typeof createApiRouter>[0]['api'],
      identity: fakeIdentity,
    }))
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

// ── Fixtures ─────────────────────────────────────────────────────────────────
// Invented content throughout: a moodboard of imaginary phrases and example.invalid
// URLs. Nothing here is lifted from a real record.

const OWNER = 'owner-1'
const HEADERS = { 'x-api-key': OWNER }

const FRAGMENTS: Fragment[] = [
  { category: 'subject', text: 'a lantern-keeper', source: 'board-a', trigger: 'trigword' },
  { category: 'style', text: 'ink wash', source: 'board-a', trigger: 'trigword' },
  { category: 'lighting', text: 'dusk glow', source: 'board-b', trigger: '' },
]

function completedRun(id: string, url: string): Actum {
  return {
    id,
    modusId: 'a-t2i-flow',
    modusVersiono: '1.0.0',
    impetus: 10n,
    signaConsumed: [],
    status: 'completus',
    exitus: { images: [url] },
  } as unknown as Actum
}

async function seedMother(datasets: MemoryDatasets): Promise<Dataset> {
  return datasets.create({
    owner: OWNER,
    name: 'Lantern board',
    modality: 'image',
    custody: 'local',
    media: [{
      id: 'media-seed',
      url: 'https://example.invalid/seed.png',
      source: 'upload',
      addedAt: new Date(),
      fragments: FRAGMENTS,
    }],
    captionsets: [],
    versions: [{ v: '1.0.0', count: 1, when: new Date() }],
  })
}

/** Spawn a session off the mother and record one piece in it, with its lineage. */
async function sessionWithPiece(url: string, motherId: string, runId: string) {
  const spawned = await request(`${url}/v1/data/muse/sessions`, {
    method: 'POST', headers: HEADERS, body: { datasetId: motherId },
  })
  assert.equal(spawned.status, 201)
  const sessionId: string = spawned.body.session.id

  const recorded = await request(`${url}/v1/data/muse/sessions/${sessionId}/pieces`, {
    method: 'POST',
    headers: HEADERS,
    body: {
      runId,
      rollIndex: 0,
      fragments: FRAGMENTS.map((f) => ({ category: f.category, text: f.text })),
    },
  })
  assert.equal(recorded.status, 201)
  return { sessionId, session: recorded.body.session }
}

// ── PROOF 1: a save runs no job and spends nothing ───────────────────────────

test('saving a piece runs no job and spends nothing', async () => {
  const datasets = new MemoryDatasets()
  const mother = await seedMother(datasets)
  // Every write path on the run store and the ledger throws. A save that fired a caption
  // or a decompose pass — or reserved impetus for one — cannot reach a 201 here.
  const { server, url } = await createServer(
    datasets, new MemoryMuseSessions(), readOnlyActorum([completedRun('run-1', 'https://example.invalid/piece-1.png')]),
  )
  try {
    const { sessionId } = await sessionWithPiece(url, mother.id, 'run-1')
    const saved = await request(`${url}/v1/data/muse/sessions/${sessionId}/pieces/run-1/save`, {
      method: 'POST', headers: HEADERS,
    })
    assert.equal(saved.status, 201, `a save must not need a run: ${JSON.stringify(saved.body)}`)
    assert.equal(saved.body.session.pieces[0].saved, true, 'the ledger entry records that the piece went back in')
  } finally {
    await closeServer(server)
  }
})

// ── PROOF 2: the saved media carries the piece's lineage ─────────────────────

test('a saved piece carries the fragments it was generated from', async () => {
  const datasets = new MemoryDatasets()
  const mother = await seedMother(datasets)
  const { server, url } = await createServer(
    datasets, new MemoryMuseSessions(), readOnlyActorum([completedRun('run-1', 'https://example.invalid/piece-1.png')]),
  )
  try {
    const { sessionId } = await sessionWithPiece(url, mother.id, 'run-1')
    const saved = await request(`${url}/v1/data/muse/sessions/${sessionId}/pieces/run-1/save`, {
      method: 'POST', headers: HEADERS,
    })
    assert.equal(saved.status, 201)

    const sessionDatasetId: string = saved.body.session.sessionDatasetId
    assert.ok(sessionDatasetId, 'the session names the dataset its saves land in')
    const target = datasets.store.get(sessionDatasetId)!
    assert.equal(target.media.length, 1)
    // The url is the run's own output, resolved server-side — nothing was supplied by the caller.
    assert.equal(target.media[0].url, 'https://example.invalid/piece-1.png')
    assert.equal(target.media[0].source, 'generation')
    assert.equal(target.media[0].actumId, 'run-1')
    assert.deepEqual(
      (target.media[0].fragments ?? []).map((f) => ({ category: f.category, text: f.text })),
      FRAGMENTS.map((f) => ({ category: f.category, text: f.text })),
      'the piece re-enters the set already tagged: its lineage IS its fragments',
    )
  } finally {
    await closeServer(server)
  }
})

// ── PROOF 3: a save lands on the session version, never the mother ───────────

test('a save lands on the session version, never the mother', async () => {
  const datasets = new MemoryDatasets()
  const mother = await seedMother(datasets)
  const before = JSON.stringify(datasets.store.get(mother.id))
  const { server, url } = await createServer(
    datasets,
    new MemoryMuseSessions(),
    readOnlyActorum([
      completedRun('run-1', 'https://example.invalid/piece-1.png'),
      completedRun('run-2', 'https://example.invalid/piece-2.png'),
    ]),
  )
  try {
    const { sessionId } = await sessionWithPiece(url, mother.id, 'run-1')
    const first = await request(`${url}/v1/data/muse/sessions/${sessionId}/pieces/run-1/save`, {
      method: 'POST', headers: HEADERS,
    })
    assert.equal(first.status, 201)
    const sessionDatasetId: string = first.body.session.sessionDatasetId
    assert.notEqual(sessionDatasetId, mother.id, 'the session version is a record of its own')
    assert.equal(
      JSON.stringify(datasets.store.get(mother.id)), before,
      'the mother is the starter and stays pure — a save never writes it',
    )

    // A second save appends to the SAME session dataset rather than minting another: the
    // record is created lazily by the first save and named on the session from then on.
    const recordedTwo = await request(`${url}/v1/data/muse/sessions/${sessionId}/pieces`, {
      method: 'POST',
      headers: HEADERS,
      body: { runId: 'run-2', rollIndex: 1, fragments: [{ category: 'subject', text: 'a lantern-keeper' }] },
    })
    assert.equal(recordedTwo.status, 201)
    const second = await request(`${url}/v1/data/muse/sessions/${sessionId}/pieces/run-2/save`, {
      method: 'POST', headers: HEADERS,
    })
    assert.equal(second.status, 201)
    assert.equal(second.body.session.sessionDatasetId, sessionDatasetId, 'one session, one dataset')

    const target = datasets.store.get(sessionDatasetId)!
    assert.equal(target.media.length, 2, 'the second save appends')
    assert.equal(target.versions.length, 2, 'an append records a version of the media set')
    assert.equal(target.versions[1].count, 2)
    assert.equal(target.owner, OWNER)
    assert.equal(target.modality, mother.modality, 'the version carries the mother\'s modality')
    assert.ok(target.name.startsWith(mother.name), 'the version is named off the mother, then the session')

    assert.equal(
      JSON.stringify(datasets.store.get(mother.id)), before,
      'still pure after a second save',
    )
    // Both ledger entries read as saved.
    assert.deepEqual(second.body.session.pieces.map((p: { saved: boolean }) => p.saved), [true, true])
  } finally {
    await closeServer(server)
  }
})

// ── PROOF 4: a save reweights the floor and never widens it ──────────────────

test('saving a piece adds no fragment the floor did not already have', async () => {
  const datasets = new MemoryDatasets()
  const mother = await seedMother(datasets)
  const { server, url } = await createServer(
    datasets, new MemoryMuseSessions(), readOnlyActorum([completedRun('run-1', 'https://example.invalid/piece-1.png')]),
  )
  try {
    const { sessionId, session } = await sessionWithPiece(url, mother.id, 'run-1')
    const floorBefore = JSON.stringify(session.floor)
    const fragmentsBefore = JSON.stringify(session.fragments)

    const saved = await request(`${url}/v1/data/muse/sessions/${sessionId}/pieces/run-1/save`, {
      method: 'POST', headers: HEADERS,
    })
    assert.equal(saved.status, 201)

    assert.equal(
      JSON.stringify(saved.body.session.fragments), fragmentsBefore,
      'a piece is assembled from fragments already on the floor, so a save introduces none',
    )
    assert.equal(
      JSON.stringify(saved.body.session.floor), floorBefore,
      'and it moves no floor state either — widening is the manual add or a fresh decompose',
    )
  } finally {
    await closeServer(server)
  }
})

// ── The rejections the surface owes ──────────────────────────────────────────

test('a run the session ledger holds no piece for cannot be saved', async () => {
  const datasets = new MemoryDatasets()
  const mother = await seedMother(datasets)
  const { server, url } = await createServer(
    datasets, new MemoryMuseSessions(), readOnlyActorum([completedRun('run-1', 'https://example.invalid/piece-1.png')]),
  )
  try {
    const { sessionId } = await sessionWithPiece(url, mother.id, 'run-1')
    const saved = await request(`${url}/v1/data/muse/sessions/${sessionId}/pieces/run-never-rolled/save`, {
      method: 'POST', headers: HEADERS,
    })
    assert.equal(saved.status, 404)
    assert.equal(saved.body.error.code, 'not_found.muse_piece')
    assert.equal(datasets.store.size, 1, 'a rejected save mints no dataset')
  } finally {
    await closeServer(server)
  }
})

test('a session belonging to another identity cannot be saved into', async () => {
  const datasets = new MemoryDatasets()
  const mother = await seedMother(datasets)
  const sessions = new MemoryMuseSessions()
  const { server, url } = await createServer(
    datasets, sessions, readOnlyActorum([completedRun('run-1', 'https://example.invalid/piece-1.png')]),
  )
  try {
    const { sessionId } = await sessionWithPiece(url, mother.id, 'run-1')
    const stranger = await request(`${url}/v1/data/muse/sessions/${sessionId}/pieces/run-1/save`, {
      method: 'POST', headers: { 'x-api-key': 'owner-2' },
    })
    assert.equal(stranger.status, 404)
    assert.equal(stranger.body.error.code, 'not_found.muse_session')
    assert.equal(sessions.store.get(sessionId)!.session.pieces[0].saved, false, 'and nothing was written')
    assert.equal(datasets.store.size, 1)
  } finally {
    await closeServer(server)
  }
})
