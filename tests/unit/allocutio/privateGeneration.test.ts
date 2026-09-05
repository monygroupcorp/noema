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
// Plus the fallout each of those implies: the feed's imago filter and the toggle's refusal on
// a deployment with no private bucket. Phase 2 (publishing a private output) is at the foot of
// the file; phase 3 (chaining one back in as an input) sits with the dispatch tests above it.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'

import { CrystalApi } from '../../../src/allocutio/api/CrystalApi.js'
import { ApiError } from '../../../src/allocutio/api/errors.js'
import { handleExecutionWebhook } from '../../../src/api/webhooks/executionWebhook.js'
import { createVestigiumFromActum } from '../../../src/execution/hooks/vestigiumHook.js'
import { RunPodCursor } from '../../../src/crystal/RunPodCursor.js'
import { PROVISION_BUDGET_MS } from '../../../src/crystal/SecurePodClient.js'
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

/** The cursor's own default job ceiling, the second half of a run's wall-clock budget. */
const DEFAULT_MAX_JOB_SECONDS = 1800

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

/** The owner-hashed prefix `purse-token-1`'s private outputs are written under. Derived from the
 *  scheme rather than imported, so an assertion is about the scheme and not about the
 *  implementation agreeing with itself. */
function ownPrefix(bursaToken = 'purse-token-1'): string {
  const ownerKey = 'bursa:' + createHash('sha256').update(bursaToken).digest('hex')
  return `private-outputs/${createHash('sha256').update(ownerKey).digest('hex').slice(0, 16)}/`
}

async function dispatchWith(opts: {
  generatio?: Generatio
  privateOutputsR2?: R2Config
  /** Run inputs, when the test is about what the caller passed in. */
  aditus?: Record<string, unknown>
  /** Omit the purse token, leaving the run with no resolvable owner. */
  unowned?: boolean
  /** Absent → the deployment cannot presign, as on one with no private bucket. */
  presignPrivateInput?: (key: string, o: { expiresIn: number }) => Promise<string>
}): Promise<{
  actum: Actum
  submitted: { r2?: R2Config }
  /** The inputs the compiler was handed — the pod's view, which may differ from the record's. */
  compiled: Record<string, unknown>
  /** Compiled specs persisted by hash, the durable record of what was dispatched. */
  deployments: Array<{ spec: Record<string, unknown> }>
}> {
  const modorum = new MemoryModorum()
  await modorum.register(makeModus())
  const actorum = new MemoryActorum()
  const created = await actorum.create(makeActum({
    ...(opts.unowned ? {} : { bursaToken: 'purse-token-1' }),
    ...(opts.aditus ? { aditus: opts.aditus } : {}),
  }))
  const { client, seen } = recordingClient()

  let compiled: Record<string, unknown> = {}
  const deployments: Array<{ spec: Record<string, unknown> }> = []
  const cursor = new RunPodCursor(
    client,
    // The compiler folds the run's inputs into the spec, as the real one does — so a spec that is
    // stored carries whatever the pod was told to fetch.
    async (_m, a) => { compiled = a; return { hash: 'sha256:deadbeef', input: { workflow: {}, models: [], inputs: a } } },
    modorum,
    actorum,
    {
      webhookUrl: 'https://host.example/webhooks/runpod',
      deployments: {
        async upsert(d) { deployments.push(d as { spec: Record<string, unknown> }) },
        async find() { return null },
      },
      consuetudinum: { async resolveGeneratio() { return opts.generatio } },
      ...(opts.privateOutputsR2 ? { privateOutputsR2: opts.privateOutputsR2 } : {}),
      ...(opts.presignPrivateInput ? { presignPrivateInput: opts.presignPrivateInput } : {}),
    },
  )

  await cursor.run(created)
  const after = await actorum.findById(created.id)
  assert.ok(after)
  return { actum: after, submitted: seen[0] ?? {}, compiled, deployments }
}

/** A presigner that records what it was asked for and mints a distinguishable link. */
function recordingPresigner() {
  const calls: Array<{ key: string; expiresIn: number }> = []
  return {
    calls,
    presign: async (key: string, o: { expiresIn: number }) => {
      calls.push({ key, expiresIn: o.expiresIn })
      return `https://private.example/${key}?sig=minted-${calls.length}`
    },
  }
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

// ── Chaining: a private output used as an INPUT (phase 3) ──────────────────
//
// A pod cannot read a `noema-private://` marker — the bucket it names has no public binding.
// So a chained private input is presigned at dispatch, for the pod alone, and only for a caller
// whose own namespace the object lives in.

test('a chained private input reaches the pod as a link, while the record keeps the marker', async () => {
  const { presign, calls } = recordingPresigner()
  const key = `${ownPrefix()}seed.png`
  const { actum, compiled } = await dispatchWith({
    aditus: { prompt: 'again, colder', image: privateMarker(key) },
    privateOutputsR2: PRIVATE_R2,
    presignPrivateInput: presign,
  })

  assert.equal(calls.length, 1, 'the marker was resolved once')
  assert.equal(calls[0].key, key, 'presigned the object the marker names, not the marker itself')
  assert.match(String(compiled.image), /^https:\/\/private\.example\//, 'the pod is handed a fetchable link')
  assert.equal(compiled.prompt, 'again, colder', 'every other input passes through untouched')

  // The link is minted for this dispatch and nothing else: the durable record still holds the
  // marker, so no stored row carries a handle to a private object.
  assert.equal(actum.aditus.image, privateMarker(key))
})

test('a chained private input is resolved inside a list, keeping its shape and order', async () => {
  const { presign } = recordingPresigner()
  const { compiled } = await dispatchWith({
    aditus: { images: [PUBLIC_URL, privateMarker(`${ownPrefix()}a.png`), privateMarker(`${ownPrefix()}b.png`)] },
    privateOutputsR2: PRIVATE_R2,
    presignPrivateInput: presign,
  })

  const images = compiled.images as string[]
  assert.equal(images.length, 3)
  assert.equal(images[0], PUBLIC_URL, 'a public input is left alone')
  assert.match(images[1], /a\.png/)
  assert.match(images[2], /b\.png/)
  for (const url of images) assert.ok(!isPrivateMarker(url), 'no marker survives into the job body')
})

test('the spec of a chained run is not kept, so no stored row carries the link', async () => {
  const { presign } = recordingPresigner()
  const chained = await dispatchWith({
    aditus: { image: privateMarker(`${ownPrefix()}seed.png`) },
    privateOutputsR2: PRIVATE_R2,
    presignPrivateInput: presign,
  })
  assert.equal(chained.deployments.length, 0, 'a spec holding a minted link is never persisted')
  assert.ok(chained.actum.deploymentHash, 'the dispatch stays traceable by hash')

  // The skip is narrow: an ordinary run's spec is still recorded.
  const plain = await dispatchWith({ aditus: { image: PUBLIC_URL }, privateOutputsR2: PRIVATE_R2 })
  assert.equal(plain.deployments.length, 1)
})

test('the link handed to the pod cannot outlive the run it was minted for', async () => {
  const { presign, calls } = recordingPresigner()
  await dispatchWith({
    aditus: { image: privateMarker(`${ownPrefix()}seed.png`) },
    privateOutputsR2: PRIVATE_R2,
    presignPrivateInput: presign,
  })

  // The run's own wall-clock budget: the pod provisioning window plus the job window. A link
  // that lapses later than that is readable after the run that justified it has ended.
  const runBudgetSeconds = PROVISION_BUDGET_MS / 1000 + DEFAULT_MAX_JOB_SECONDS
  assert.ok(calls[0].expiresIn > 0, 'a link that has already expired is no use to the pod')
  assert.ok(calls[0].expiresIn <= runBudgetSeconds, `link TTL ${calls[0].expiresIn}s outlives the run's ${runBudgetSeconds}s budget`)
})

test('a run fed a private input writes private, even with the preference off', async () => {
  const { presign } = recordingPresigner()
  const { actum, submitted } = await dispatchWith({
    aditus: { image: privateMarker(`${ownPrefix()}seed.png`) },
    generatio: { style: 'cinematic' },       // private generation is NOT on
    privateOutputsR2: PRIVATE_R2,
    presignPrivateInput: presign,
  })

  // Bytes read out of the private bucket must not come back out of a public one.
  assert.equal(actum.executio?.privateOutputs, true, 'the chained run is stamped private')
  assert.equal(submitted.r2?.bucket, PRIVATE_R2.bucket)
  assert.equal(submitted.r2?.publicUrl, undefined)
  assert.equal(submitted.r2?.keyPrefix, ownPrefix())
})

test("a private output of another account is refused as an input, not presigned", async () => {
  const { presign, calls } = recordingPresigner()
  await assert.rejects(
    dispatchWith({
      aditus: { image: privateMarker('private-outputs/00112233445566ff/someone-elses.png') },
      privateOutputsR2: PRIVATE_R2,
      presignPrivateInput: presign,
    }),
    /another account/,
  )
  assert.equal(calls.length, 0, 'nothing was minted for an object the caller has no claim on')
})

test('a run with no resolvable owner cannot chain a private input', async () => {
  const { presign, calls } = recordingPresigner()
  await assert.rejects(
    dispatchWith({
      aditus: { image: privateMarker(`${ownPrefix()}seed.png`) },
      unowned: true,
      privateOutputsR2: PRIVATE_R2,
      presignPrivateInput: presign,
    }),
    /no owner/,
  )
  assert.equal(calls.length, 0)
})

test('chaining is refused where the deployment has no private-outputs store', async () => {
  await assert.rejects(
    dispatchWith({ aditus: { image: privateMarker(`${ownPrefix()}seed.png`) } }),
    /no private-outputs store/,
  )
})

test('a run with no private input dispatches exactly as before', async () => {
  const { presign, calls } = recordingPresigner()
  const { actum, submitted, compiled } = await dispatchWith({
    aditus: { prompt: 'a still life', image: PUBLIC_URL },
    privateOutputsR2: PRIVATE_R2,
    presignPrivateInput: presign,
  })

  assert.equal(calls.length, 0, 'nothing to resolve')
  assert.equal(compiled.image, PUBLIC_URL)
  assert.equal(actum.executio?.privateOutputs, undefined)
  assert.equal(submitted.r2, undefined)
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


// ── Phase 2: publishing a private output copies it OUT ────────────────────────
//
// Publishing is the deliberate act that makes a private output public. It does not move the
// object or change the run: the private bytes stay where they are and the exitus keeps its
// marker. What the publication gets is its OWN public copy, keyed by the Editio — so the
// destination adapter and the feed render something a stranger can fetch, and a retract can
// take those bytes back out again.

/** An in-memory Editionum, enough of one for the publish → settle → retract lane. */
function memoryEditiones() {
  const rows: Array<Record<string, unknown>> = []
  return {
    rows,
    async create(input: Record<string, unknown>) {
      const e = { ...input, id: `ed-${rows.length + 1}`, status: 'pending', natum: new Date(), mutatum: new Date() }
      rows.push(e)
      return e
    },
    async find(id: string) { return rows.find((r) => r.id === id) ?? null },
    async update(id: string, patch: Record<string, unknown>) {
      const e = rows.find((r) => r.id === id)
      if (!e) throw new Error(`no editio ${id}`)
      Object.assign(e, patch)
      return e
    },
    async listFeed() { return rows.filter((r) => r.status === 'published') },
    async listByArtifact() { return [] },
    async listByAuthor() { return [] },
    async listHeld() { return rows.filter((r) => r.reviewOutcome === 'pending') },
    async claimPending() { return null },
  }
}

/** A public object store that records what it was handed, and the bytes it holds. */
function recordingPublicStore() {
  const put: Array<{ key: string; contentType: string; bytes: string }> = []
  const deleted: string[] = []
  return {
    put, deleted,
    store: {
      async put(key: string, bytes: Buffer, contentType: string) {
        put.push({ key, contentType, bytes: bytes.toString() })
        return `https://cdn.example/${key}`
      },
      async del(key: string) { deleted.push(key) },
    },
  }
}

/**
 * A CrystalApi wired for the publication lane over one completed run.
 *
 * `copyOut: false` models a deployment with no public bucket to copy INTO — the one case that
 * is still refused. `gate` installs a moderation gate (only consulted for a public surface).
 */
function publishingApi(opts: {
  exitus: Record<string, unknown>
  copyOut?: boolean
  gate?: { ok: boolean; hold?: boolean }
} = { exitus: {} }) {
  const gate = opts.gate
  const actum = makeActum({ status: 'completus', signaConsumed: ['signum-1'], exitus: opts.exitus })
  const editiones = memoryEditiones()
  const publicStore = recordingPublicStore()
  const publishedWith: Array<Record<string, unknown> | undefined> = []
  const fetched: string[] = []

  const api = new CrystalApi({
    actorum: { async findById() { return actum }, async findByCompositum() { return [] } },
    signorum: { async ownsAny() { return true } },
    editiones,
    publicationAdapters: [{
      key: 'feed',
      async publish(artifact: { output?: Record<string, unknown> }) {
        publishedWith.push(artifact.output)
        return { externalRef: 'feed:post-1' }
      },
      async retract() { /* the feed retract is a status flip */ },
    }],
    ...(gate ? { moderationGate: { async scan() { return { ok: gate.ok, reason: 'because', ...(gate.hold ? { hold: true } : {}) } } } } : {}),
    ...(opts.copyOut === false ? {} : {
      publicationCopyOut: {
        async fetch(ref: string) { fetched.push(ref); return Buffer.from(`bytes-of:${ref}`) },
        store: publicStore.store,
      },
    }),
    privateOutputs: {
      store: { async getSignedDownloadUrl(key: string) { return `https://private.example/${key}?sig=x` } },
    },
  } as never)

  return { api, actum, editiones, publicStore, publishedWith, fetched }
}

const PRIVATE_EXITUS = { image: privateMarker(MARKER_KEY) }

test('publishing a private output copies the bytes into the public store', async () => {
  const { api, publishedWith, publicStore, fetched } = publishingApi({ exitus: PRIVATE_EXITUS })

  const ed = await api.publish({ animaId: 'anima-1' }, { artifact: { kind: 'actum', id: 'act-1' }, visibility: 'unlisted' } as never)
  await api.settlePublication(ed.id)

  assert.deepEqual(fetched, [privateMarker(MARKER_KEY)], 'the bytes were read through the private store')
  assert.equal(publicStore.put.length, 1, 'one object was written to the public bucket')
  assert.ok(publicStore.put[0].key.startsWith(`editiones/${ed.id}/`), 'the copy is keyed by the publication that made it')
  assert.equal(publicStore.put[0].contentType, 'image/png', 'the content type is carried over from the marker')

  // The destination adapter is handed the COPY — no marker survives into a publication.
  const output = publishedWith[0] ?? {}
  assert.equal(output.image, `https://cdn.example/${publicStore.put[0].key}`)
  assert.ok(!isPrivateMarker(output.image), 'the adapter never sees a marker')
})

test('the run itself stays private after its output is published', async () => {
  const { api, actum } = publishingApi({ exitus: PRIVATE_EXITUS })

  const ed = await api.publish({ animaId: 'anima-1' }, { artifact: { kind: 'actum', id: 'act-1' }, visibility: 'unlisted' } as never)
  await api.settlePublication(ed.id)

  assert.equal(actum.exitus?.image, privateMarker(MARKER_KEY), 'the run record still holds the marker')
})

test('a private output inside a list is copied out too', async () => {
  const { api, publishedWith, publicStore } = publishingApi({
    exitus: { images: [PUBLIC_URL, privateMarker(MARKER_KEY), privateMarker('private-outputs/abcdef0123456789/dddd.png')] },
  })

  const ed = await api.publish({ animaId: 'anima-1' }, { artifact: { kind: 'actum', id: 'act-1' }, visibility: 'unlisted' } as never)
  await api.settlePublication(ed.id)

  assert.equal(publicStore.put.length, 2, 'both markers in the list were copied')
  const images = (publishedWith[0]?.images ?? []) as string[]
  assert.equal(images.length, 3, 'the list keeps its length and order')
  assert.equal(images[0], PUBLIC_URL, 'a public url is left alone')
  for (const url of images) assert.ok(!isPrivateMarker(url), `a marker survived into the publication: ${url}`)
})

test('the feed renders the publication’s copy, never the marker', async () => {
  const { api, publicStore } = publishingApi({ exitus: PRIVATE_EXITUS, gate: { ok: true } })

  const ed = await api.publish({ animaId: 'anima-1' }, { artifact: { kind: 'actum', id: 'act-1' }, visibility: 'feed', destination: 'feed' } as never)
  await api.settlePublication(ed.id)

  const items = await api.feed()
  assert.equal(items.length, 1)
  assert.equal(items[0].output?.image, `https://cdn.example/${publicStore.put[0].key}`)
})

test('retracting the publication deletes its public copy', async () => {
  const { api, publicStore } = publishingApi({ exitus: PRIVATE_EXITUS })

  const ed = await api.publish({ animaId: 'anima-1' }, { artifact: { kind: 'actum', id: 'act-1' }, visibility: 'unlisted' } as never)
  await api.settlePublication(ed.id)
  await api.retractEdition({ animaId: 'anima-1' }, ed.id)

  assert.deepEqual(publicStore.deleted, [publicStore.put[0].key], 'the bytes came back out of the public bucket')
})

test('a publication the gate HOLDS puts no private byte in the public bucket', async () => {
  const { api, publicStore, publishedWith } = publishingApi({
    exitus: PRIVATE_EXITUS,
    gate: { ok: false, hold: true },
  })

  const ed = await api.publish({ animaId: 'anima-1' }, { artifact: { kind: 'actum', id: 'act-1' }, visibility: 'feed', destination: 'feed' } as never)
  await api.settlePublication(ed.id)

  assert.equal(publicStore.put.length, 0, 'the copy is made only once the gate has passed')
  assert.equal(publishedWith.length, 0, 'and the adapter was never reached')
})

test('a held private publication is presigned for the reviewer, who must see it to decide', async () => {
  const { api } = publishingApi({ exitus: PRIVATE_EXITUS, gate: { ok: false, hold: true } })

  const ed = await api.publish({ animaId: 'anima-1' }, { artifact: { kind: 'actum', id: 'act-1' }, visibility: 'feed', destination: 'feed' } as never)
  await api.settlePublication(ed.id)

  const preview = await api.previewHeldEdition({ animaId: 'platform' }, ed.id)
  assert.equal(preview.mediaUrls.length, 1)
  assert.ok(!isPrivateMarker(preview.mediaUrls[0]), 'a marker renders as nothing — the reviewer gets a link')
  assert.match(preview.mediaUrls[0], /^https:\/\/private\.example\//)
})

test('publishing a private output is refused where the deployment cannot copy it out', async () => {
  const { api, publishedWith } = publishingApi({ exitus: PRIVATE_EXITUS, copyOut: false })

  await assert.rejects(
    () => api.publish({ animaId: 'anima-1' }, { artifact: { kind: 'actum', id: 'act-1' }, visibility: 'feed' } as never),
    (err: unknown) => err instanceof ApiError && err.code === 'internal.unavailable',
  )
  assert.equal(publishedWith.length, 0, 'the adapter must never be reached')
})

test('a PUBLIC output publishes with nothing copied at all', async () => {
  const { api, publicStore, publishedWith, fetched } = publishingApi({ exitus: { image: PUBLIC_URL } })

  const ed = await api.publish({ animaId: 'anima-1' }, { artifact: { kind: 'actum', id: 'act-1' }, visibility: 'unlisted' } as never)
  await api.settlePublication(ed.id)

  assert.equal(fetched.length, 0)
  assert.equal(publicStore.put.length, 0, 'the copy-out is the private path only')
  assert.equal(publishedWith[0]?.image, PUBLIC_URL)
})
