// =============================================================================
// Muse session HTTP surface — the save-back and steer seams (hermetic route test)
// =============================================================================
//
// Real `CrystalApi` + real `createApiRouter` over in-memory doubles, no live
// Mongo — the shape `datasetsRoutes.test.ts` established. It gets a file of its
// own rather than joining that one because the surface under test is the Muse
// SESSION, not the dataset: the dataset is where a save lands, but every call
// here goes through a session route.
//
// The five claims this file is gated on, each one a product decision that would
// otherwise be provable only by reading the code:
//
//   0. A STEER PROPOSES AND NEVER APPLIES (S9). The steer route reads the session
//      and returns pills the user may veto; the floor moves only when they confirm
//      and the app calls the floor routes. Proved against a session store whose
//      every mutator throws and which records what it was asked to do.
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
import { coverageOver, isArchived, liveMedia, nextDatasetVersion } from '../../../../src/types/dataset.js'
import type {
  Captionset, Dataset, DatasetListOpts, DatasetListPage, DatasetMediaItem,
  Datasets, DatasetSummaryListPage,
} from '../../../../src/types/dataset.js'
import type {
  CreateMuseSessionInput, MuseSessions, StoredMuseSession,
} from '../../../../src/types/museSession.js'
import { MuseSessionVersionConflict } from '../../../../src/types/museSession.js'
import type { MuseSession } from '../../../../src/crystal/muse/session.js'
import { setFragmentEnabled, setFragmentWeight } from '../../../../src/crystal/muse/session.js'
import { fragmentKey, type Fragment } from '../../../../src/crystal/muse/taxonomy.js'
import type { Actorum } from '../../../../src/types/cursus.js'
import type { Actum } from '../../../../src/types/actum.js'
import type { AuctorKey } from '../../../../src/flow/types.js'
import type { Credentials, ResolvedCaller } from '../../../../src/allocutio/api/IdentityResolver.js'
import { MuseSteerCursor } from '../../../../src/crystal/MuseSteerCursor.js'
import { MAX_INSTRUCTION_CHARS } from '../../../../src/crystal/muse/steer.js'
import { OPENROUTER_PROVIDER } from '../../../../src/crystal/apiProviders.js'
import { MODUS_MUSE_STEER } from '../../../../src/crystal/seeds/modi.js'

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
    return { entries: [...this.store.values()].filter((d) => d.owner === opts.owner && !isArchived(d)) }
  }
  async listSummaries(opts: DatasetListOpts): Promise<DatasetSummaryListPage> {
    const { entries } = await this.list(opts)
    return {
      entries: entries.map((d) => ({
        id: d.id, name: d.name, images: liveMedia(d.media).length, updatedAt: d.mutatum.toISOString(),
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
      captionsets: d.captionsets.map((c) => ({ ...c, coverage: coverageOver(c.captions, media) })),
      versions: [...d.versions, { v: nextDatasetVersion(d.versions), count: media.length, when: new Date() }],
      mutatum: new Date(),
    }
    this.store.set(datasetId, updated)
    return updated
  }
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
  async setCaption(datasetId: string, captionsetId: string, mediaId: string, caption: string): Promise<Dataset | null> {
    const d = this.store.get(datasetId)
    if (!d) return null
    const target = d.captionsets.find((c) => c.id === captionsetId)
    if (!target) return null
    const captions = { ...(target.captions ?? {}), [mediaId]: caption }
    const next: Captionset = { ...target, captions, coverage: coverageOver(captions, d.media) }
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

/**
 * The whole `MuseSessions` surface, in memory — including the version match.
 *
 * The CAS is modelled here rather than stubbed away because the retry it drives
 * lives in `CrystalApi`, not in the store: a double that accepted any version
 * would make every test of that retry vacuous. `beforeSave` is the seam the
 * concurrency tests write through — it runs after the caller has read and
 * mutated but before the write is attempted, which is exactly the window a
 * competing request lands in.
 */
class MemoryMuseSessions implements MuseSessions {
  store = new Map<string, StoredMuseSession>()
  /** Writes attempted, conflicted ones included — how a test counts retries. */
  saveAttempts: number[] = []
  /** Runs in the read-mutate-write gap; a test uses it to land a competing write. */
  beforeSave: (() => Promise<void> | void) | null = null
  private seq = 0

  async create(input: CreateMuseSessionInput): Promise<StoredMuseSession> {
    const now = new Date()
    const full: StoredMuseSession = {
      id: `sess-${++this.seq}`, owner: input.owner, session: input.session, natum: now, mutatum: now, versio: 0,
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
  async save(id: string, session: MuseSession, expectedVersio: number): Promise<StoredMuseSession | null> {
    const hook = this.beforeSave
    if (hook) await hook()
    this.saveAttempts.push(expectedVersio)
    const stored = this.store.get(id)
    if (!stored) return null
    if ((stored.versio ?? 0) !== expectedVersio) throw new MuseSessionVersionConflict(id, expectedVersio)
    const next: StoredMuseSession = { ...stored, session, mutatum: new Date(), versio: expectedVersio + 1 }
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
  // `Identity` also carries `resolveCaller` (identity + the limits the CREDENTIAL imposes, e.g. a
  // partner API key's per-run spend ceiling). These fakes mint no ceiling, so it is `resolve` plus
  // an empty limit set — which is exactly the shape a key with no ceiling resolves to.
  async resolveCaller(creds: Credentials): Promise<ResolvedCaller> {
    return { auctor: await this.resolve(creds) }
  },
}

function createServer(
  datasets: Datasets, museSessions: MuseSessions, actorum: Actorum,
  extra: Record<string, unknown> = {},
): Promise<{ server: http.Server; url: string }> {
  const deps = {
    datasets, museSessions, actorum, signorum: noSpendSignorum, ...extra,
  } as unknown as CrystalApiDeps
  const api = new CrystalApi(deps)
  return new Promise((resolveP, reject) => {
    const app = express()
    app.use(express.json())
    app.use('/v1', createApiRouter({
      api: api as unknown as Parameters<typeof createApiRouter>[0]['api'],
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

// ── The steer seam: a proposal, and nothing else ─────────────────────────────
//
// A steer PROPOSES and never applies (S9). The route reads the session, runs the
// interpreter, and returns pills the user may veto; the floor moves only when they
// confirm and the app calls the floor routes. The claim is proved the only way it
// can be — against a session store that RECORDS every call and whose every mutator
// throws, so a steer that wrote anything cannot reach a 200.

/**
 * A session store wrapper that records what it was asked to do and refuses to write.
 *
 * `create` and `save` throw: they are the whole mutation surface of `MuseSessions`,
 * so a steer path that touched a session — directly or through the pure module —
 * fails here rather than passing quietly.
 */
function sealedSessions(inner: MuseSessions): MuseSessions & { calls: string[] } {
  const calls: string[] = []
  return {
    calls,
    async create(): Promise<StoredMuseSession> {
      calls.push('create')
      throw new Error('a steer must not write a session')
    },
    async save(): Promise<StoredMuseSession | null> {
      calls.push('save')
      throw new Error('a steer must not write a session')
    },
    async find(id: string) { calls.push('find'); return inner.find(id) },
    async listByOwner(owner: string, motherDatasetId: string) {
      calls.push('listByOwner')
      return inner.listByOwner(owner, motherDatasetId)
    },
  }
}

/** The execution ring `invokeFlow` needs, wired to the real steer cursor over a fake transport. */
function steerRing(answer: unknown) {
  const cast: Array<Record<string, unknown>> = []
  const cursor = new MuseSteerCursor({
    providers: [{ provider: OPENROUTER_PROVIDER, apiKey: 'test-key' }],
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({
        choices: [{ message: { content: JSON.stringify(answer) } }],
        usage: { total_tokens: 100 },
      }),
    }),
  })
  return {
    cast,
    deps: {
      inceptor: {
        async initiate(inceptio: { modusId: string; aditus: Record<string, unknown> }) {
          cast.push(inceptio.aditus)
          return {
            id: 'act-steer', modusId: inceptio.modusId, modusVersiono: MODUS_MUSE_STEER.versio,
            aditus: inceptio.aditus, impetus: 1_000n, status: 'agens',
          }
        },
      },
      modorum: {
        async find(id: string) { return id === MODUS_MUSE_STEER.id ? MODUS_MUSE_STEER : null },
      },
      cursorum: { resolve: () => cursor },
      completor: {
        async complete(a: Record<string, unknown>, exitus: { exitus: Record<string, unknown>; impetus: bigint }) {
          return { ...a, status: 'completus', exitus: exitus.exitus, impetus: exitus.impetus }
        },
      },
    } as Record<string, unknown>,
  }
}

test('a steer run performs no session write — it proposes, and the floor is left exactly as it was', async () => {
  const datasets = new MemoryDatasets()
  const mother = await seedMother(datasets)
  const sessions = new MemoryMuseSessions()

  // Spawn through an ordinary store, then seal it: from here on any write is a throw.
  const spawn = await createServer(datasets, sessions, readOnlyActorum([]))
  let sessionId: string
  try {
    const spawned = await request(`${spawn.url}/v1/data/muse/sessions`, {
      method: 'POST', headers: HEADERS, body: { datasetId: mother.id },
    })
    assert.equal(spawned.status, 201)
    sessionId = spawned.body.session.id
  } finally {
    await closeServer(spawn.server)
  }

  const before = JSON.stringify(sessions.store.get(sessionId!))
  const sealed = sealedSessions(sessions)
  const ring = steerRing({
    eliminations: [{ category: 'lighting', text: 'dusk glow' }],
    additions: [{ category: 'mood', text: 'hushed and expectant' }],
  })

  const { server, url } = await createServer(datasets, sealed, readOnlyActorum([]), ring.deps)
  try {
    const steered = await request(`${url}/v1/data/muse/sessions/${sessionId!}/steer`, {
      method: 'POST', headers: HEADERS, body: { instruction: 'lose the dusk, make it expectant' },
    })
    assert.equal(steered.status, 200, `a steer must not write: ${JSON.stringify(steered.body)}`)

    const proposal = steered.body.proposal
    assert.deepEqual(proposal.eliminations, [{ category: 'lighting', text: 'dusk glow' }])
    assert.equal(proposal.additions.length, 1)
    assert.equal(proposal.additions[0].category, 'mood')
    assert.equal(proposal.dropped, 0)

    // The mutators were never even reached — the only thing a steer asks a store is to read.
    assert.deepEqual(sealed.calls, ['find'], 'a steer reads the session once and writes nothing')
    assert.equal(
      JSON.stringify(sessions.store.get(sessionId!)), before,
      'the stored session is byte-identical after a steer',
    )

    // And the run was cast with the floor INLINE: no session id travels to the interpreter,
    // which could not scope one if it did (an Actum carries no identity).
    assert.equal(ring.cast.length, 1)
    const aditus = ring.cast[0]
    assert.equal(aditus.instruction, 'lose the dusk, make it expectant')
    assert.ok(Array.isArray(aditus.floor))
    assert.deepEqual(
      (aditus.floor as Array<Record<string, string>>).map((f) => `${f.category}:${f.text}`).sort(),
      FRAGMENTS.map((f) => `${f.category}:${f.text}`).sort(),
    )
    for (const value of Object.values(aditus)) {
      assert.notEqual(value, sessionId!, 'the session id must not travel into the run')
    }
  } finally {
    await closeServer(server)
  }
})

test('a proposal naming a fragment the floor does not hold comes back short, and says how short', async () => {
  const datasets = new MemoryDatasets()
  const mother = await seedMother(datasets)
  const sessions = new MemoryMuseSessions()
  const ring = steerRing({
    eliminations: [
      { category: 'style', text: 'ink wash' },            // held
      { category: 'style', text: 'a style nobody has' },  // not held
    ],
    additions: [{ category: 'nonsense', text: 'outside the taxonomy' }],
  })

  const { server, url } = await createServer(datasets, sessions, readOnlyActorum([]), ring.deps)
  try {
    const spawned = await request(`${url}/v1/data/muse/sessions`, {
      method: 'POST', headers: HEADERS, body: { datasetId: mother.id },
    })
    const sessionId = spawned.body.session.id

    const steered = await request(`${url}/v1/data/muse/sessions/${sessionId}/steer`, {
      method: 'POST', headers: HEADERS, body: { instruction: 'lose the ink wash' },
    })
    assert.equal(steered.status, 200)
    assert.deepEqual(steered.body.proposal.eliminations, [{ category: 'style', text: 'ink wash' }])
    assert.deepEqual(steered.body.proposal.additions, [])
    assert.equal(steered.body.proposal.dropped, 2, 'the drops are reported rather than swallowed')
  } finally {
    await closeServer(server)
  }
})

test('the instruction is limited at the server, and an empty one never reaches a run', async () => {
  const datasets = new MemoryDatasets()
  const mother = await seedMother(datasets)
  const ring = steerRing({})
  const { server, url } = await createServer(
    datasets, new MemoryMuseSessions(), readOnlyActorum([]), ring.deps,
  )
  try {
    const spawned = await request(`${url}/v1/data/muse/sessions`, {
      method: 'POST', headers: HEADERS, body: { datasetId: mother.id },
    })
    const sessionId = spawned.body.session.id

    for (const instruction of ['', '   ', 'x'.repeat(MAX_INSTRUCTION_CHARS + 1)]) {
      const refused = await request(`${url}/v1/data/muse/sessions/${sessionId}/steer`, {
        method: 'POST', headers: HEADERS, body: { instruction },
      })
      assert.equal(refused.status, 400, `'${instruction.slice(0, 12)}…' must be refused`)
    }
    assert.equal(ring.cast.length, 0, 'no refused instruction was ever cast as a run')

    const stranger = await request(`${url}/v1/data/muse/sessions/${sessionId}/steer`, {
      method: 'POST', headers: { 'x-api-key': 'owner-2' }, body: { instruction: 'lose the ink wash' },
    })
    assert.equal(stranger.status, 404)
    assert.equal(stranger.body.error.code, 'not_found.muse_session')
    assert.equal(ring.cast.length, 0, "and a stranger's steer never reached a run either")
  } finally {
    await closeServer(server)
  }
})

// ── Archive is not erasure: an archived mother still resolves (noema-266) ────

test('a session spawns off an archived mother, and a piece still saves into it', async () => {
  const datasets = new MemoryDatasets()
  const mother = await seedMother(datasets)
  await datasets.archiveDataset(mother.id)

  const { server, url } = await createServer(
    datasets, new MemoryMuseSessions(), readOnlyActorum([completedRun('run-1', 'https://example.invalid/piece-1.png')]),
  )
  try {
    // The mother is gone from the lists, and every reference into it still resolves — which is
    // the whole reason archive stamps a field rather than removing the row.
    assert.equal((await datasets.list({ owner: OWNER })).entries.length, 0)

    const { sessionId } = await sessionWithPiece(url, mother.id, 'run-1')
    const saved = await request(`${url}/v1/data/muse/sessions/${sessionId}/pieces/run-1/save`, {
      method: 'POST', headers: HEADERS,
    })
    assert.equal(saved.status, 201, `an archived mother must still resolve: ${JSON.stringify(saved.body)}`)
  } finally {
    await closeServer(server)
  }
})

test('an archived media item does not seed a session spawned after the archive', async () => {
  const datasets = new MemoryDatasets()
  const mother = await seedMother(datasets)
  await datasets.archiveMedia(mother.id, 'media-seed')

  const { server, url } = await createServer(datasets, new MemoryMuseSessions(), readOnlyActorum([]))
  try {
    const spawned = await request(`${url}/v1/data/muse/sessions`, {
      method: 'POST', headers: HEADERS, body: { datasetId: mother.id },
    })
    assert.equal(spawned.status, 201)
    assert.deepEqual(spawned.body.session.floor, [], 'an archived item has left the working set Muse draws from')
  } finally {
    await closeServer(server)
  }
})

// ── The floor reconciles with the mother's live garden on resume (noema-272) ──
//
// The floor is a snapshot taken once, at spawn; the mother keeps growing. A session
// spawned before a decomposition landed therefore validates a roll drawn from the
// mother's CURRENT fragments against a floor that predates them, and the record call
// rejects every citation it cannot resolve. The read that resumes a session is where
// that gap is closed, and these four proofs are the clauses that keep the merge from
// being a different bug: it adds, it never removes, it leaves steer state alone, and it
// does not move the pointer a resume follows.

/** A mother whose one media item carries no fragments yet — the state before a decompose. */
async function seedUndecomposedMother(datasets: MemoryDatasets): Promise<Dataset> {
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
    }],
    captionsets: [],
    versions: [{ v: '1.0.0', count: 1, when: new Date() }],
  })
}

/** One floor entry by the fragment that keys it, or `undefined` when the floor lacks it. */
function floorEntry(session: any, fragment: Pick<Fragment, 'category' | 'text'>) {
  const key = fragmentKey(fragment)
  return session.floor.find((e: { key: string }) => e.key === key)
}

test('a session resumed against a garden it predates picks up the new fragments', async () => {
  const datasets = new MemoryDatasets()
  const mother = await seedUndecomposedMother(datasets)
  const sessions = new MemoryMuseSessions()
  const { server, url } = await createServer(datasets, sessions, readOnlyActorum([]))
  try {
    const spawned = await request(`${url}/v1/data/muse/sessions`, {
      method: 'POST', headers: HEADERS, body: { datasetId: mother.id },
    })
    assert.equal(spawned.status, 201)
    const sessionId: string = spawned.body.session.id
    assert.deepEqual(spawned.body.session.floor, [], 'nothing had been decomposed when the session broke off')

    // The decomposition lands on the mother AFTER the session exists.
    await datasets.setFragments(mother.id, 'media-seed', FRAGMENTS)

    const resumed = await request(`${url}/v1/data/muse/sessions/${sessionId}`, { headers: HEADERS })
    assert.equal(resumed.status, 200)
    assert.equal(resumed.body.session.floor.length, FRAGMENTS.length, 'the floor holds the mother\'s fragments')
    assert.equal(resumed.body.session.fragments.length, FRAGMENTS.length)
    for (const fragment of FRAGMENTS) {
      const entry = floorEntry(resumed.body.session, fragment)
      assert.ok(entry, `'${fragment.category}' joined the floor`)
      assert.equal(entry.enabled, true, 'a newly merged fragment lands in the draw')
      assert.equal(entry.weight, 1, 'at the default weight')
    }

    // PERSISTED, not decorated onto the view: the record route resolves a lineage against
    // the STORED floor, so a view-only merge would leave the piece unrecordable.
    assert.equal(sessions.store.get(sessionId)!.session.floor.size, FRAGMENTS.length)
    const recorded = await request(`${url}/v1/data/muse/sessions/${sessionId}/pieces`, {
      method: 'POST',
      headers: HEADERS,
      body: { runId: 'run-1', rollIndex: 0, fragments: FRAGMENTS.map((f) => ({ category: f.category, text: f.text })) },
    })
    assert.equal(recorded.status, 201, `the roll the mother can produce is recordable: ${JSON.stringify(recorded.body)}`)
  } finally {
    await closeServer(server)
  }
})

test('reconciling does not re-enable a fragment the floor darkened, and does not reset a weight', async () => {
  const datasets = new MemoryDatasets()
  const mother = await seedMother(datasets)
  const { server, url } = await createServer(datasets, new MemoryMuseSessions(), readOnlyActorum([]))
  try {
    const spawned = await request(`${url}/v1/data/muse/sessions`, {
      method: 'POST', headers: HEADERS, body: { datasetId: mother.id },
    })
    assert.equal(spawned.status, 201)
    const sessionId: string = spawned.body.session.id

    const darkened = { category: FRAGMENTS[0].category, text: FRAGMENTS[0].text }
    const weighted = { category: FRAGMENTS[1].category, text: FRAGMENTS[1].text }
    assert.equal((await request(`${url}/v1/data/muse/sessions/${sessionId}/floor/enabled`, {
      method: 'PATCH', headers: HEADERS, body: { ...darkened, enabled: false },
    })).status, 200)
    assert.equal((await request(`${url}/v1/data/muse/sessions/${sessionId}/floor/weight`, {
      method: 'PATCH', headers: HEADERS, body: { ...weighted, weight: 4 },
    })).status, 200)

    // A later decomposition widens the mother.
    const arrival: Fragment = { category: 'mood', text: 'a held breath', source: 'board-c', trigger: '' }
    await datasets.setFragments(mother.id, 'media-seed', [...FRAGMENTS, arrival])

    const resumed = await request(`${url}/v1/data/muse/sessions/${sessionId}`, { headers: HEADERS })
    assert.equal(resumed.status, 200)
    assert.equal(floorEntry(resumed.body.session, darkened).enabled, false, 'darkened stays darkened')
    assert.equal(floorEntry(resumed.body.session, weighted).weight, 4, 'a steered weight stays where the user put it')
    const merged = floorEntry(resumed.body.session, arrival)
    assert.ok(merged, 'and the fragment that is genuinely new joined the floor')
    assert.equal(merged.enabled, true)
    assert.equal(merged.weight, 1)
  } finally {
    await closeServer(server)
  }
})

test('a fragment the mother no longer has is left on the floor', async () => {
  const datasets = new MemoryDatasets()
  const mother = await seedMother(datasets)
  const { server, url } = await createServer(datasets, new MemoryMuseSessions(), readOnlyActorum([]))
  try {
    const { sessionId } = await sessionWithPiece(url, mother.id, 'run-1')

    // A later decomposition comes back DIFFERENT: one identity has gone from the mother,
    // and one that was never there has arrived. The merge has to answer both at once —
    // widening on the arrival while leaving the departure alone — which is what separates
    // it from a rebuild.
    const dropped = { category: FRAGMENTS[2].category, text: FRAGMENTS[2].text }
    const arrival: Fragment = { category: 'mood', text: 'a held breath', source: 'board-c', trigger: '' }
    await datasets.setFragments(mother.id, 'media-seed', [...FRAGMENTS.slice(0, 2), arrival])

    const resumed = await request(`${url}/v1/data/muse/sessions/${sessionId}`, { headers: HEADERS })
    assert.equal(resumed.status, 200)
    assert.ok(floorEntry(resumed.body.session, arrival), 'the arrival joined the floor')
    assert.ok(floorEntry(resumed.body.session, dropped), 'and the departure stayed on it')
    assert.equal(
      resumed.body.session.floor.length, FRAGMENTS.length + 1,
      'the merge widens a floor and never narrows one',
    )
    // Which is the point: a piece already recorded cites the departed fragment, and that
    // lineage still resolves against the floor.
    assert.equal(resumed.body.session.pieces[0].fragments.length, FRAGMENTS.length)
    const reacted = await request(`${url}/v1/data/muse/sessions/${sessionId}/pieces/run-1`, {
      method: 'PATCH', headers: HEADERS, body: { reaction: 'up' },
    })
    assert.equal(reacted.status, 200)
  } finally {
    await closeServer(server)
  }
})

test('the session list reconciles too, and leaves the resume pointer where it was', async () => {
  const datasets = new MemoryDatasets()
  const mother = await seedUndecomposedMother(datasets)
  const { server, url } = await createServer(datasets, new MemoryMuseSessions(), readOnlyActorum([]))
  try {
    for (let i = 0; i < 2; i += 1) {
      assert.equal((await request(`${url}/v1/data/muse/sessions`, {
        method: 'POST', headers: HEADERS, body: { datasetId: mother.id },
      })).status, 201)
    }
    const before = await request(`${url}/v1/data/muse/sessions?datasetId=${mother.id}`, { headers: HEADERS })
    assert.equal(before.status, 200)
    assert.equal(before.body.sessions.length, 2)

    await datasets.setFragments(mother.id, 'media-seed', FRAGMENTS)

    const after = await request(`${url}/v1/data/muse/sessions?datasetId=${mother.id}`, { headers: HEADERS })
    assert.equal(after.status, 200)
    for (const session of after.body.sessions) {
      assert.equal(session.floor.length, FRAGMENTS.length, 'the list is a resume, so it reconciles like one')
    }
    // The client resumes into the most recently changed session. Reconciling restamps
    // every session it writes, so the order this list is read in has to survive it.
    assert.deepEqual(
      after.body.sessions.map((s: { id: string }) => s.id),
      before.body.sessions.map((s: { id: string }) => s.id),
      'the session a resume lands on is the same one it would have landed on before',
    )
  } finally {
    await closeServer(server)
  }
})

test('a session whose mother cannot be read still resumes', async () => {
  const datasets = new MemoryDatasets()
  const mother = await seedMother(datasets)
  const { server, url } = await createServer(datasets, new MemoryMuseSessions(), readOnlyActorum([]))
  try {
    const { sessionId } = await sessionWithPiece(url, mother.id, 'run-1')
    datasets.store.delete(mother.id)

    const resumed = await request(`${url}/v1/data/muse/sessions/${sessionId}`, { headers: HEADERS })
    assert.equal(resumed.status, 200, 'the session has a floor and a ledger of its own')
    assert.equal(resumed.body.session.floor.length, FRAGMENTS.length)

    const listed = await request(`${url}/v1/data/muse/sessions?datasetId=${mother.id}`, { headers: HEADERS })
    assert.equal(listed.status, 200, 'and the list still resolves to no error')
    assert.equal(listed.body.sessions.length, 1)
  } finally {
    await closeServer(server)
  }
})

// ── The setup survives a reload (noema-287) ──────────────────────────────────
//
// A session's pieces already came back and its engine did not. The flow, the run shape,
// the model stack and the standing affix are on the session now, behind one route.
// These are the seams that route has to get right: it stores what it is given, it is
// owner-scoped from the resolved caller like every route beside it, and there is one
// thing it will not store at any price.

test('committing a nozzle persists it against the session', async () => {
  const datasets = new MemoryDatasets()
  const mother = await seedMother(datasets)
  const { server, url } = await createServer(datasets, new MemoryMuseSessions(), readOnlyActorum([]))
  try {
    const spawned = await request(`${url}/v1/data/muse/sessions`, {
      method: 'POST', headers: HEADERS, body: { datasetId: mother.id },
    })
    const sessionId: string = spawned.body.session.id
    assert.equal(spawned.body.session.setup, undefined, 'a fresh session carries no setup')

    const committed = await request(`${url}/v1/data/muse/sessions/${sessionId}/setup`, {
      method: 'PATCH',
      headers: HEADERS,
      body: {
        modusId: 'a-t2i-flow',
        mode: 'batched',
        cap: 24,
        nozzle: [
          { intellaId: 'intella-a', nomen: 'First model', trigger: 'atrig', weight: 0.8 },
          { intellaId: 'intella-b', nomen: 'Second model', trigger: 'btrig' },
        ],
        prefix: 'a standing lead',
        suffix: 'a standing trail',
      },
    })
    assert.equal(committed.status, 200, JSON.stringify(committed.body))

    // The read is the one that matters: this is what a returning client hydrates from.
    const resumed = await request(`${url}/v1/data/muse/sessions/${sessionId}`, { headers: HEADERS })
    const setup = resumed.body.session.setup
    assert.equal(setup.modusId, 'a-t2i-flow')
    assert.equal(setup.mode, 'batched')
    assert.equal(setup.cap, 24)
    assert.equal(setup.prefix, 'a standing lead')
    assert.equal(setup.suffix, 'a standing trail')
    assert.deepEqual(
      setup.nozzle.map((e: any) => [e.intellaId, e.nomen, e.trigger, e.weight]),
      [['intella-a', 'First model', 'atrig', 0.8], ['intella-b', 'Second model', 'btrig', undefined]],
      'the stack comes back in the order it was stacked, weights included',
    )

    // The setup reaches no other part of the session.
    assert.deepEqual(resumed.body.session.floor, spawned.body.session.floor)
    assert.deepEqual(resumed.body.session.pieces, [])
  } finally {
    await closeServer(server)
  }
})

test('a restored session comes back UNACKNOWLEDGED', async () => {
  // An infinite-mode acknowledgement is consent for ONE sitting — it is what stands in
  // for the count an infinite run does not have. Storing it would let a reload arrive
  // already agreed to a spend with no ceiling but the balance, so there is no field for
  // it and a body that sends one is stored without it.
  const datasets = new MemoryDatasets()
  const mother = await seedMother(datasets)
  const { server, url } = await createServer(datasets, new MemoryMuseSessions(), readOnlyActorum([]))
  try {
    const spawned = await request(`${url}/v1/data/muse/sessions`, {
      method: 'POST', headers: HEADERS, body: { datasetId: mother.id },
    })
    const sessionId: string = spawned.body.session.id

    const committed = await request(`${url}/v1/data/muse/sessions/${sessionId}/setup`, {
      method: 'PATCH',
      headers: HEADERS,
      body: { modusId: 'a-t2i-flow', mode: 'infinite', cap: 12, acknowledged: true },
    })
    assert.equal(committed.status, 200)

    const resumed = await request(`${url}/v1/data/muse/sessions/${sessionId}`, { headers: HEADERS })
    const setup = resumed.body.session.setup
    assert.equal(setup.mode, 'infinite', 'the run shape itself is stored')
    assert.equal('acknowledged' in setup, false, 'the acknowledgement is not')
    assert.equal(JSON.stringify(resumed.body.session).includes('acknowledged'), false)
  } finally {
    await closeServer(server)
  }
})

test('a session belonging to another identity cannot have its setup written', async () => {
  const datasets = new MemoryDatasets()
  const mother = await seedMother(datasets)
  const { server, url } = await createServer(datasets, new MemoryMuseSessions(), readOnlyActorum([]))
  try {
    const spawned = await request(`${url}/v1/data/muse/sessions`, {
      method: 'POST', headers: HEADERS, body: { datasetId: mother.id },
    })
    const sessionId: string = spawned.body.session.id

    // The owner is the resolved caller and nothing in the body is a scope value, so a
    // stranger naming the session — and naming its owner — still reaches nothing.
    const stranger = await request(`${url}/v1/data/muse/sessions/${sessionId}/setup`, {
      method: 'PATCH',
      headers: { 'x-api-key': 'someone-else' },
      body: { owner: OWNER, animaId: OWNER, modusId: 'a-t2i-flow', mode: 'infinite' },
    })
    assert.equal(stranger.status, 404, 'someone else’s session is not found, never forbidden')

    const resumed = await request(`${url}/v1/data/muse/sessions/${sessionId}`, { headers: HEADERS })
    assert.equal(resumed.body.session.setup, undefined, 'nothing was written')
  } finally {
    await closeServer(server)
  }
})

// ── Overlapping writes: the read-mutate-save loop (noema-309) ────────────────
//
// Every mutation on this surface is read → pure-mutate → replace, and the
// replace is wholesale. Two of them overlapping is the ordinary case in Muse —
// rolls stream in while the floor is being steered — so the store refuses a
// write computed from a read that is no longer current, and `CrystalApi`
// re-reads and re-applies the SAME pure mutator to the fresh session. These
// tests drive that through the real route.

/**
 * Land a write from another caller, straight into the store.
 *
 * Written into the map rather than through `save` so it cannot re-enter the
 * `beforeSave` hook that schedules it. It bumps the version exactly as a real
 * write would, which is what the caller under test then collides with.
 */
function landCompetingWrite(
  sessions: MemoryMuseSessions,
  id: string,
  mutate: (session: MuseSession) => MuseSession,
): void {
  const stored = sessions.store.get(id)
  if (!stored) throw new Error(`no session '${id}' to write against`)
  sessions.store.set(id, {
    ...stored,
    session: mutate(stored.session),
    mutatum: new Date(),
    versio: (stored.versio ?? 0) + 1,
  })
}

test('a mutation that collides with a concurrent write is re-applied to the fresh session, and both survive', async () => {
  const datasets = new MemoryDatasets()
  const mother = await seedMother(datasets)
  const sessions = new MemoryMuseSessions()

  const { server, url } = await createServer(
    datasets, sessions, readOnlyActorum([completedRun('run-1', 'https://example.invalid/piece-1.png')]),
  )
  try {
    const spawned = await request(`${url}/v1/data/muse/sessions`, {
      method: 'POST', headers: HEADERS, body: { datasetId: mother.id },
    })
    assert.equal(spawned.status, 201)
    const sessionId: string = spawned.body.session.id

    // A floor change lands in the gap between this request's read and its write —
    // the interleaving that loses a piece under a bare replace.
    sessions.saveAttempts = []
    sessions.beforeSave = () => {
      sessions.beforeSave = null
      landCompetingWrite(sessions, sessionId, (session) =>
        setFragmentEnabled(session, { category: 'style', text: 'ink wash' }, false))
    }

    const recorded = await request(`${url}/v1/data/muse/sessions/${sessionId}/pieces`, {
      method: 'POST',
      headers: HEADERS,
      body: { runId: 'run-1', rollIndex: 0, fragments: [{ category: 'subject', text: 'a lantern-keeper' }] },
    })
    assert.equal(recorded.status, 201, `the piece is recorded, not refused: ${JSON.stringify(recorded.body)}`)

    // The write was attempted twice: once against the version it read, once
    // against the version the competing write left behind.
    assert.deepEqual(sessions.saveAttempts, [0, 1], 'the losing attempt was retried against the fresh version')

    // BOTH changes are in the stored session. The retried write carries the
    // concurrent writer's floor change because the mutator was re-applied to the
    // FRESH session rather than re-sent from the stale read.
    const stored = sessions.store.get(sessionId)
    assert.ok(stored)
    assert.equal(stored.session.pieces.length, 1, 'the piece survived')
    assert.equal(stored.session.pieces[0]?.runId, 'run-1')
    assert.equal(
      stored.session.floor.get(fragmentKey({ category: 'style', text: 'ink wash' }))?.enabled, false,
      'and so did the concurrent floor change',
    )

    // The response describes that same merged state — the caller is not told a
    // version of the session that was never stored.
    const floorInBody = (recorded.body.session.floor as Array<{ key: string; enabled: boolean }>)
      .find((entry) => entry.key === fragmentKey({ category: 'style', text: 'ink wash' }))
    assert.equal(floorInBody?.enabled, false)
    assert.equal(recorded.body.session.pieces.length, 1)
  } finally {
    await closeServer(server)
  }
})

test('a mutation that loses every attempt is refused as a retryable conflict, and writes nothing', async () => {
  const datasets = new MemoryDatasets()
  const mother = await seedMother(datasets)
  const sessions = new MemoryMuseSessions()

  const { server, url } = await createServer(
    datasets, sessions, readOnlyActorum([completedRun('run-1', 'https://example.invalid/piece-1.png')]),
  )
  try {
    const spawned = await request(`${url}/v1/data/muse/sessions`, {
      method: 'POST', headers: HEADERS, body: { datasetId: mother.id },
    })
    const sessionId: string = spawned.body.session.id

    // A competing write lands before EVERY attempt: the caller can never win.
    let weight = 2
    sessions.saveAttempts = []
    sessions.beforeSave = () => {
      const w = weight++
      landCompetingWrite(sessions, sessionId, (session) =>
        setFragmentWeight(session, { category: 'lighting', text: 'dusk glow' }, w))
    }

    const recorded = await request(`${url}/v1/data/muse/sessions/${sessionId}/pieces`, {
      method: 'POST',
      headers: HEADERS,
      body: { runId: 'run-1', rollIndex: 0, fragments: [{ category: 'subject', text: 'a lantern-keeper' }] },
    })

    assert.equal(recorded.status, 409, `sustained contention is a conflict, not a 500: ${JSON.stringify(recorded.body)}`)
    assert.equal(recorded.body.error.code, 'conflict.muse_session')
    assert.equal(recorded.body.error.retryable, true)
    assert.equal(sessions.saveAttempts.length, 3, 'bounded — it does not spin')

    // The session is exactly what the last write that DID land left: consistent,
    // and carrying nothing of the refused caller's.
    const stored = sessions.store.get(sessionId)
    assert.ok(stored)
    assert.equal(stored.session.pieces.length, 0, 'the refused mutation wrote nothing')
    assert.equal(
      stored.session.floor.get(fragmentKey({ category: 'lighting', text: 'dusk glow' }))?.weight,
      weight - 1,
      'and the last landed write is intact',
    )
  } finally {
    await closeServer(server)
  }
})

// ── Keeping a roll (noema-329) ───────────────────────────────────────────────
//
// Rolling is free and a roll in progress is uncommitted work, so a report and the
// edits made to it stay in the client. KEEPING is the explicit act, and this is the
// route that makes it durable. Four claims, each one a decision rather than an
// implementation detail:
//
//   A. A KEPT ROLL IS ON THE SESSION, and the list is append-only in the order it
//      was kept — including two keeps of the same prompt, which is the user saying
//      so twice rather than a mistake to collapse.
//   B. NOTHING IS SPENT AND NO RUN IS MADE. The Actum double throws on every write
//      and the ledger double throws on every reservation, so a 201 here is proof
//      that keeping a prompt is not firing one.
//   C. A MALFORMED BODY IS REFUSED, and refusing writes nothing.
//   D. THE OWNER IS THE RESOLVED CALLER. A stranger naming the session — and naming
//      its owner in the body — reaches nothing, and is told "not found".

test('keeping a roll puts it on the session, append-only, and spends nothing', async () => {
  const datasets = new MemoryDatasets()
  const mother = await seedMother(datasets)
  const sessions = new MemoryMuseSessions()
  // Every write path on the run store and the ledger throws: a keep that fired or
  // reserved anything cannot reach a 201.
  const { server, url } = await createServer(datasets, sessions, readOnlyActorum([]))
  try {
    const spawned = await request(`${url}/v1/data/muse/sessions`, {
      method: 'POST', headers: HEADERS, body: { datasetId: mother.id },
    })
    assert.equal(spawned.status, 201)
    const sessionId: string = spawned.body.session.id
    assert.deepEqual(spawned.body.session.keptRolls, [], 'a fresh session has kept nothing, as an empty list')

    const first = await request(`${url}/v1/data/muse/sessions/${sessionId}/kept`, {
      method: 'POST', headers: HEADERS, body: { prompt: 'a lantern-keeper, ink wash', paid: false },
    })
    assert.equal(first.status, 201, `keeping needs no run: ${JSON.stringify(first.body)}`)
    assert.deepEqual(first.body.session.keptRolls, [{ prompt: 'a lantern-keeper, ink wash', paid: false }])

    const second = await request(`${url}/v1/data/muse/sessions/${sessionId}/kept`, {
      method: 'POST', headers: HEADERS, body: { prompt: 'a lantern-keeper, dusk glow', paid: true },
    })
    assert.equal(second.status, 201)

    // Kept twice on purpose: the same prompt again is a third entry.
    const third = await request(`${url}/v1/data/muse/sessions/${sessionId}/kept`, {
      method: 'POST', headers: HEADERS, body: { prompt: 'a lantern-keeper, dusk glow', paid: true },
    })
    assert.equal(third.status, 201)
    assert.deepEqual(
      third.body.session.keptRolls,
      [
        { prompt: 'a lantern-keeper, ink wash', paid: false },
        { prompt: 'a lantern-keeper, dusk glow', paid: true },
        { prompt: 'a lantern-keeper, dusk glow', paid: true },
      ],
      'append-only, in the order they were kept',
    )

    // And it is on the SESSION, not on the response alone — a re-read brings it back.
    const resumed = await request(`${url}/v1/data/muse/sessions/${sessionId}`, { headers: HEADERS })
    assert.equal(resumed.body.session.keptRolls.length, 3, 'the kept panel survives leaving the screen')
    assert.equal(sessions.store.get(sessionId)!.session.keptRolls?.length, 3)
  } finally {
    await closeServer(server)
  }
})

test('a keep with no prompt, or with a verdict that is not a boolean, is refused and writes nothing', async () => {
  const datasets = new MemoryDatasets()
  const mother = await seedMother(datasets)
  const sessions = new MemoryMuseSessions()
  const { server, url } = await createServer(datasets, sessions, readOnlyActorum([]))
  try {
    const spawned = await request(`${url}/v1/data/muse/sessions`, {
      method: 'POST', headers: HEADERS, body: { datasetId: mother.id },
    })
    const sessionId: string = spawned.body.session.id

    for (const body of [
      {},
      { paid: false },
      { prompt: '   ', paid: false },
      { prompt: 'a lantern-keeper', paid: 'yes' },
      { prompt: 'a lantern-keeper' },
    ]) {
      const refused = await request(`${url}/v1/data/muse/sessions/${sessionId}/kept`, {
        method: 'POST', headers: HEADERS, body,
      })
      assert.equal(refused.status, 400, `refused as malformed: ${JSON.stringify(body)}`)
      assert.equal(refused.body.error.code, 'input.malformed')
    }

    assert.equal(sessions.store.get(sessionId)!.session.keptRolls, undefined, 'nothing was written')
  } finally {
    await closeServer(server)
  }
})

test('a session belonging to another identity cannot have a roll kept against it', async () => {
  const datasets = new MemoryDatasets()
  const mother = await seedMother(datasets)
  const sessions = new MemoryMuseSessions()
  const { server, url } = await createServer(datasets, sessions, readOnlyActorum([]))
  try {
    const spawned = await request(`${url}/v1/data/muse/sessions`, {
      method: 'POST', headers: HEADERS, body: { datasetId: mother.id },
    })
    const sessionId: string = spawned.body.session.id

    // Nothing in the body is a scope value, so naming the owner buys the stranger nothing.
    const stranger = await request(`${url}/v1/data/muse/sessions/${sessionId}/kept`, {
      method: 'POST',
      headers: { 'x-api-key': 'someone-else' },
      body: { owner: OWNER, animaId: OWNER, prompt: 'a lantern-keeper', paid: false },
    })
    assert.equal(stranger.status, 404, 'someone else’s session is not found, never forbidden')
    assert.equal(stranger.body.error.code, 'not_found.muse_session')
    assert.equal(sessions.store.get(sessionId)!.session.keptRolls, undefined, 'and nothing was written')
  } finally {
    await closeServer(server)
  }
})

test('a keep that collides with a concurrent write is re-applied to the fresh session, and both survive', async () => {
  const datasets = new MemoryDatasets()
  const mother = await seedMother(datasets)
  const sessions = new MemoryMuseSessions()
  const { server, url } = await createServer(datasets, sessions, readOnlyActorum([]))
  try {
    const spawned = await request(`${url}/v1/data/muse/sessions`, {
      method: 'POST', headers: HEADERS, body: { datasetId: mother.id },
    })
    const sessionId: string = spawned.body.session.id

    // A floor change lands in the gap between this request's read and its write.
    sessions.saveAttempts = []
    sessions.beforeSave = () => {
      sessions.beforeSave = null
      landCompetingWrite(sessions, sessionId, (session) =>
        setFragmentEnabled(session, { category: 'style', text: 'ink wash' }, false))
    }

    const kept = await request(`${url}/v1/data/muse/sessions/${sessionId}/kept`, {
      method: 'POST', headers: HEADERS, body: { prompt: 'a lantern-keeper, ink wash', paid: false },
    })
    assert.equal(kept.status, 201, `the keep lands, not refused: ${JSON.stringify(kept.body)}`)
    assert.deepEqual(sessions.saveAttempts, [0, 1], 'the losing attempt was retried against the fresh version')

    const stored = sessions.store.get(sessionId)
    assert.ok(stored)
    assert.deepEqual(
      stored.session.keptRolls,
      [{ prompt: 'a lantern-keeper, ink wash', paid: false }],
      'the kept roll survived',
    )
    assert.equal(
      stored.session.floor.get(fragmentKey({ category: 'style', text: 'ink wash' }))?.enabled, false,
      'and so did the concurrent floor change',
    )
  } finally {
    await closeServer(server)
  }
})
