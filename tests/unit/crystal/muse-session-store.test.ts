// =============================================================================
// Muse session — store round-trip, mother purity, and owner scoping
// =============================================================================
//
// Runs against a LIVE Mongo (the `test:crystal` job / an ephemeral mongo:7), the
// same shape as `MongoCollectio.test.ts`. A session store test wants the real
// driver: the two things most likely to break here — a `SteerState` Map that
// does not survive BSON, and a fragment identity that is not a legal field name
// — are both invisible to an in-memory double.
//
// Three claims, one per proof the item is gated on:
//
//   1. A SESSION CANNOT BE READ BY ANYONE BUT ITS OWNER. Driven through the real
//      HTTP surface with two identities. This is the class of defect where a
//      route trusts a caller-supplied scope value; test-green is not authz-safe,
//      so the check is made against the live router, not against the store.
//
//   2. A SESSION WRITE NEVER TOUCHES THE MOTHER DATASET. The dataset is the
//      starter and stays pure — a session copies what it was spawned from. The
//      mother's stored document is captured before the session is steered and
//      compared afterwards.
//
//   3. A SESSION SURVIVES A STORE ROUND-TRIP WITH ITS FLOOR AND LEDGER INTACT.
//      The floor comes back as a Map the sampler can read, keyed by fragment
//      identity, and the piece ledger keeps its lineage.
//
//   4. TWO OVERLAPPING WRITES CANNOT LOSE ONE ANOTHER. A save replaces the
//      stored session wholesale, so what keeps a piece and a concurrent floor
//      change from eating each other is the version match on the write. Proven
//      against the real driver because the match is a query, not a value.
// =============================================================================

import { test, before, after, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import express from 'express'
import { MongoClient, Collection } from 'mongodb'

import { MongoMuseSession } from '../../../src/crystal/MongoMuseSession.js'
import { MongoDataset } from '../../../src/crystal/MongoDataset.js'
import { CrystalApi, type CrystalApiDeps } from '../../../src/allocutio/api/CrystalApi.js'
import { createApiRouter, type Identity } from '../../../src/allocutio/api/apiRouter.js'
import { Errors } from '../../../src/allocutio/api/errors.js'
import { fragmentKey, type Fragment } from '../../../src/crystal/muse/taxonomy.js'
import { isMuseSessionVersionConflict } from '../../../src/types/museSession.js'
import { spawnSession, recordPiece, setFragmentEnabled, setFragmentWeight, withSessionDataset } from '../../../src/crystal/muse/session.js'
import type { Piece } from '../../../src/crystal/muse/session.js'
import type { Dataset } from '../../../src/types/dataset.js'
import type { AuctorKey } from '../../../src/flow/types.js'
import type { Credentials, ResolvedCaller } from '../../../src/allocutio/api/IdentityResolver.js'

const URI = process.env.MONGO_PASS ?? process.env.MONGODB_URI ?? 'mongodb://localhost:27017'
const DB = 'noemaplane_test'
const SESSIONS_COL = 'muse_sessions_unit'
const DATASETS_COL = 'datasets_unit'

let client: MongoClient
let sessionsCol: Collection
let datasetsCol: Collection
let sessions: MongoMuseSession
let datasets: MongoDataset

before(async () => {
  client = new MongoClient(URI)
  await client.connect()
  sessionsCol = client.db(DB).collection(SESSIONS_COL)
  datasetsCol = client.db(DB).collection(DATASETS_COL)
  await sessionsCol.createIndex({ id: 1 }, { unique: true })
  await datasetsCol.createIndex({ id: 1 }, { unique: true })
  sessions = new MongoMuseSession(sessionsCol)
  datasets = new MongoDataset(datasetsCol)
})
afterEach(async () => {
  await sessionsCol.deleteMany({})
  await datasetsCol.deleteMany({})
})
after(async () => {
  await client.db(DB).dropCollection(SESSIONS_COL).catch(() => {})
  await client.db(DB).dropCollection(DATASETS_COL).catch(() => {})
  await client.close()
})

// ── Fixtures ─────────────────────────────────────────────────────────────────
// Neutral, invented content. A fragment identity is `category:text`, so the
// texts here deliberately include a dot and a leading `$` — the two characters
// Mongo gives its own meaning inside a field name. That is what makes the
// entry-array floor load-bearing rather than stylistic.

const FRAGMENTS: Fragment[] = [
  { category: 'subject', text: 'a lantern-keeper', source: 'board-a', trigger: 'trigword' },
  { category: 'style', text: 'ink.wash', source: 'board-a', trigger: 'trigword' },
  { category: 'lighting', text: '$dusk glow', source: 'board-b', trigger: 'trigword' },
]

async function seedDataset(owner: string, fragments: Fragment[] = FRAGMENTS): Promise<Dataset> {
  return datasets.create({
    owner,
    name: 'sample-set',
    modality: 'image',
    custody: 'local',
    media: [
      { id: 'media-1', url: 'https://example.invalid/one.png', source: 'upload', addedAt: new Date(), fragments: fragments.slice(0, 2) },
      { id: 'media-2', url: 'https://example.invalid/two.png', source: 'upload', addedAt: new Date(), fragments: fragments.slice(2) },
    ],
    captionsets: [],
    versions: [{ v: '1.0.0', count: 2, when: new Date() }],
  })
}

// ── The live HTTP surface, over the REAL stores ──────────────────────────────

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

function createServer(): Promise<{ server: http.Server; url: string }> {
  const deps = { datasets, museSessions: sessions } as unknown as CrystalApiDeps
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

// ── PROOF 3: the round-trip ──────────────────────────────────────────────────

test('a session survives a store round-trip with its floor and ledger intact', async () => {
  const spawned = spawnSession('dataset-1', FRAGMENTS)
  const steered = setFragmentWeight(
    setFragmentEnabled(spawned, { category: 'style', text: 'ink.wash' }, false),
    { category: 'lighting', text: '$dusk glow' },
    4,
  )
  const withPiece = recordPiece(steered, {
    runId: 'run-1',
    rollIndex: 0,
    fragments: [FRAGMENTS[0]!, FRAGMENTS[2]!],
    reaction: 'up',
    saved: true,
  })

  const created = await sessions.create({ owner: 'anima-1', session: withPiece })
  const read = await sessions.find(created.id)
  assert.ok(read, 'the session reads back')

  // The envelope.
  assert.equal(read.owner, 'anima-1')
  assert.ok(read.natum instanceof Date)
  assert.ok(read.mutatum instanceof Date)

  // The floor is a Map again — the sampler's own type, not an array — keyed by
  // fragment identity, with the steer that was applied before the write.
  assert.equal(read.session.motherDatasetId, 'dataset-1')
  assert.equal(read.session.fragments.length, 3)
  assert.equal(read.session.floor.size, 3)
  assert.equal(read.session.floor.get(fragmentKey({ category: 'style', text: 'ink.wash' }))?.enabled, false)
  assert.equal(read.session.floor.get(fragmentKey({ category: 'lighting', text: '$dusk glow' }))?.weight, 4)
  assert.equal(read.session.floor.get(fragmentKey({ category: 'subject', text: 'a lantern-keeper' }))?.enabled, true)

  // The ledger, with the lineage that is not recoverable after the fact.
  assert.equal(read.session.pieces.length, 1)
  const piece = read.session.pieces[0]!
  assert.equal(piece.runId, 'run-1')
  assert.equal(piece.reaction, 'up')
  assert.equal(piece.saved, true)
  assert.equal(piece.dismissed, false)
  assert.deepEqual(piece.fragments.map((f) => fragmentKey(f)), [
    fragmentKey(FRAGMENTS[0]!),
    fragmentKey(FRAGMENTS[2]!),
  ])
})

test('a session carries the id of its own dataset through a store round-trip', async () => {
  // `toDoc`/`fromDoc` ENUMERATE the session's fields, so a field they do not name is
  // dropped on the way to Mongo and again on the way back — silently, with nothing
  // failing. This is the round-trip that says the session's own dataset id is not one of
  // them: dropped, a session would mint a fresh dataset on every save instead of
  // appending to the one it already has.
  const spawned = spawnSession('dataset-1', FRAGMENTS)
  assert.equal(spawned.sessionDatasetId, undefined, 'a session names no dataset before its first save')

  const created = await sessions.create({ owner: 'anima-1', session: spawned })
  assert.equal((await sessions.find(created.id))?.session.sessionDatasetId, undefined,
    'and none is invented for it on the way through the store')

  const named = withSessionDataset(spawned, 'dataset-of-the-session')
  const saved = await sessions.save(created.id, named, created.versio ?? 0)
  assert.equal(saved?.session.sessionDatasetId, 'dataset-of-the-session')

  const read = await sessions.find(created.id)
  assert.equal(read?.session.sessionDatasetId, 'dataset-of-the-session', 'the id survived the write and the read')
  assert.equal(read?.session.motherDatasetId, 'dataset-1', 'and the mother is still the mother')

  // The document itself carries it — a value read back off the in-memory object rather
  // than off Mongo would prove nothing about persistence.
  const doc = await sessionsCol.findOne({ id: created.id }) as unknown as
    { session: { sessionDatasetId?: string; motherDatasetId: string } } | null
  assert.equal(doc?.session.sessionDatasetId, 'dataset-of-the-session')
  assert.equal(doc?.session.motherDatasetId, 'dataset-1')
})

test('a save replaces the stored session and bumps mutatum; an unknown id is never created', async () => {
  const created = await sessions.create({ owner: 'anima-1', session: spawnSession('dataset-1', FRAGMENTS) })
  const next = setFragmentEnabled(created.session, { category: 'style', text: 'ink.wash' }, false)

  const saved = await sessions.save(created.id, next, created.versio ?? 0)
  assert.ok(saved)
  assert.ok(saved.mutatum.getTime() >= created.mutatum.getTime())
  assert.equal(saved.versio, 1, 'a save stamps the next version')

  const read = await sessions.find(created.id)
  assert.equal(read?.session.floor.get(fragmentKey({ category: 'style', text: 'ink.wash' }))?.enabled, false)

  assert.equal(await sessions.save('id-that-does-not-exist', next, 0), null)
  assert.equal(await sessions.find('id-that-does-not-exist'), null)
  assert.equal(await sessionsCol.countDocuments({}), 1)
})

// ── PROOF 4: two overlapping writes cannot lose one another (noema-309) ──────
//
// A save replaces the stored session WHOLESALE, so the discipline that keeps two
// overlapping mutations from eating each other is the version match on the write
// — not anything in the pure module, which never sees the store. These are the
// tests that hold it. They are non-vacuous in the strict sense: delete the
// version match from `MongoMuseSession.save`'s filter and the first one fails on
// the assertion that both writes survived.

test('a save from a stale read is refused, and re-applying the mutator keeps BOTH writes', async () => {
  const created = await sessions.create({ owner: 'anima-1', session: spawnSession('dataset-1', FRAGMENTS) })

  // Two callers read the same session — the interleaving that produces a lost
  // update. In production these are two concurrent requests: a piece landing
  // while the floor is being steered.
  const readA = await sessions.find(created.id)
  const readB = await sessions.find(created.id)
  assert.ok(readA && readB)

  // A lands first: it records a piece.
  const withPiece = recordPiece(readA.session, {
    runId: 'run-a', rollIndex: 0, fragments: [FRAGMENTS[0]!],
  })
  const landed = await sessions.save(readA.id, withPiece, readA.versio ?? 0)
  assert.ok(landed)

  // B now tries to write a floor change computed from its OWN, now-stale read.
  // Under a bare replace this write lands and the piece is gone.
  const staleFloor = setFragmentEnabled(readB.session, { category: 'style', text: 'ink.wash' }, false)
  await assert.rejects(
    () => sessions.save(readB.id, staleFloor, readB.versio ?? 0),
    (err: unknown) => isMuseSessionVersionConflict(err),
    'a stale-version save is refused, not landed',
  )

  // Nothing of B's landed: the refusal writes nothing at all.
  const afterRefusal = await sessions.find(created.id)
  assert.equal(afterRefusal?.session.pieces.length, 1)
  assert.equal(
    afterRefusal?.session.floor.get(fragmentKey({ category: 'style', text: 'ink.wash' }))?.enabled, true,
    'the refused write left the floor as the winner wrote it',
  )

  // B re-reads and re-applies its own mutator to the FRESH session — the recovery
  // the API layer performs automatically.
  const fresh = await sessions.find(created.id)
  assert.ok(fresh)
  const merged = setFragmentEnabled(fresh.session, { category: 'style', text: 'ink.wash' }, false)
  const second = await sessions.save(fresh.id, merged, fresh.versio ?? 0)
  assert.ok(second)

  // BOTH writes are in the final document. This is the assertion the version
  // match exists for.
  const final = await sessions.find(created.id)
  assert.equal(final?.session.pieces.length, 1, "A's piece survived B's write")
  assert.equal(final?.session.pieces[0]?.runId, 'run-a')
  assert.equal(
    final?.session.floor.get(fragmentKey({ category: 'style', text: 'ink.wash' }))?.enabled, false,
    "B's floor change survived too",
  )
  assert.equal(final?.versio, 2, 'two landed writes, two version bumps')
})

test('a document written before versio existed saves on its first attempt and is versioned from then on', async () => {
  // The compatibility path, and the reason this change needs no backfill. The
  // document is inserted WITHOUT the field, exactly as an earlier write left it.
  const spawned = spawnSession('dataset-1', FRAGMENTS)
  const now = new Date()
  await sessionsCol.insertOne({
    id: 'session-without-a-version',
    owner: 'anima-1',
    session: { motherDatasetId: 'dataset-1', fragments: [...spawned.fragments], floor: [], pieces: [] },
    natum: now,
    mutatum: now,
  })

  const read = await sessions.find('session-without-a-version')
  assert.ok(read)
  assert.equal(read.versio, 0, 'an absent version reads as 0')

  const next = setFragmentWeight(read.session, { category: 'subject', text: 'a lantern-keeper' }, 4)
  const saved = await sessions.save(read.id, next, read.versio ?? 0)
  assert.ok(saved, 'the first save of a pre-versio document lands')
  assert.equal(saved.versio, 1)

  // And the CAS is live from that point — a second write from the same stale read
  // is refused.
  await assert.rejects(
    () => sessions.save(read.id, next, read.versio ?? 0),
    (err: unknown) => isMuseSessionVersionConflict(err),
  )
})

// ── PROOF 2: the mother stays pure ───────────────────────────────────────────

test('a session write never touches the mother dataset', async () => {
  const { server, url } = await createServer()
  try {
    const headers = { 'x-api-key': 'anima-1' }
    const dataset = await seedDataset('anima-1')

    const spawned = await request(`${url}/v1/data/muse/sessions`, { method: 'POST', headers, body: { datasetId: dataset.id } })
    assert.equal(spawned.status, 201)
    const sessionId = spawned.body.session.id

    // The mother's stored document, captured after the spawn and before any steer.
    const before = await datasetsCol.findOne({ id: dataset.id })
    assert.ok(before)

    const disabled = await request(`${url}/v1/data/muse/sessions/${sessionId}/floor/enabled`, {
      method: 'PATCH', headers, body: { category: 'style', text: 'ink.wash', enabled: false },
    })
    assert.equal(disabled.status, 200)

    const weighted = await request(`${url}/v1/data/muse/sessions/${sessionId}/floor/weight`, {
      method: 'PATCH', headers, body: { category: 'lighting', text: '$dusk glow', weight: 6 },
    })
    assert.equal(weighted.status, 200)

    const recorded = await request(`${url}/v1/data/muse/sessions/${sessionId}/pieces`, {
      method: 'POST', headers,
      body: { runId: 'run-1', rollIndex: 0, fragments: [{ category: 'subject', text: 'a lantern-keeper' }], reaction: 'up' },
    })
    assert.equal(recorded.status, 201)

    // Three session writes later, the mother's document is byte-for-byte what it was.
    const after = await datasetsCol.findOne({ id: dataset.id })
    assert.deepEqual(after, before, 'the mother dataset document changed under a session write')

    // And the session's own collection is the only one that grew.
    assert.equal(await sessionsCol.countDocuments({}), 1)
    assert.equal(await datasetsCol.countDocuments({}), 1)

    // The session's fragments are its OWN copies: darkening one leaves the
    // mother's fragment list untouched.
    const motherFragments = (after as unknown as Dataset).media.flatMap((m) => m.fragments ?? [])
    assert.equal(motherFragments.length, 3)
    assert.deepEqual(motherFragments.map((f) => fragmentKey(f)), FRAGMENTS.map((f) => fragmentKey(f)))
  } finally {
    await closeServer(server)
  }
})

// ── PROOF 1: owner scoping ───────────────────────────────────────────────────

test('a session cannot be read by anyone but its owner', async () => {
  const { server, url } = await createServer()
  try {
    const owner = { 'x-api-key': 'anima-1' }
    const stranger = { 'x-api-key': 'anima-2' }
    const dataset = await seedDataset('anima-1')

    const spawned = await request(`${url}/v1/data/muse/sessions`, { method: 'POST', headers: owner, body: { datasetId: dataset.id } })
    assert.equal(spawned.status, 201)
    const sessionId = spawned.body.session.id

    // The owner reads it.
    const mine = await request(`${url}/v1/data/muse/sessions/${sessionId}`, { headers: owner })
    assert.equal(mine.status, 200)
    assert.equal(mine.body.session.id, sessionId)

    // A stranger passing the same id gets not-found — and the SAME error an id
    // that never existed gets, so the surface does not confirm it exists.
    const theirs = await request(`${url}/v1/data/muse/sessions/${sessionId}`, { headers: stranger })
    const absent = await request(`${url}/v1/data/muse/sessions/id-that-does-not-exist`, { headers: stranger })
    assert.equal(theirs.status, 404)
    assert.equal(theirs.status, absent.status)
    assert.equal(theirs.body.error.code, absent.body.error.code)
    assert.equal(theirs.body.session, undefined, "a stranger's read returned a session body")
  } finally {
    await closeServer(server)
  }
})

test('a session cannot be steered or written by anyone but its owner', async () => {
  const { server, url } = await createServer()
  try {
    const owner = { 'x-api-key': 'anima-1' }
    const stranger = { 'x-api-key': 'anima-2' }
    const dataset = await seedDataset('anima-1')

    const spawned = await request(`${url}/v1/data/muse/sessions`, { method: 'POST', headers: owner, body: { datasetId: dataset.id } })
    const sessionId = spawned.body.session.id

    const attempts = [
      request(`${url}/v1/data/muse/sessions/${sessionId}/floor/enabled`, {
        method: 'PATCH', headers: stranger, body: { category: 'style', text: 'ink.wash', enabled: false },
      }),
      request(`${url}/v1/data/muse/sessions/${sessionId}/floor/weight`, {
        method: 'PATCH', headers: stranger, body: { category: 'style', text: 'ink.wash', weight: 8 },
      }),
      request(`${url}/v1/data/muse/sessions/${sessionId}/pieces`, {
        method: 'POST', headers: stranger,
        body: { runId: 'run-x', rollIndex: 0, fragments: [{ category: 'subject', text: 'a lantern-keeper' }] },
      }),
    ]
    for (const result of await Promise.all(attempts)) assert.equal(result.status, 404)

    // No mutation landed: the owner's session is exactly as it was spawned.
    const stored = await sessions.find(sessionId)
    assert.equal(stored?.session.pieces.length, 0)
    assert.equal(stored?.session.floor.get(fragmentKey({ category: 'style', text: 'ink.wash' }))?.enabled, true)
    assert.equal(stored?.session.floor.get(fragmentKey({ category: 'style', text: 'ink.wash' }))?.weight, 1)
  } finally {
    await closeServer(server)
  }
})

test('a session cannot be spawned off a dataset the caller does not own', async () => {
  const { server, url } = await createServer()
  try {
    const dataset = await seedDataset('anima-1')
    const attempt = await request(`${url}/v1/data/muse/sessions`, {
      method: 'POST', headers: { 'x-api-key': 'anima-2' }, body: { datasetId: dataset.id },
    })
    assert.equal(attempt.status, 404)
    assert.equal(await sessionsCol.countDocuments({}), 0)
  } finally {
    await closeServer(server)
  }
})

// ── The rest of the surface ──────────────────────────────────────────────────

test('spawn pools fragments across every media item in the dataset', async () => {
  const { server, url } = await createServer()
  try {
    const headers = { 'x-api-key': 'anima-1' }
    const dataset = await seedDataset('anima-1')
    const spawned = await request(`${url}/v1/data/muse/sessions`, { method: 'POST', headers, body: { datasetId: dataset.id } })

    assert.equal(spawned.status, 201)
    // Two of the three fragments live on the first media item and one on the
    // second: a spawn that read a single item would carry fewer than three.
    assert.equal(spawned.body.session.fragments.length, 3)
    assert.equal(spawned.body.session.floor.length, 3)
    assert.equal(spawned.body.session.motherDatasetId, dataset.id)
    for (const entry of spawned.body.session.floor) {
      assert.equal(entry.enabled, true)
      assert.equal(entry.weight, 1)
    }
  } finally {
    await closeServer(server)
  }
})

test('a piece citing a fragment the session does not hold is rejected rather than stored', async () => {
  const { server, url } = await createServer()
  try {
    const headers = { 'x-api-key': 'anima-1' }
    const dataset = await seedDataset('anima-1')
    const spawned = await request(`${url}/v1/data/muse/sessions`, { method: 'POST', headers, body: { datasetId: dataset.id } })
    const sessionId = spawned.body.session.id

    const rejected = await request(`${url}/v1/data/muse/sessions/${sessionId}/pieces`, {
      method: 'POST', headers,
      body: { runId: 'run-1', rollIndex: 0, fragments: [{ category: 'subject', text: 'a fragment nothing decomposed' }] },
    })
    assert.equal(rejected.status, 400)

    const stored = await sessions.find(sessionId)
    assert.equal(stored?.session.pieces.length, 0)
  } finally {
    await closeServer(server)
  }
})

test('a weight is clamped to the sampler bounds and a disabled fragment stays on the floor', async () => {
  const { server, url } = await createServer()
  try {
    const headers = { 'x-api-key': 'anima-1' }
    const dataset = await seedDataset('anima-1')
    const spawned = await request(`${url}/v1/data/muse/sessions`, { method: 'POST', headers, body: { datasetId: dataset.id } })
    const sessionId = spawned.body.session.id

    const weighted = await request(`${url}/v1/data/muse/sessions/${sessionId}/floor/weight`, {
      method: 'PATCH', headers, body: { category: 'style', text: 'ink.wash', weight: 9999 },
    })
    assert.equal(weighted.status, 200)
    const key = fragmentKey({ category: 'style', text: 'ink.wash' })
    assert.equal(weighted.body.session.floor.find((e: { key: string }) => e.key === key).weight, 8)

    const disabled = await request(`${url}/v1/data/muse/sessions/${sessionId}/floor/enabled`, {
      method: 'PATCH', headers, body: { category: 'style', text: 'ink.wash', enabled: false },
    })
    assert.equal(disabled.status, 200)
    // Darkened, not deleted: still on the floor and still in the fragment list.
    assert.equal(disabled.body.session.fragments.length, 3)
    assert.equal(disabled.body.session.floor.length, 3)
    assert.equal(disabled.body.session.floor.find((e: { key: string }) => e.key === key).enabled, false)
  } finally {
    await closeServer(server)
  }
})

// ── The piece update: one entry per run, reachable after it is recorded ──────

/** Spawn a session over a seeded dataset and return the live server plus its id. */
async function spawnFor(url: string, owner: Record<string, string>, datasetId: string): Promise<string> {
  const spawned = await request(`${url}/v1/data/muse/sessions`, { method: 'POST', headers: owner, body: { datasetId } })
  assert.equal(spawned.status, 201)
  return spawned.body.session.id
}

test('recording the same runId twice does not append a second ledger entry', async () => {
  const { server, url } = await createServer()
  try {
    const headers = { 'x-api-key': 'anima-1' }
    const dataset = await seedDataset('anima-1')
    const sessionId = await spawnFor(url, headers, dataset.id)
    const piece = { runId: 'run-1', rollIndex: 0, fragments: [{ category: 'subject', text: 'a lantern-keeper' }] }

    const first = await request(`${url}/v1/data/muse/sessions/${sessionId}/pieces`, { method: 'POST', headers, body: piece })
    assert.equal(first.status, 201)
    assert.equal(first.body.session.pieces.length, 1)

    // The same run again — a client retry, a double-fire — is rejected, not appended.
    const second = await request(`${url}/v1/data/muse/sessions/${sessionId}/pieces`, {
      method: 'POST', headers, body: { ...piece, rollIndex: 1 },
    })
    assert.equal(second.status, 400)

    const stored = await sessions.find(sessionId)
    assert.equal(stored?.session.pieces.length, 1, 'the ledger doubled the lineage of one run')
    assert.equal(stored?.session.pieces[0]!.rollIndex, 0, 'the second record overwrote the first')

    // A different run still records: the guard is about the run, not about recording.
    const other = await request(`${url}/v1/data/muse/sessions/${sessionId}/pieces`, {
      method: 'POST', headers, body: { ...piece, runId: 'run-2', rollIndex: 1 },
    })
    assert.equal(other.status, 201)
    assert.equal(other.body.session.pieces.length, 2)
  } finally {
    await closeServer(server)
  }
})

test('a reaction lands on the piece it names', async () => {
  const { server, url } = await createServer()
  try {
    const headers = { 'x-api-key': 'anima-1' }
    const dataset = await seedDataset('anima-1')
    const sessionId = await spawnFor(url, headers, dataset.id)

    for (const runId of ['run-1', 'run-2']) {
      const recorded = await request(`${url}/v1/data/muse/sessions/${sessionId}/pieces`, {
        method: 'POST', headers,
        body: { runId, rollIndex: runId === 'run-1' ? 0 : 1, fragments: [{ category: 'subject', text: 'a lantern-keeper' }] },
      })
      assert.equal(recorded.status, 201)
    }

    const reacted = await request(`${url}/v1/data/muse/sessions/${sessionId}/pieces/run-2`, {
      method: 'PATCH', headers, body: { reaction: 'up' },
    })
    assert.equal(reacted.status, 200)

    // Read it back from the store, not from the response body: the claim is that the
    // reaction was persisted onto the named piece, not that it was echoed.
    const stored = await sessions.find(sessionId)
    const byRun = new Map((stored?.session.pieces ?? []).map((p: Piece) => [p.runId, p]))
    assert.equal(byRun.get('run-2')?.reaction, 'up')
    assert.equal(byRun.get('run-1')?.reaction, undefined, 'the reaction landed on a piece it did not name')

    // A dismissal is a second, independent field on the same piece.
    const dismissed = await request(`${url}/v1/data/muse/sessions/${sessionId}/pieces/run-2`, {
      method: 'PATCH', headers, body: { dismissed: true },
    })
    assert.equal(dismissed.status, 200)
    const after = await sessions.find(sessionId)
    const updated = after?.session.pieces.find((p: Piece) => p.runId === 'run-2')
    assert.equal(updated?.dismissed, true)
    assert.equal(updated?.reaction, 'up', 'the dismissal cleared the reaction')

    // The lineage the piece was recorded with is untouched by either update.
    assert.equal(updated?.fragments.length, 1)
    assert.equal(updated?.rollIndex, 1)
    assert.equal(after?.session.pieces.length, 2, 'an update appended a ledger entry')
  } finally {
    await closeServer(server)
  }
})

test('a piece update is rejected for a run the ledger does not hold, and for a session the caller does not own', async () => {
  const { server, url } = await createServer()
  try {
    const owner = { 'x-api-key': 'anima-1' }
    const stranger = { 'x-api-key': 'anima-2' }
    const dataset = await seedDataset('anima-1')
    const sessionId = await spawnFor(url, owner, dataset.id)
    await request(`${url}/v1/data/muse/sessions/${sessionId}/pieces`, {
      method: 'POST', headers: owner,
      body: { runId: 'run-1', rollIndex: 0, fragments: [{ category: 'subject', text: 'a lantern-keeper' }] },
    })

    const unknownRun = await request(`${url}/v1/data/muse/sessions/${sessionId}/pieces/run-never-rolled`, {
      method: 'PATCH', headers: owner, body: { reaction: 'up' },
    })
    assert.equal(unknownRun.status, 404)

    // A stranger gets the SESSION not-found — the same answer an id that never existed
    // gets — so the piece-level answer never confirms a session they cannot see.
    const theirs = await request(`${url}/v1/data/muse/sessions/${sessionId}/pieces/run-1`, {
      method: 'PATCH', headers: stranger, body: { reaction: 'up' },
    })
    const absent = await request(`${url}/v1/data/muse/sessions/id-that-does-not-exist/pieces/run-1`, {
      method: 'PATCH', headers: stranger, body: { reaction: 'up' },
    })
    assert.equal(theirs.status, 404)
    assert.equal(theirs.body.error.code, absent.body.error.code)

    // Nothing landed on the owner's piece.
    const stored = await sessions.find(sessionId)
    assert.equal(stored?.session.pieces[0]!.reaction, undefined)

    // An empty patch names no change and is a malformed request rather than a silent no-op.
    const empty = await request(`${url}/v1/data/muse/sessions/${sessionId}/pieces/run-1`, {
      method: 'PATCH', headers: owner, body: {},
    })
    assert.equal(empty.status, 400)
  } finally {
    await closeServer(server)
  }
})

// ── The lookup: a session is found again after the page that spawned it is gone ──

test('a lookup returns only the caller\'s own sessions', async () => {
  const { server, url } = await createServer()
  try {
    const owner = { 'x-api-key': 'anima-1' }
    const stranger = { 'x-api-key': 'anima-2' }
    const dataset = await seedDataset('anima-1')

    const mine = await spawnFor(url, owner, dataset.id)
    // A second identity's session off the SAME mother — the row a lookup keyed on the
    // dataset alone would hand to whoever asked.
    const theirs = await sessions.create({ owner: 'anima-2', session: spawnSession(dataset.id, FRAGMENTS) })

    const asStranger = await request(`${url}/v1/data/muse/sessions?datasetId=${dataset.id}`, { headers: stranger })
    assert.equal(asStranger.status, 200)
    assert.deepEqual(
      asStranger.body.sessions.map((s: { id: string }) => s.id),
      [theirs.id],
      'the lookup returned a session the caller does not own',
    )

    const asOwner = await request(`${url}/v1/data/muse/sessions?datasetId=${dataset.id}`, { headers: owner })
    assert.equal(asOwner.status, 200)
    assert.deepEqual(
      asOwner.body.sessions.map((s: { id: string }) => s.id),
      [mine],
      'the owner does not see their own session',
    )
  } finally {
    await closeServer(server)
  }
})

test('a lookup finds the session a reload lost, most recently changed first', async () => {
  const { server, url } = await createServer()
  try {
    const headers = { 'x-api-key': 'anima-1' }
    const dataset = await seedDataset('anima-1')
    const other = await seedDataset('anima-1')

    const first = await spawnFor(url, headers, dataset.id)
    const second = await spawnFor(url, headers, dataset.id)
    const elsewhere = await spawnFor(url, headers, other.id)

    // Working in the older session moves it to the front: the answer to "which session
    // was I in" is the one last worked in, not the one spawned last.
    const steered = await request(`${url}/v1/data/muse/sessions/${first}/floor/enabled`, {
      method: 'PATCH', headers, body: { category: 'style', text: 'ink.wash', enabled: false },
    })
    assert.equal(steered.status, 200)

    const found = await request(`${url}/v1/data/muse/sessions?datasetId=${dataset.id}`, { headers })
    assert.equal(found.status, 200)
    assert.deepEqual(found.body.sessions.map((s: { id: string }) => s.id), [first, second])

    // Scoped to the mother named, not to every session the caller has.
    assert.ok(!found.body.sessions.some((s: { id: string }) => s.id === elsewhere), 'the lookup crossed datasets')

    // The lookup carries the whole session, so the floor sheet is rehydrated from it
    // without a second round trip.
    const head = found.body.sessions[0]
    assert.equal(head.motherDatasetId, dataset.id)
    assert.equal(head.floor.length, 3)
    assert.equal(
      head.floor.find((e: { key: string }) => e.key === fragmentKey({ category: 'style', text: 'ink.wash' })).enabled,
      false,
    )

    // A dataset with no sessions is an empty list, and a request naming no dataset is malformed.
    const none = await request(`${url}/v1/data/muse/sessions?datasetId=dataset-with-no-sessions`, { headers })
    assert.equal(none.status, 200)
    assert.deepEqual(none.body.sessions, [])
    assert.equal((await request(`${url}/v1/data/muse/sessions`, { headers })).status, 400)
  } finally {
    await closeServer(server)
  }
})
