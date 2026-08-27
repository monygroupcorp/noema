// =============================================================================
// Private generation, phase 1 (noema-347)
// =============================================================================
//
// The four properties the feature stands on, each pinned so that reverting the
// mechanism it guards makes the test fail:
//
//   1. a private run's persisted exitus contains no fetchable http(s) URL
//   2. a non-owner run read never receives a presigned private URL
//   3. the moderation/triage fetch path can read a private output
//   4. an absent `privateOutputs` preference generates PUBLIC
//
// Plus the fallout each of those implies: the feed's imago filter, the publish
// refusal, and the toggle's refusal on a deployment with no private bucket.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'

import { CrystalApi } from '../../../src/allocutio/api/CrystalApi.js'
import { ApiError } from '../../../src/allocutio/api/errors.js'
import { handleExecutionWebhook } from '../../../src/api/webhooks/executionWebhook.js'
import { createVestigiumFromActum } from '../../../src/execution/hooks/vestigiumHook.js'
import { RunPodCursor } from '../../../src/crystal/RunPodCursor.js'
import type { RunPodClient } from '../../../src/crystal/RunPodCursor.js'
import type { R2Config } from '../../../src/crystal/comfyrunnerClient.js'
import {
  httpMediaFetcher,
  isPrivateMarker,
  privateMarker,
  registerPrivateMediaResolver,
} from '../../../src/crystal/MediaFetcher.js'
import { MemoryActorum } from '../../../src/execution/MemoryActorum.js'
import { MemoryModorum } from '../../../src/execution/MemoryModorum.js'
import type { Actum } from '../../../src/types/actum.js'
import type { Modus } from '../../../src/types/modus.js'
import type { Generatio } from '../../../src/types/consuetudo.js'
import type { AuctorKey } from '../../../src/flow/types.js'
import type { Vestigium, Vestigiorum } from '../../../src/types/vestigium.js'

// ── Fixtures ─────────────────────────────────────────────────────────────────

const PRIVATE_R2: R2Config = {
  endpoint: 'https://account.r2.cloudflarestorage.com',
  accessKeyId: 'key-id',
  secretAccessKey: 'key-secret',
  bucket: 'private-outputs-bucket',
}

const PUBLIC_URL = 'https://cdn.example/outputs/1700000000000-out.png'

function makeModus(over: Partial<Modus> = {}): Modus {
  return {
    id: 'flow-under-test',
    ministerium: 'runpod',
    nomen: 'Flow under test',
    aditus: {},
    exitus: { image: { type: 'image' } },
    ...over,
  } as Modus
}

function makeActum(over: Partial<Actum> = {}): Actum {
  return {
    id: 'act-1',
    modusId: 'flow-under-test',
    status: 'nascens',
    aditus: { prompt: 'a still life' },
    impetus: 10n,
    inceptum: new Date('2026-08-26T00:00:00.000Z'),
    ...over,
  } as Actum
}

/** A RunPodClient that records what it was handed and reports a job id. */
function recordingClient() {
  const seen: Array<{ r2?: R2Config }> = []
  const client: RunPodClient = {
    async submit(params) {
      seen.push({ ...(params.r2 ? { r2: params.r2 } : {}) })
      return { id: 'pod-job-1' }
    },
  }
  return { client, seen }
}

async function dispatchWith(opts: {
  generatio?: Generatio
  privateOutputsR2?: R2Config
}): Promise<{ actum: Actum; submitted: { r2?: R2Config } }> {
  const modorum = new MemoryModorum()
  await modorum.register(makeModus())
  const actorum = new MemoryActorum()
  const created = await actorum.create(makeActum({ bursaToken: 'purse-token-1' }))
  const { client, seen } = recordingClient()

  const cursor = new RunPodCursor(
    client,
    async () => ({ hash: 'sha256:deadbeef', input: { workflow: {}, models: [] } }),
    modorum,
    actorum,
    {
      webhookUrl: 'https://host.example/webhooks/runpod',
      consuetudinum: { async resolveGeneratio() { return opts.generatio } },
      ...(opts.privateOutputsR2 ? { privateOutputsR2: opts.privateOutputsR2 } : {}),
    },
  )

  await cursor.run(created)
  const after = await actorum.findById(created.id)
  assert.ok(after)
  return { actum: after, submitted: seen[0] ?? {} }
}

// ── 4. An absent preference generates PUBLIC ─────────────────────────────────

test('absent privateOutputs preference generates PUBLIC', async () => {
  const { actum, submitted } = await dispatchWith({
    generatio: { style: 'cinematic' },      // every other preference set, this one absent
    privateOutputsR2: PRIVATE_R2,           // a bucket IS configured — the preference is the gate
  })

  assert.equal(actum.executio?.privateOutputs, undefined, 'no privacy stamp on the run')
  assert.equal(submitted.r2, undefined, 'the job carries no private store override')
})

test('a caller with no stored preferences at all generates PUBLIC', async () => {
  const { actum, submitted } = await dispatchWith({ privateOutputsR2: PRIVATE_R2 })
  assert.equal(actum.executio?.privateOutputs, undefined)
  assert.equal(submitted.r2, undefined)
})

test('privateOutputs:true stamps the run and overrides the job store with an owner-scoped prefix', async () => {
  const { actum, submitted } = await dispatchWith({
    generatio: { privateOutputs: true },
    privateOutputsR2: PRIVATE_R2,
  })

  assert.equal(actum.executio?.privateOutputs, true, 'the run is stamped private at dispatch')
  assert.equal(submitted.r2?.bucket, PRIVATE_R2.bucket)
  assert.equal(submitted.r2?.publicUrl, undefined, 'the private store has no public binding')
  assert.ok(submitted.r2?.keyPrefix?.startsWith('private-outputs/'))
  // The namespace is the owner's, hashed — derived here rather than imported, so the assertion
  // is about the scheme and not about the implementation agreeing with itself.
  const ownerKey = 'bursa:' + createHash('sha256').update('purse-token-1').digest('hex')
  assert.equal(submitted.r2?.keyPrefix, `private-outputs/${createHash('sha256').update(ownerKey).digest('hex').slice(0, 16)}/`)
})

test('privateOutputs:true with no private bucket configured generates PUBLIC rather than falling back', async () => {
  const { actum, submitted } = await dispatchWith({ generatio: { privateOutputs: true } })
  assert.equal(actum.executio?.privateOutputs, undefined)
  assert.equal(submitted.r2, undefined, 'never the public bucket under a private key scheme')
})

// ── 1. A private run's persisted exitus carries no fetchable URL ──────────────

function webhookDeps(actorum: MemoryActorum) {
  const completed: Actum[] = []
  return {
    deps: {
      actorum,
      completor: {
        async complete(actum: Actum, exitus: { exitus: Record<string, unknown>; impetus: bigint }) {
          const done = await actorum.update(actum.id, {
            status: 'completus',
            exitus: exitus.exitus,
            impetus: exitus.impetus,
          })
          completed.push(done)
          return done
        },
        async fail() { /* not exercised */ },
      },
    } as never,
    completed,
  }
}

async function completeRun(actum: Actum, output: unknown[]): Promise<Actum> {
  const actorum = new MemoryActorum()
  await actorum.create(actum)
  const { deps, completed } = webhookDeps(actorum)
  const res = await handleExecutionWebhook(
    { body: { id: actum.externusJobId, status: 'COMPLETED', output, executionTime: 1000 }, rawBody: '' },
    deps,
  )
  assert.equal(res.status, 200, JSON.stringify(res.body))
  assert.equal(completed.length, 1, 'the run completed')
  return completed[0]
}

test("a private run's persisted exitus contains no fetchable http(s) URL", async () => {
  const done = await completeRun(
    makeActum({ externusJobId: 'pod-job-1', executio: { privateOutputs: true } }),
    [{ key: 'private-outputs/abcdef0123456789/f1e2d3c4.png' }],
  )

  const values = Object.values(done.exitus ?? {})
  assert.ok(values.length > 0, 'the run produced an exitus')
  for (const v of values) {
    assert.ok(
      typeof v !== 'string' || !/^https?:\/\//i.test(v),
      `persisted a fetchable URL for a private run: ${String(v)}`,
    )
  }
  assert.ok(isPrivateMarker(done.exitus?.image), 'the declared exitus porta holds a marker')
  assert.ok(String(done.exitus?.image).endsWith('.png'), 'the marker keeps its extension')
})

test('a private run drops a raw http(s) output item rather than persisting it', async () => {
  const done = await completeRun(
    makeActum({ id: 'act-2', externusJobId: 'pod-job-2', executio: { privateOutputs: true } }),
    [{ url: PUBLIC_URL }, { key: 'private-outputs/abcdef0123456789/aaaa.png' }],
  )
  const serialised = JSON.stringify(done.exitus ?? {})
  assert.ok(!serialised.includes('cdn.example'), 'the public URL never reached the record')
  assert.ok(isPrivateMarker(done.exitus?.image))
})

test('a PUBLIC run still persists its URL unchanged', async () => {
  const done = await completeRun(
    makeActum({ id: 'act-3', externusJobId: 'pod-job-3' }),
    [{ url: PUBLIC_URL }],
  )
  assert.equal(done.exitus?.image, PUBLIC_URL)
})

// ── Feed fallout: a marker yields no imagoUrl, and never throws ───────────────

test('a private run yields no imagoUrl, so it never surfaces in the feed', async () => {
  const written: Vestigium[] = []
  const vestigiorum = {
    async create(v: Omit<Vestigium, 'id' | 'natum'>) {
      const rec = { ...v, id: 'vest-1', natum: new Date() } as Vestigium
      written.push(rec)
      return rec
    },
    async indexPromptum() {}, async indexImago() {}, async indexIntella() {},
  } as unknown as Vestigiorum

  const actum = makeActum({
    status: 'completus',
    exitus: { image: privateMarker('private-outputs/abcdef0123456789/bbbb.png') },
  })

  const v = await createVestigiumFromActum(actum, { animaId: 'anima-1' }, vestigiorum)
  assert.equal(v.imagoUrl, undefined, 'the http(s) filter rejects the marker')
  assert.equal(written.length, 1, 'the hook completed rather than throwing')
})

// ── 2. A non-owner run read never receives a presigned private URL ────────────

const MARKER_KEY = 'private-outputs/abcdef0123456789/cccc.png'

function apiWithPrivateRun(over: { ownsAny?: boolean } = {}) {
  const presigned: string[] = []
  const actum = makeActum({
    status: 'completus',
    signaConsumed: ['signum-1'],
    executio: { privateOutputs: true },
    exitus: { image: privateMarker(MARKER_KEY) },
  })
  const api = new CrystalApi({
    actorum: {
      async findById() { return actum },
      async findByCompositum() { return [] },
    },
    signorum: { async ownsAny() { return over.ownsAny ?? false } },
    privateOutputs: {
      store: {
        async getSignedDownloadUrl(key: string) {
          const url = `https://account.r2.cloudflarestorage.com/${key}?X-Amz-Signature=deadbeef`
          presigned.push(url)
          return url
        },
      },
    },
  } as never)
  return { api, presigned }
}

test('a non-owner run read never receives a presigned private URL', async () => {
  const { api, presigned } = apiWithPrivateRun({ ownsAny: false })

  await assert.rejects(
    () => api.getRun({ animaId: 'not-the-owner' }, 'act-1'),
    (err: unknown) => err instanceof ApiError && err.code === 'not_found.run',
  )
  assert.equal(presigned.length, 0, 'nothing was presigned for a caller who does not own the run')
})

test('the OWNER receives a presigned link in place of the marker', async () => {
  const { api, presigned } = apiWithPrivateRun({ ownsAny: true })

  const run = await api.getRun({ animaId: 'the-owner' }, 'act-1')
  assert.equal(presigned.length, 1)
  assert.equal(run.exitus?.image, presigned[0])
  assert.ok(!isPrivateMarker(run.exitus?.image), 'the owner gets a usable link, not the marker')
})

test('with no private store configured the owner gets the marker, never a public URL', async () => {
  const actum = makeActum({
    status: 'completus',
    signaConsumed: ['signum-1'],
    executio: { privateOutputs: true },
    exitus: { image: privateMarker(MARKER_KEY) },
  })
  const api = new CrystalApi({
    actorum: { async findById() { return actum }, async findByCompositum() { return [] } },
    signorum: { async ownsAny() { return true } },
  } as never)

  const run = await api.getRun({ animaId: 'the-owner' }, 'act-1')
  assert.ok(isPrivateMarker(run.exitus?.image), 'degrades to an opaque marker, not a public URL')
})

// ── 3. The moderation/triage fetch path can read a private output ─────────────

test('the moderation/triage fetch path can read a private output', async () => {
  const bytes = Buffer.from('private-image-bytes')
  const asked: string[] = []
  registerPrivateMediaResolver({
    async fetch(key: string) { asked.push(key); return bytes },
  })
  try {
    const got = await httpMediaFetcher.fetch(privateMarker(MARKER_KEY))
    assert.deepEqual(asked, [MARKER_KEY], 'resolved through the private store, not the network')
    assert.ok(got.equals(bytes))
  } finally {
    registerPrivateMediaResolver(undefined)
  }
})

test('a marker with no resolver registered fails loudly rather than hitting the network', async () => {
  registerPrivateMediaResolver(undefined)
  await assert.rejects(
    () => httpMediaFetcher.fetch(privateMarker(MARKER_KEY)),
    /private media unavailable/,
  )
})

// ── The toggle, and the publish refusal ──────────────────────────────────────

test('enabling privateOutputs is refused where no private bucket is configured', async () => {
  const stored: Generatio[] = []
  const api = new CrystalApi({
    consuetudinum: {
      async resolveGeneratio() { return undefined },
      async setGeneratio(_a: AuctorKey, g: Generatio) { stored.push(g) },
    },
  } as never)

  await assert.rejects(
    () => api.setGeneratio({ animaId: 'anima-1' }, { privateOutputs: true }),
    (err: unknown) => err instanceof ApiError && err.code === 'internal.unavailable' && err.httpStatus === 503,
  )
  assert.equal(stored.length, 0, 'a promise the deployment cannot keep is never written')
})

test('privateOutputs persists where a private bucket IS configured', async () => {
  const stored: Generatio[] = []
  const api = new CrystalApi({
    consuetudinum: {
      async resolveGeneratio() { return undefined },
      async setGeneratio(_a: AuctorKey, g: Generatio) { stored.push(g) },
    },
    privateOutputs: { store: { async getSignedDownloadUrl() { return 'https://signed' } } },
  } as never)

  const saved = await api.setGeneratio({ animaId: 'anima-1' }, { privateOutputs: true })
  assert.equal(saved.privateOutputs, true)
  assert.equal(stored.length, 1)
})

test('publishing a private output is refused, not silently re-hosted', async () => {
  const actum = makeActum({
    status: 'completus',
    signaConsumed: ['signum-1'],
    exitus: { image: privateMarker(MARKER_KEY) },
  })
  const api = new CrystalApi({
    actorum: { async findById() { return actum }, async findByCompositum() { return [] } },
    signorum: { async ownsAny() { return true } },
    editiones: { async create(e: unknown) { return e }, async find() { return null }, async update() { return null } },
    publicationAdapters: [{ key: 'feed', async publish() { throw new Error('the adapter must never be reached') } }],
  } as never)

  await assert.rejects(
    () => api.publish({ animaId: 'anima-1' }, { artifact: { kind: 'actum', id: 'act-1' }, visibility: 'feed' } as never),
    (err: unknown) => err instanceof ApiError && err.code === 'internal.unavailable',
  )
})
