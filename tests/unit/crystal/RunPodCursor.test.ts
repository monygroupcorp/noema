import { test } from 'node:test'
import assert from 'node:assert/strict'
import { RunPodCursor } from '../../../src/crystal/RunPodCursor.js'
import type { RunPodClient } from '../../../src/crystal/RunPodCursor.js'
import type { Modus } from '../../../src/types/modus.js'
import type { Actum } from '../../../src/types/actum.js'
import type { Actorum } from '../../../src/types/cursus.js'
import type { Materia, MateriaStore } from '../../../src/types/materia.js'
import type { DeploymentumStore } from '../../../src/types/deploymentum.js'
import { Praefectus } from '../../../src/crystal/Praefectus.js'

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

function makeModorum(modus: Modus | null = makeModus()) {
  return {
    find: async (_id: string, _versio?: string) => modus,
    register: async (_m: Modus) => {},
    list: async () => [],
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
    findExpired: async () => [],
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

test('reserve returns default ceiling when impetusFixum absent', async () => {
  const cursor = new RunPodCursor(makeClient(), makeCompile(), makeModorum(), makeActorum(), BASE_CONFIG)
  const result = await cursor.reserve(makeModus(), {})
  assert.equal(typeof result, 'bigint')
  assert.ok(result > 0n)
})

test('reserve uses configured maxJobSeconds when set', async () => {
  const cursor = new RunPodCursor(makeClient(), makeCompile(), makeModorum(), makeActorum(), {
    webhookUrl: 'https://api.noema.io/webhooks/runpod',
    maxJobSeconds: 600,
  })
  const result = await cursor.reserve(makeModus(), {})
  assert.equal(result, 600n)
})

// ── run() — async submission ──────────────────────────────────────────────────

test('run returns async result with externusJobId from client', async () => {
  const client = makeClient('job-xyz')
  const cursor = new RunPodCursor(client, makeCompile(), makeModorum(), makeActorum(), BASE_CONFIG)
  const result = await cursor.run(makeActum())
  assert.equal(result.kind, 'async')
  assert.equal((result as { kind: 'async'; externusJobId: string }).externusJobId, 'job-xyz')
})

test('run passes webhookUrl from config to client', async () => {
  const client = makeClient()
  const cursor = new RunPodCursor(client, makeCompile(), makeModorum(), makeActorum(), {
    webhookUrl: 'https://tee-pod.internal/webhooks/runpod',
  })
  await cursor.run(makeActum())
  assert.equal((client.calls[0] as { webhook: string }).webhook, 'https://tee-pod.internal/webhooks/runpod')
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
    return {}
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
  const modorum = {
    find: async (id: string, versio?: string) => {
      resolvedId = id
      resolvedVersiono = versio
      return makeModus({ id, versio: versio ?? '1.0.0' })
    },
    register: async (_m: Modus) => {},
    list: async () => [],
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
