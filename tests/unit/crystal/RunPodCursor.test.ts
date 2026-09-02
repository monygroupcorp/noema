import { test } from 'node:test'
import assert from 'node:assert/strict'
import { RunPodCursor, withCallbackNonce } from '../../../src/crystal/RunPodCursor.js'
import type { RunPodClient } from '../../../src/crystal/RunPodCursor.js'
import type { Modorum, Modus } from '../../../src/types/modus.js'
import type { Actum } from '../../../src/types/actum.js'
import type { Actorum } from '../../../src/types/cursus.js'
import type { Materia, MateriaStore } from '../../../src/types/materia.js'
import type { DeploymentumStore } from '../../../src/types/deploymentum.js'
import type { Hospitium, HospitiumStore, HostKey } from '../../../src/types/hospitium.js'
import { Praefectus } from '../../../src/crystal/Praefectus.js'
import { GENERIC_RESERVE_IMPETUS } from '../../../src/ledger/rates.js'
import { ESSENTIA_RUNMAKE_SD15, CANONICAL_ESSENTIAE } from '../../../src/crystal/seeds/essentiae.js'
import { PROVISION_BUDGET_MS } from '../../../src/crystal/SecurePodClient.js'
import { DatasetCaptionCursor, DEFAULT_MAX_CAPTION_SECONDS } from '../../../src/crystal/DatasetCaptionCursor.js'
import { RemoteAitoolkitTrainingCursor, DEFAULT_MAX_TRAINING_SECONDS } from '../../../src/crystal/RemoteAitoolkitTrainingCursor.js'

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeModus(overrides: Partial<Modus> = {}): Modus {
  return {
    id: 'flux-schnell',
    nomen: 'Flux Schnell',
    genus: 'atomicus',
    versio: '1.0.0',
    contentHash: 'abc123',
    aditus: { prompt: { type: 'text', required: true } },
    exitus: { image: { type: 'image' } },
    ministerium: 'runpod',
    canonica: true,
    natum: new Date(),
    mutatum: new Date(),
    ...overrides,
  }
}

function makeActum(overrides: Partial<Actum> = {}): Actum {
  return {
    id: 'actum-test-1',
    modusId: 'flux-schnell',
    modusVersiono: '1.0.0',
    impetus: 0n,
    signaConsumed: [],
    aditus: { prompt: 'a cat' },
    status: 'nascens',
    inceptum: new Date(),
    expirat: new Date(Date.now() + 60_000),
    ...overrides,
  }
}

function makeModorum(modus: Modus | null = makeModus()): Modorum {
  return {
    find: async (_id: string, _versio?: string) => modus,
    register: async (_m: Modus) => {},
    list: async () => [],
    update: async () => { throw new Error('update is not exercised by this suite') },
  }
}

function makeActorum(): Actorum & { updates: Array<{ id: string; patch: unknown }> } {
  const updates: Array<{ id: string; patch: unknown }> = []
  return {
    updates,
    create: async (a) => ({ ...a, inceptum: new Date() } as Actum),
    update: async (id, patch) => {
      updates.push({ id, patch })
      return makeActum({ id })
    },
    findById: async (_id) => null,
    findByExternusJobId: async (_id) => null,
    findByCallbackNonce: async (_nonce) => null,
    findExpired: async () => [],
    findByNullifier: async () => { throw new Error('findByNullifier is not exercised by this suite') },
    findInFlight: async () => { throw new Error('findInFlight is not exercised by this suite') },
    findByCompositum: async () => { throw new Error('findByCompositum is not exercised by this suite') },
  }
}

function makeClient(jobId = 'runpod-job-abc'): RunPodClient & { calls: unknown[] } {
  const calls: unknown[] = []
  return {
    calls,
    async submit(params) {
      calls.push(params)
      return { id: jobId }
    },
  }
}

function makeCompile(input: unknown = { nodes: {} }, hash = 'sha256:abc123') {
  return async (_modus: Modus, _aditus: Record<string, unknown>) => ({ hash, input })
}

function makeDeploymentumStore(): DeploymentumStore & { upserts: unknown[] } {
  const upserts: unknown[] = []
  return {
    upserts,
    async upsert(d) { upserts.push(d) },
    async find(_hash) { return null },
  }
}

const BASE_CONFIG = { webhookUrl: 'https://api.noema.io/webhooks/runpod' }

// ── reserve() ─────────────────────────────────────────────────────────────────

test('reserve returns impetusFixum when set on modus', async () => {
  const cursor = new RunPodCursor(makeClient(), makeCompile(), makeModorum(), makeActorum(), BASE_CONFIG)
  const result = await cursor.reserve(makeModus({ impetusFixum: 500n }), {})
  assert.equal(result, 500n)
})

test('reserve falls back to the generic bound — not the job timeout — when a modus carries neither impetusFixum nor pretium', async () => {
  const cursor = new RunPodCursor(makeClient(), makeCompile(), makeModorum(), makeActorum(), BASE_CONFIG)
  const result = await cursor.reserve(makeModus(), {})
  assert.equal(result, GENERIC_RESERVE_IMPETUS)
  assert.notEqual(result, 1800n)   // the default maxJobSeconds ceiling is not a cost estimate
})

test('reserve uses the pretium curve and scales with steps', async () => {
  const cursor = new RunPodCursor(makeClient(), makeCompile(), makeModorum(), makeActorum(), BASE_CONFIG)
  const modus = makeModus({
    pretium: { baseSeconds: 10, perStepSeconds: 2 },
    aditus: { prompt: { type: 'text', required: true }, steps: { type: 'int', default: 4 } },
  })
  // 2 × (10 + 2×4) = 36 ; 2 × (10 + 2×20) = 100
  assert.equal(await cursor.reserve(modus, { steps: 4 }), 36n)
  assert.equal(await cursor.reserve(modus, { steps: 20 }), 100n)
  // Absent from the run inputs → the schema default (4) is used.
  assert.equal(await cursor.reserve(modus, {}), 36n)
})

test("reserve prices sd1-5's declared curve at its schema defaults", async () => {
  const cursor = new RunPodCursor(makeClient(), makeCompile(), makeModorum(), makeActorum(), BASE_CONFIG)
  // baseSeconds 66 + perStepSeconds 1.0 × 20 default steps, doubled for safety.
  assert.equal(await cursor.reserve(ESSENTIA_RUNMAKE_SD15, {}), 172n)
})

/**
 * Flows whose fitted curve legitimately reserves ABOVE `GENERIC_RESERVE_IMPETUS`, with the
 * measurement that justifies it.
 *
 * The bound below was written when every fitted flow was an image flow — sd1.5 fits to 172
 * against a generic 900 — so "a real curve lands under the generic" held, and a curve above it
 * really did mean a mis-fit. MiniMax H3 breaks the premise honestly: one cold run metered 871
 * impetus, of which ~713 s was a 56 GB weight pull, so 2x that is legitimately above 900.
 *
 * What this reveals is not a bad curve but a bad constant: the generic reserve is sized for
 * image flows and is simultaneously ~5x too generous for sd1.5 and too small for a video flow
 * carrying tens of GB of weights. See noema-397. Until that is ruled on, a flow lands here only
 * with a measurement behind it — never to quiet a failing test.
 */
const ABOVE_GENERIC_BOUND: Record<string, string> = {
  'minimax-h3-t2v': 'actum 01a7dc6b, cold: 871 impetus measured, 713 s of it a 56 GB weight pull',
  'minimax-h3-fl2v': 'same substrate and weight set as minimax-h3-t2v',
  'minimax-h3-ref2v': 'same substrate; ref2va DiT is the same 21 GB as fl2va',
}

test('a flow declaring pretium never reserves more than the generic bound', async () => {
  const cursor = new RunPodCursor(makeClient(), makeCompile(), makeModorum(), makeActorum(), BASE_CONFIG)
  const modelled = CANONICAL_ESSENTIAE.filter((e) => e.pretium !== undefined)
  assert.ok(modelled.length > 0, 'expected at least one canonical flow to declare a pretium curve')
  for (const essentia of modelled) {
    if (essentia.id in ABOVE_GENERIC_BOUND) continue
    const reserved = await cursor.reserve(essentia, {})
    assert.ok(
      reserved <= GENERIC_RESERVE_IMPETUS,
      `${essentia.id} reserves ${reserved}, above the generic bound ${GENERIC_RESERVE_IMPETUS} — the curve is mis-fitted or the estimator double-counts`,
    )
  }
})

test('reserve falls through to the generic bound when a pretium term has neither a value nor a schema default', async () => {
  const cursor = new RunPodCursor(makeClient(), makeCompile(), makeModorum(), makeActorum(), BASE_CONFIG)
  const modus = makeModus({
    pretium: { baseSeconds: 10, perStepSeconds: 2 },
    aditus: { prompt: { type: 'text', required: true }, steps: { type: 'int' } },
  })
  // A missing term is never treated as 0 — that would under-reserve and trip `Cursor overcharge`.
  assert.equal(await cursor.reserve(modus, {}), GENERIC_RESERVE_IMPETUS)
})

test('reserve never exceeds the maxJobSeconds ceiling', async () => {
  const cursor = new RunPodCursor(makeClient(), makeCompile(), makeModorum(), makeActorum(), {
    webhookUrl: 'https://api.noema.io/webhooks/runpod',
    maxJobSeconds: 60,
  })
  // Generic fallback (900) clamps to the ceiling…
  assert.equal(await cursor.reserve(makeModus(), {}), 60n)
  // …and so does a curve that estimates above it.
  const expensive = makeModus({ pretium: { baseSeconds: 5000 } })
  assert.equal(await cursor.reserve(expensive, {}), 60n)
})

// ── run() — async submission ──────────────────────────────────────────────────

test('run returns async result with externusJobId from client', async () => {
  const client = makeClient('job-xyz')
  const cursor = new RunPodCursor(client, makeCompile(), makeModorum(), makeActorum(), BASE_CONFIG)
  const result = await cursor.run(makeActum())
  assert.equal(result.kind, 'async')
  assert.equal((result as { kind: 'async'; externusJobId: string }).externusJobId, 'job-xyz')
})

test('run submits the configured webhook base with this job\'s callback nonce appended', async () => {
  const client = makeClient()
  const actorum = makeActorum()
  const cursor = new RunPodCursor(client, makeCompile(), makeModorum(), actorum, {
    webhookUrl: 'https://tee-pod.internal/webhooks/runpod',
  })
  await cursor.run(makeActum({ id: 'my-actum' }))

  const nonce = (actorum.updates.find(u => u.id === 'my-actum')!.patch as { callbackNonce: string }).callbackNonce
  assert.ok(nonce, 'a callback nonce is minted for the job')
  assert.equal(
    (client.calls[0] as { webhook: string }).webhook,
    `https://tee-pod.internal/webhooks/runpod/${nonce}`,
  )
})

// The base URL is deployment-set and not normalized anywhere, so the join rule has to hold for a
// base that carries a trailing slash too — a double slash would 404 the callback and strand the run.
test('run joins the nonce onto a webhook base that carries a trailing slash', async () => {
  const client = makeClient()
  const actorum = makeActorum()
  const cursor = new RunPodCursor(client, makeCompile(), makeModorum(), actorum, {
    webhookUrl: 'https://api.noema.io/webhooks/runpod/',
  })
  await cursor.run(makeActum({ id: 'my-actum' }))

  const nonce = (actorum.updates.find(u => u.id === 'my-actum')!.patch as { callbackNonce: string }).callbackNonce
  const webhook = (client.calls[0] as { webhook: string }).webhook
  assert.equal(webhook, `https://api.noema.io/webhooks/runpod/${nonce}`)
  assert.ok(!webhook.includes('//webhooks') && !webhook.includes(`runpod//`), 'no doubled slash in the callback URL')
})

test('withCallbackNonce is the single join rule for every callback base', () => {
  assert.equal(withCallbackNonce('https://h/webhooks/runpod', 'n'), 'https://h/webhooks/runpod/n')
  assert.equal(withCallbackNonce('https://h/webhooks/runpod/', 'n'), 'https://h/webhooks/runpod/n')
  assert.equal(withCallbackNonce('https://h/webhooks/runpod///', 'n'), 'https://h/webhooks/runpod/n')
})

// The nonce and the job id are one patch: a job is never in flight carrying one and not the other.
test('run persists the callback nonce in the same patch as externusJobId', async () => {
  const actorum = makeActorum()
  const cursor = new RunPodCursor(makeClient('job-555'), makeCompile(), makeModorum(), actorum, BASE_CONFIG)
  await cursor.run(makeActum({ id: 'my-actum' }))

  const patch = actorum.updates.find(u => u.id === 'my-actum')!.patch as { externusJobId: string; callbackNonce: string }
  assert.equal(patch.externusJobId, 'job-555')
  assert.ok(patch.callbackNonce, 'the nonce rides the same write as the job id')
})

// Each dispatch mints its own — a nonce shared across jobs would bind a callback to nothing.
test('run mints a distinct callback nonce per job', async () => {
  const actorum = makeActorum()
  const cursor = new RunPodCursor(makeClient(), makeCompile(), makeModorum(), actorum, BASE_CONFIG)
  await cursor.run(makeActum({ id: 'actum-1' }))
  await cursor.run(makeActum({ id: 'actum-2' }))

  const nonces = ['actum-1', 'actum-2'].map(
    id => (actorum.updates.find(u => u.id === id)!.patch as { callbackNonce: string }).callbackNonce)
  assert.notEqual(nonces[0], nonces[1])
})

test('run passes compiled input to client', async () => {
  const compiled = { image: 'runpod/pytorch:2.4', workflow: { nodes: [] } }
  const client = makeClient()
  const cursor = new RunPodCursor(client, makeCompile(compiled), makeModorum(), makeActorum(), BASE_CONFIG)
  await cursor.run(makeActum())
  assert.deepEqual((client.calls[0] as { input: unknown }).input, compiled)
})

test('run updates actum with externusJobId after submission', async () => {
  const actorum = makeActorum()
  const cursor = new RunPodCursor(makeClient('job-555'), makeCompile(), makeModorum(), actorum, BASE_CONFIG)
  await cursor.run(makeActum({ id: 'my-actum' }))
  const update = actorum.updates.find(u => u.id === 'my-actum')
  assert.ok(update, 'actum.update() should be called')
  assert.equal((update!.patch as { externusJobId: string }).externusJobId, 'job-555')
})

test('run updates actum status to agens after submission', async () => {
  const actorum = makeActorum()
  const cursor = new RunPodCursor(makeClient(), makeCompile(), makeModorum(), actorum, BASE_CONFIG)
  await cursor.run(makeActum({ id: 'my-actum' }))
  const update = actorum.updates.find(u => u.id === 'my-actum')
  assert.equal((update!.patch as { status: string }).status, 'agens')
})

test('run compiles modus + actum.aditus before submitting', async () => {
  let compiledModus: unknown
  let compiledAditus: unknown
  const compile = async (modus: Modus, aditus: Record<string, unknown>) => {
    compiledModus = modus
    compiledAditus = aditus
    return { hash: 'sha256:abc123', input: { nodes: {} } }
  }
  const cursor = new RunPodCursor(makeClient(), compile, makeModorum(), makeActorum(), BASE_CONFIG)
  await cursor.run(makeActum({ aditus: { prompt: 'a dog', steps: 4 } }))
  assert.equal((compiledModus as Modus).id, 'flux-schnell')
  assert.deepEqual(compiledAditus, { prompt: 'a dog', steps: 4 })
})

// ── run() — error paths ───────────────────────────────────────────────────────

test('run throws when modus not found in modorum', async () => {
  const cursor = new RunPodCursor(makeClient(), makeCompile(), makeModorum(null), makeActorum(), BASE_CONFIG)
  await assert.rejects(
    () => cursor.run(makeActum()),
    /not found/i
  )
})

test('run throws when client.submit rejects', async () => {
  const failingClient: RunPodClient = {
    async submit(_params) { throw new Error('RunPod API unavailable') },
  }
  const cursor = new RunPodCursor(failingClient, makeCompile(), makeModorum(), makeActorum(), BASE_CONFIG)
  await assert.rejects(
    () => cursor.run(makeActum()),
    /RunPod API unavailable/
  )
})

test('run resolves modus by actum.modusId and modusVersiono', async () => {
  let resolvedId: string | undefined
  let resolvedVersiono: string | undefined
  const modorum: Modorum = {
    find: async (id: string, versio?: string) => {
      resolvedId = id
      resolvedVersiono = versio
      return makeModus({ id, versio: versio ?? '1.0.0' })
    },
    register: async (_m: Modus) => {},
    list: async () => [],
    update: async () => { throw new Error('update is not exercised by this suite') },
  }
  const cursor = new RunPodCursor(makeClient(), makeCompile(), modorum, makeActorum(), BASE_CONFIG)
  await cursor.run(makeActum({ modusId: 'modus.xyz', modusVersiono: '2.1.0' }))
  assert.equal(resolvedId, 'modus.xyz')
  assert.equal(resolvedVersiono, '2.1.0')
})

// ── run() — Praefectus warm routing ──────────────────────────────────────────

function makeMateria(overrides: Partial<Materia> = {}): Materia {
  return {
    id: 'mat-warm-1',
    genus: 'runpod',
    externusId: 'pod-xyz',
    gpu: 'NVIDIA GeForce RTX 4090',
    vramGb: 24,
    ramGb: 64,
    impetusPerSecond: 1n,
    status: 'idle',
    imageRef: 'stationthis/flux-comfyui:v1',
    sshHost: '1.2.3.4',
    sshPort: 12345,
    ...overrides,
  }
}

function makePraefectus(materia: Materia | null): Praefectus {
  const store: MateriaStore = {
    async create(input) { return { ...input, id: 'mat-new' } },
    async findById(_id) { return null },
    async update(_id, _patch) { return materia! },
    async findWarm(_spec) { return materia },
    async findActive() { throw new Error('findActive is not exercised by this suite') },
    async reapIdle() { throw new Error('reapIdle is not exercised by this suite') },
  }
  return new Praefectus(store)
}

test('run() routes to warm client when Praefectus finds a matching pod', async () => {
  const coldClient = makeClient('cold-job')
  const warmCalls: unknown[] = []
  const warmClient: RunPodClient = {
    async submit(params) { warmCalls.push(params); return { id: 'warm-job-1' } },
  }
  const cursor = new RunPodCursor(coldClient, makeCompile(), makeModorum(), makeActorum(), {
    ...BASE_CONFIG,
    praefectus: makePraefectus(makeMateria()),
    warmFactory: () => warmClient,
    imageRefOf: () => 'stationthis/flux-comfyui:v1',
  })
  const result = await cursor.run(makeActum())
  assert.equal(result.kind, 'async')
  assert.equal((result as { kind: 'async'; externusJobId: string }).externusJobId, 'warm-job-1')
  assert.equal(warmCalls.length, 1, 'warm client should be called')
  assert.equal(coldClient.calls.length, 0, 'cold client must not be called')
})

test('run() falls back to cold client when Praefectus returns null', async () => {
  const coldClient = makeClient('cold-job-2')
  const warmCalls: unknown[] = []
  const cursor = new RunPodCursor(coldClient, makeCompile(), makeModorum(), makeActorum(), {
    ...BASE_CONFIG,
    praefectus: makePraefectus(null),
    warmFactory: () => ({ async submit() { warmCalls.push(1); return { id: 'warm' } } }),
    imageRefOf: () => 'stationthis/flux-comfyui:v1',
  })
  const result = await cursor.run(makeActum())
  assert.equal((result as { kind: 'async'; externusJobId: string }).externusJobId, 'cold-job-2')
  assert.equal(coldClient.calls.length, 1, 'cold client should be called on cold start')
  assert.equal(warmCalls.length, 0, 'warm client must not be called on cold start')
})

// ── run() — dispatch-time pricing stamp ──────────────────────────────────────
// Dispatch knows the TIER (who is running on whose pod). It does not know the
// cost — the run has not happened yet — so no impetus amount is stamped here.
// `ActumCompletor` derives base/final from the cursor's measured cost at settle.

function makeHospitia(hostKey: HostKey): HospitiumStore {
  const h: Hospitium = { id: 'hosp-1', materiaId: 'mat-warm-1', hostKey, inceptum: new Date() }
  return {
    async create(input) { return { id: 'hosp-new', ...input } },
    async findByMateriaId(materiaId) { return materiaId === h.materiaId ? h : null },
    async findActive() { return [h] },
    async update(_materiaId, patch) { return { ...h, ...patch } },
    async findByModoId() { throw new Error('findByModoId is not exercised by this suite') },
    async bindMateria() { throw new Error('bindMateria is not exercised by this suite') },
  }
}

test('run() stamps pricingTier at dispatch and no impetus amount', async () => {
  const actorum = makeActorum()
  const cursor = new RunPodCursor(makeClient('cold'), makeCompile(), makeModorum(), actorum, {
    ...BASE_CONFIG,
    praefectus: makePraefectus(makeMateria()),
    warmFactory: () => ({ async submit() { return { id: 'warm-job-2' } } }),
    imageRefOf: () => 'stationthis/flux-comfyui:v1',
    hospitia: makeHospitia({ animaId: 'anima-host' }),
  })

  await cursor.run(makeActum({ impetus: 1800n }))

  const stamp = actorum.updates
    .map(u => u.patch as { materiamId?: string; executio?: Record<string, unknown> })
    .find(p => p.executio !== undefined)
  assert.ok(stamp, 'dispatch stamp written')
  assert.equal(stamp!.materiamId, 'mat-warm-1')
  assert.equal(stamp!.executio!.pricingTier, 'guest')
  assert.equal(stamp!.executio!.finalImpetus, undefined, 'no dispatch-time final amount')
  assert.equal(stamp!.executio!.baseImpetus, undefined, 'no dispatch-time base amount')
})

// ── run() — studio pinning (studioId-targeted) ────────────────────────────────
test('run() pins a studioId-targeted run to the studio bound pod, not an image-match', async () => {
  const pinned = makeMateria({ id: 'studio-pod-7', externusId: 'pod-studio' })
  let warmedWith: Materia | undefined
  const cursor = new RunPodCursor(makeClient('cold'), makeCompile(), makeModorum(), makeActorum(), {
    ...BASE_CONFIG,
    warmFactory: (m) => { warmedWith = m; return { async submit() { return { id: 'studio-job' } } } },
    studioPodFor: async (modoId) => (modoId === 'modo-99' ? pinned : null),
    // A *different* pod would win the image-match — pinning must beat it.
    praefectus: makePraefectus(makeMateria({ id: 'wrong-image-match' })),
    imageRefOf: () => 'stationthis/flux-comfyui:v1',
  })
  const result = await cursor.run(makeActum({ modoId: 'modo-99' }))
  assert.equal((result as { kind: 'async'; externusJobId: string }).externusJobId, 'studio-job')
  assert.equal(warmedWith?.id, 'studio-pod-7', 'routed to the pinned studio pod')
})

test('run() falls through to the warm-match when the studio pod is gone/busy (studioPodFor → null)', async () => {
  let warmedWith: Materia | undefined
  const cursor = new RunPodCursor(makeClient('cold'), makeCompile(), makeModorum(), makeActorum(), {
    ...BASE_CONFIG,
    warmFactory: (m) => { warmedWith = m; return { async submit() { return { id: 'fallback-job' } } } },
    studioPodFor: async () => null,   // studio terminated or busy with another run
    praefectus: makePraefectus(makeMateria({ id: 'fallback-warm' })),
    imageRefOf: () => 'stationthis/flux-comfyui:v1',
  })
  const result = await cursor.run(makeActum({ modoId: 'modo-gone' }))
  assert.equal((result as { kind: 'async'; externusJobId: string }).externusJobId, 'fallback-job')
  assert.equal(warmedWith?.id, 'fallback-warm', 'fell through to the normal image warm-match')
})

test('run() queries Praefectus with imageRef from imageRefOf', async () => {
  let queriedImageRef: string | undefined
  const fakePraefectus = {
    findWarm: async (imageRef: string) => { queriedImageRef = imageRef; return null },
  } as unknown as Praefectus
  const cursor = new RunPodCursor(makeClient(), makeCompile(), makeModorum(), makeActorum(), {
    ...BASE_CONFIG,
    praefectus: fakePraefectus,
    imageRefOf: () => 'stationthis/sdxl:v2',
  })
  await cursor.run(makeActum())
  assert.equal(queriedImageRef, 'stationthis/sdxl:v2')
})

test('run() skips Praefectus when imageRefOf returns undefined', async () => {
  const coldClient = makeClient('cold-job-3')
  const warmCalls: unknown[] = []
  const cursor = new RunPodCursor(coldClient, makeCompile(), makeModorum(), makeActorum(), {
    ...BASE_CONFIG,
    praefectus: makePraefectus(makeMateria()),
    warmFactory: () => ({ async submit() { warmCalls.push(1); return { id: 'warm' } } }),
    imageRefOf: () => undefined,
  })
  await cursor.run(makeActum())
  assert.equal(coldClient.calls.length, 1, 'cold client should be called when imageRef unavailable')
  assert.equal(warmCalls.length, 0, 'warm client not called when imageRefOf returns undefined')
})

// ── run() — computeStrategy routing ──────────────────────────────────────────

test('performance strategy always cold-starts — Praefectus never called', async () => {
  const coldClient = makeClient('cold-perf')
  let praefectusCallCount = 0
  const fakePraefectus = {
    findWarm: async (_imageRef: string, _opts?: { forEconomy?: boolean }) => {
      praefectusCallCount++
      return makeMateria()
    },
  } as unknown as Praefectus
  const cursor = new RunPodCursor(coldClient, makeCompile(), makeModorum(), makeActorum(), {
    ...BASE_CONFIG,
    praefectus: fakePraefectus,
    warmFactory: () => ({ async submit() { return { id: 'warm-should-not-be-used' } } }),
    imageRefOf: () => 'stationthis/flux-comfyui:v1',
  })
  const result = await cursor.run(makeActum({ computeStrategy: 'performance' }))
  assert.equal(praefectusCallCount, 0, 'Praefectus must not be consulted for performance strategy')
  assert.equal(coldClient.calls.length, 1, 'cold client must be used')
  assert.equal((result as { kind: 'async'; externusJobId: string }).externusJobId, 'cold-perf')
})

test('economy strategy calls findWarm with { forEconomy: true }', async () => {
  let capturedOpts: { forEconomy?: boolean } | undefined
  const fakeMateria: Materia = {
    id: 'mat-eco', genus: 'runpod', externusId: 'pod-eco',
    gpu: 'RTX4090', vramGb: 24, ramGb: 64, impetusPerSecond: 1n, status: 'idle',
    imageRef: 'stationthis/flux-comfyui:v1', podPolicy: 'economy',
  }
  const fakePraefectus = {
    findWarm: async (_imageRef: string, opts?: { forEconomy?: boolean }) => {
      capturedOpts = opts
      return fakeMateria
    },
  } as unknown as Praefectus
  const warmClient = makeClient('warm-eco')
  const cursor = new RunPodCursor(makeClient('cold'), makeCompile(), makeModorum(), makeActorum(), {
    ...BASE_CONFIG,
    praefectus: fakePraefectus,
    warmFactory: () => warmClient,
    imageRefOf: () => 'stationthis/flux-comfyui:v1',
  })
  await cursor.run(makeActum({ computeStrategy: 'economy' }))
  assert.deepEqual(capturedOpts, { forEconomy: true }, 'findWarm must receive { forEconomy: true }')
})

test('economy strategy throws EconomyUnavailableError when no warm pod available', async () => {
  const { EconomyUnavailableError } = await import('../../../src/crystal/RunPodCursor.js')
  const fakePraefectus = {
    findWarm: async () => null,
  } as unknown as Praefectus
  const cursor = new RunPodCursor(makeClient('cold'), makeCompile(), makeModorum(), makeActorum(), {
    ...BASE_CONFIG,
    praefectus: fakePraefectus,
    imageRefOf: () => 'stationthis/flux-comfyui:v1',
  })
  await assert.rejects(
    () => cursor.run(makeActum({ computeStrategy: 'economy' })),
    (err: Error) => err instanceof EconomyUnavailableError,
  )
})

test('standard strategy (and absent) uses warm-then-cold behavior', async () => {
  // standard: finds warm pod → uses it
  const warmCalls: unknown[] = []
  const warmClient: RunPodClient = {
    async submit(params) { warmCalls.push(params); return { id: 'warm-std' } },
  }
  const coldClientStd = makeClient('cold-std')
  const cursorStd = new RunPodCursor(coldClientStd, makeCompile(), makeModorum(), makeActorum(), {
    ...BASE_CONFIG,
    praefectus: makePraefectus(makeMateria()),
    warmFactory: () => warmClient,
    imageRefOf: () => 'stationthis/flux-comfyui:v1',
  })
  const resultStd = await cursorStd.run(makeActum({ computeStrategy: 'standard' }))
  assert.equal((resultStd as { kind: 'async'; externusJobId: string }).externusJobId, 'warm-std')
  assert.equal(warmCalls.length, 1, 'warm client should be used for standard')
  assert.equal(coldClientStd.calls.length, 0, 'cold client not used when warm available')

  // absent computeStrategy: same warm-then-cold path
  const coldClientAbsent = makeClient('cold-absent')
  const absentWarmCalls: unknown[] = []
  const absentWarmClient: RunPodClient = {
    async submit(params) { absentWarmCalls.push(params); return { id: 'warm-absent' } },
  }
  const cursorAbsent = new RunPodCursor(coldClientAbsent, makeCompile(), makeModorum(), makeActorum(), {
    ...BASE_CONFIG,
    praefectus: makePraefectus(makeMateria()),
    warmFactory: () => absentWarmClient,
    imageRefOf: () => 'stationthis/flux-comfyui:v1',
  })
  const resultAbsent = await cursorAbsent.run(makeActum())  // no computeStrategy
  assert.equal((resultAbsent as { kind: 'async'; externusJobId: string }).externusJobId, 'warm-absent')
  assert.equal(absentWarmCalls.length, 1, 'warm client should be used when strategy absent')
  assert.equal(coldClientAbsent.calls.length, 0, 'cold client not used when warm available and strategy absent')
})

// ── run() — deployment storage ────────────────────────────────────────────────

test('run() stamps deploymentHash on actum after submission', async () => {
  const actorum = makeActorum()
  const cursor = new RunPodCursor(makeClient(), makeCompile({}, 'sha256:deadbeef'), makeModorum(), actorum, BASE_CONFIG)
  await cursor.run(makeActum({ id: 'act-1' }))
  const update = actorum.updates.find(u => u.id === 'act-1')
  assert.equal((update!.patch as { deploymentHash?: string }).deploymentHash, 'sha256:deadbeef')
})

test('run() stores deployment in DeploymentumStore when configured', async () => {
  const store = makeDeploymentumStore()
  const cursor = new RunPodCursor(makeClient(), makeCompile({ nodes: {} }, 'sha256:abc'), makeModorum(), makeActorum(), {
    ...BASE_CONFIG,
    deployments: store,
  })
  await cursor.run(makeActum())
  assert.equal(store.upserts.length, 1)
  assert.equal((store.upserts[0] as { hash: string }).hash, 'sha256:abc')
})

test('run() does not throw when DeploymentumStore is absent', async () => {
  const cursor = new RunPodCursor(makeClient(), makeCompile(), makeModorum(), makeActorum(), BASE_CONFIG)
  await assert.doesNotReject(() => cursor.run(makeActum()))
})

test('run() passes input (not full compile result) to client.submit', async () => {
  const compiledInput = { nodes: { '1': { class_type: 'KSampler' } } }
  const client = makeClient()
  const cursor = new RunPodCursor(client, makeCompile(compiledInput, 'sha256:xyz'), makeModorum(), makeActorum(), BASE_CONFIG)
  await cursor.run(makeActum())
  assert.deepEqual((client.calls[0] as { input: unknown }).input, compiledInput)
})

test('run threads actum.pinnedModels into compile (Mod • → Add)', async () => {
  // Proves the dispatch→spec bridge's cursor leg: the cursor holds the actum, so it passes
  // actum.pinnedModels as compile's 3rd arg → Compiler unions them into spec.models.
  const seen: Array<unknown> = []
  const compile = async (_m: Modus, _aditus: Record<string, unknown>, pinnedModels?: import('../../../src/types/actum.js').ModelRef[]) => {
    seen.push(pinnedModels)
    return { hash: 'sha256:abc', input: { workflow: {} } }
  }
  const cursor = new RunPodCursor(makeClient(), compile, makeModorum(), makeActorum(), BASE_CONFIG)
  const pinned = [{ role: 'checkpoint', id: 'intella.sdxl', dest: 'models/checkpoints/sdxl.safetensors' }]
  await cursor.run(makeActum({ pinnedModels: pinned }))
  assert.deepEqual(seen[0], pinned, 'actum.pinnedModels passed to compile')
})

// ── terminus() vs reserve() — a duration is not a price ───────────────────────
//
// The provisioning budget is a DURATION. It reaches `expirat` and nothing else: not a quote, not
// the balance check, not the size of the ledger lock. Those are `reserve()`'s job alone, and
// `reserve()` is not a function of the budget on any cursor. The test below is what keeps that
// true — raising PROVISION_BUDGET_MS must be able to move a deadline without moving an estimate.

test('terminus covers the provisioning budget plus the job window the ceiling permits', async () => {
  const cursor = new RunPodCursor(makeClient(), makeCompile(), makeModorum(), makeActorum(), BASE_CONFIG)
  assert.equal(await cursor.terminus(makeModus(), {}), PROVISION_BUDGET_MS + 1800 * 1000)

  const tighter = new RunPodCursor(makeClient(), makeCompile(), makeModorum(), makeActorum(),
    { ...BASE_CONFIG, maxJobSeconds: 600 })
  assert.equal(await tighter.terminus(makeModus(), {}), PROVISION_BUDGET_MS + 600 * 1000)
})

test('raising PROVISION_BUDGET_MS does not change what any cursor reserves', async () => {
  const noopLauncher = { async launch() { return { externusJobId: 'pod-x' } } }
  const noopActorum = { async update() { return {} as Actum } }

  const pod = new RunPodCursor(makeClient(), makeCompile(), makeModorum(), makeActorum(), BASE_CONFIG)
  // `datasets` is a required dep: the caption cursor refuses an extending pass with nothing left
  // to caption in reserve(), and it can only know that by reading the captionset it was given.
  // Nothing here asks for one, so the store is never read.
  const noopDatasets = { async find() { return null } }
  const caption = new DatasetCaptionCursor({ launcher: noopLauncher, actorum: noopActorum, datasets: noopDatasets })
  const training = new RemoteAitoolkitTrainingCursor({ launcher: noopLauncher, actorum: noopActorum })

  // Each cursor's reservation is stated in its own terms — a declared price, a fitted cost curve,
  // or its own pod-seconds cap. None of them is a function of the provisioning budget, so the
  // budget cannot inflate an estimate.
  const priced = makeModus({ impetusFixum: 500n })
  assert.equal(await pod.reserve(priced, {}), 500n)
  assert.equal(await pod.reserve(makeModus(), {}), GENERIC_RESERVE_IMPETUS)
  assert.equal(await caption.reserve(makeModus(), {}), BigInt(DEFAULT_MAX_CAPTION_SECONDS))
  assert.equal(await training.reserve(makeModus(), {}), BigInt(DEFAULT_MAX_TRAINING_SECONDS))

  // And the converse: a fixed PRICE does not shrink the DEADLINE. If terminus were read out of
  // reserve(), a modus priced at a flat 500 points would be given a 500-unit deadline — the exact
  // substitution of a price for a duration this separation exists to prevent.
  for (const [label, ms] of [
    ['runpod',   await pod.terminus(priced, {})],
    ['caption',  await caption.terminus(priced, {})],
    ['training', await training.terminus(priced, {})],
  ] as const) {
    assert.ok(ms >= PROVISION_BUDGET_MS, `${label}: a declared price must not become the deadline`)
    assert.notEqual(BigInt(ms / 1000), 500n, `${label}: deadline tracked the price`)
  }
})

test('no ABOVE_GENERIC_BOUND entry is stale', () => {
  for (const id of Object.keys(ABOVE_GENERIC_BOUND)) {
    const e = CANONICAL_ESSENTIAE.find((x) => x.id === id)
    assert.ok(e, `ABOVE_GENERIC_BOUND names '${id}', which is no longer a canonical flow`)
    assert.ok(e.pretium, `ABOVE_GENERIC_BOUND names '${id}', which no longer declares a curve`)
  }
})

test('a flow listed above the generic bound is actually above it (the list is not padded)', async () => {
  const cursor = new RunPodCursor(makeClient(), makeCompile(), makeModorum(), makeActorum(), BASE_CONFIG)
  for (const id of Object.keys(ABOVE_GENERIC_BOUND)) {
    const e = CANONICAL_ESSENTIAE.find((x) => x.id === id)!
    const reserved = await cursor.reserve(e, {})
    assert.ok(
      reserved > GENERIC_RESERVE_IMPETUS,
      `${id} is listed as above the generic bound but reserves ${reserved} — remove it from the list`,
    )
  }
})
