import { test } from 'node:test'
import assert from 'node:assert/strict'
import { RunPodCursor } from '../../../src/crystal/RunPodCursor.js'
import type { Modus } from '../../../src/types/modus.js'
import type { Actum } from '../../../src/types/actum.js'

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeModus(overrides: Partial<Modus> = {}): Modus {
  return {
    id: 'runmake.flux-schnell',
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
    modusId: 'runmake.flux-schnell',
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

const FAKE_DEPLOYMENT = { hash: 'deadbeef', spec: { workflow: { comfyApiPayload: {} }, cookFlags: {} } }

function makeRunner(result = {
  status: 'completed',
  podId: 'pod-abc',
  gpuTypeId: 'NVIDIA RTX 4090',
  cloudType: 'SECURE',
  timings: { totalMs: 5000, jobMs: 4000 },
  cost: { usd: 0.001 },
  outputs: [{ url: 'https://example.com/out.png' }],
}) {
  return {
    runDeployment: async (_args: unknown) => result as typeof result,
  }
}

function makeModorum(modus: Modus | null = makeModus()) {
  return {
    find: async (_id: string, _versio?: string) => modus,
    register: async (_m: Modus) => {},
    list: async () => [],
  }
}

function makeCompile(deployment = FAKE_DEPLOYMENT) {
  return async (_modus: Modus, _aditus: Record<string, unknown>) => deployment
}

// ── reserve() ─────────────────────────────────────────────────────────────────

test('reserve returns impetusFixum when set on modus', async () => {
  const cursor = new RunPodCursor(makeRunner(), makeCompile(), makeModorum(), { accountId: 'acc-1' })
  const modus = makeModus({ impetusFixum: 500n })
  const result = await cursor.reserve(modus, {})
  assert.equal(result, 500n)
})

test('reserve returns default ceiling when impetusFixum absent', async () => {
  const cursor = new RunPodCursor(makeRunner(), makeCompile(), makeModorum(), { accountId: 'acc-1' })
  const modus = makeModus()
  const result = await cursor.reserve(modus, {})
  assert.equal(typeof result, 'bigint')
  assert.ok(result > 0n)
})

test('reserve uses configured maxJobSeconds when set', async () => {
  const cursor = new RunPodCursor(makeRunner(), makeCompile(), makeModorum(), {
    accountId: 'acc-1',
    maxJobSeconds: 600,
  })
  const result = await cursor.reserve(makeModus(), {})
  assert.equal(result, 600n)
})

// ── run() — happy path ────────────────────────────────────────────────────────

test('run returns exitus with outputs from runner', async () => {
  const cursor = new RunPodCursor(makeRunner(), makeCompile(), makeModorum(), { accountId: 'acc-1' })
  const exitus = await cursor.run(makeActum())
  assert.deepEqual(exitus.exitus.outputs, [{ url: 'https://example.com/out.png' }])
})

test('run sets duratio from runner totalMs', async () => {
  const cursor = new RunPodCursor(makeRunner(), makeCompile(), makeModorum(), { accountId: 'acc-1' })
  const exitus = await cursor.run(makeActum())
  assert.equal(exitus.duratio, 5000)
})

test('run sets materiamId from runner podId', async () => {
  const cursor = new RunPodCursor(makeRunner(), makeCompile(), makeModorum(), { accountId: 'acc-1' })
  const exitus = await cursor.run(makeActum())
  assert.equal(exitus.materiamId, 'pod-abc')
})

test('run impetus is ceil(totalMs / 1000)', async () => {
  const runner = makeRunner({ ...makeRunner().runDeployment({}) as unknown as object,
    status: 'completed',
    podId: 'pod-abc',
    gpuTypeId: 'RTX 4090',
    cloudType: 'SECURE',
    timings: { totalMs: 5001, jobMs: 4000 },
    cost: { usd: 0.001 },
    outputs: [],
  } as any)
  const cursor = new RunPodCursor(runner, makeCompile(), makeModorum(), { accountId: 'acc-1' })
  const exitus = await cursor.run(makeActum())
  assert.equal(exitus.impetus, 6n) // ceil(5001 / 1000) = 6
})

test('run passes actum.id as jobId to runDeployment', async () => {
  let capturedArgs: unknown
  const runner = {
    runDeployment: async (args: unknown) => {
      capturedArgs = args
      return {
        status: 'completed' as const,
        podId: 'p1',
        gpuTypeId: 'RTX',
        cloudType: 'SECURE',
        timings: { totalMs: 1000, jobMs: 900 },
        cost: { usd: 0 },
        outputs: [],
      }
    },
  }
  const cursor = new RunPodCursor(runner, makeCompile(), makeModorum(), { accountId: 'acc-1' })
  await cursor.run(makeActum({ id: 'my-actum-id' }))
  assert.equal((capturedArgs as any).jobId, 'my-actum-id')
})

test('run passes configured accountId to runDeployment', async () => {
  let capturedArgs: unknown
  const runner = {
    runDeployment: async (args: unknown) => {
      capturedArgs = args
      return {
        status: 'completed' as const,
        podId: 'p1',
        gpuTypeId: 'RTX',
        cloudType: 'SECURE',
        timings: { totalMs: 1000, jobMs: 900 },
        cost: { usd: 0 },
        outputs: [],
      }
    },
  }
  const cursor = new RunPodCursor(runner, makeCompile(), makeModorum(), { accountId: 'my-account' })
  await cursor.run(makeActum())
  assert.equal((capturedArgs as any).accountId, 'my-account')
})

// ── run() — error paths ───────────────────────────────────────────────────────

test('run throws when modus not found in modorum', async () => {
  const cursor = new RunPodCursor(makeRunner(), makeCompile(), makeModorum(null), { accountId: 'acc-1' })
  await assert.rejects(
    () => cursor.run(makeActum()),
    /not found/i
  )
})

test('run throws when runner returns stalled status', async () => {
  const runner = {
    runDeployment: async (_args: unknown) => ({
      status: 'stalled' as const,
      podId: 'pod-xyz',
      gpuTypeId: 'RTX',
      cloudType: 'SECURE',
      timings: { totalMs: 30000, jobMs: 29000 },
      cost: { usd: 0.01 },
      outputs: [],
      error: { code: 'STALLED', message: 'ComfyUI queue timed out' },
    }),
  }
  const cursor = new RunPodCursor(runner, makeCompile(), makeModorum(), { accountId: 'acc-1' })
  await assert.rejects(
    () => cursor.run(makeActum()),
    /stalled/i
  )
})
