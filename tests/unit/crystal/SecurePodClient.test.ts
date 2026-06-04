import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { SecurePodClient } from '../../../src/crystal/SecurePodClient.js'
import type { SecurePodConfig, SshTransportLike } from '../../../src/crystal/SecurePodClient.js'

// ── terminatePod spy ──────────────────────────────────────────────────────────
// SecurePodClient takes terminatePodFn as a constructor dep; we pass a spy
// to assert on calls without module mocking.

interface TerminateSpy {
  fn: (apiKey: string, podId: string) => Promise<void>
  calls: Array<{ apiKey: string; podId: string }>
  reset(): void
}
function makeTerminateSpy(): TerminateSpy {
  const calls: Array<{ apiKey: string; podId: string }> = []
  return {
    fn: async (apiKey, podId) => { calls.push({ apiKey, podId }) },
    calls,
    reset() { calls.length = 0 },
  }
}

// Shared across tests so `beforeEach` can reset it like vi.fn().mockClear()
let terminateSpy: TerminateSpy
beforeEach(() => { terminateSpy = makeTerminateSpy() })

// ── helpers ───────────────────────────────────────────────────────────────────

function makeSseStream(events: Array<Record<string, unknown>>): Response {
  const encoder = new TextEncoder()
  let i = 0
  const stream = new ReadableStream({
    pull(controller) {
      if (i >= events.length) { controller.close(); return }
      const ev = events[i++]
      controller.enqueue(encoder.encode(`id: ${i - 1}\ndata: ${JSON.stringify(ev)}\n\n`))
    },
  })
  return new Response(stream, { status: 200 })
}

function makeSshTransport(overrides: Partial<SshTransportLike> = {}): SshTransportLike & { execCalls: string[]; get closeCalled(): boolean } {
  const execCalls: string[] = []
  let _closeCalled = false
  return {
    execCalls,
    get closeCalled() { return _closeCalled },
    async exec(cmd: string) { execCalls.push(cmd); return '' },
    async close() { _closeCalled = true },
    ...overrides,
  } as SshTransportLike & { execCalls: string[]; get closeCalled(): boolean }
}

function makeConfig(overrides: Partial<SecurePodConfig> = {}): SecurePodConfig {
  return {
    apiKey: 'test-key',
    sshKeyPath: '/tmp/test-key',
    gpuTypeIds: ['NVIDIA GeForce RTX 4090'],
    imageName: 'runpod/pytorch:2.4.0',
    cloudType: 'SECURE',
    sshReadyTimeoutMs: 200,
    sshPollIntervalMs: 0,
    comfyReadyTimeoutMs: 200,
    comfyPollIntervalMs: 0,
    jobTimeoutMs: 2000,
    webhookRetryDelayMs: 0,
    ...overrides,
  }
}

interface FetchCall { url: string; method: string; body?: string }

function makeFetchMock(podId = 'pod-xyz', opts: {
  sshReadyAfterCalls?: number
  runnerHealthStatus?: string
  sseEvents?: Array<Record<string, unknown>>
  webhookPayloads?: unknown[]
} = {}): { fetch: typeof fetch; calls: FetchCall[]; webhookPayloads: unknown[] } {
  const {
    sshReadyAfterCalls = 1,
    runnerHealthStatus = 'ready',
    sseEvents = [{ type: 'complete' }],
    webhookPayloads = [],
  } = opts
  let statusCalls = 0
  const runnerBase = `https://${podId}-8080.proxy.runpod.net`
  const calls: FetchCall[] = []

  const fetch = (async (url: string, init?: RequestInit): Promise<Response> => {
    const method = (init?.method ?? 'GET').toUpperCase()
    calls.push({ url, method, body: init?.body as string | undefined })

    if (method === 'POST' && url.includes('rest.runpod.io') && url.includes('/pods') && !url.includes(podId)) {
      return new Response(JSON.stringify({ id: podId }), { status: 200 })
    }
    if (method === 'GET' && url.includes(`/pods/${podId}`)) {
      statusCalls++
      if (statusCalls >= sshReadyAfterCalls) {
        return new Response(JSON.stringify({
          desiredStatus: 'RUNNING',
          publicIp: '1.2.3.4',
          portMappings: { '22': 12345, '8080': 18080 },
        }), { status: 200 })
      }
      return new Response(JSON.stringify({ desiredStatus: 'STARTING' }), { status: 200 })
    }
    if (method === 'GET' && url === `${runnerBase}/health`) {
      return new Response(JSON.stringify({ status: runnerHealthStatus }), { status: 200 })
    }
    if (method === 'POST' && url === `${runnerBase}/job`) {
      return new Response('{}', { status: 200 })
    }
    if (method === 'GET' && url.startsWith(`${runnerBase}/job/`)) {
      return makeSseStream(sseEvents)
    }
    if (method === 'POST') {
      webhookPayloads.push(JSON.parse((init?.body as string) ?? '{}'))
      return new Response('{}', { status: 200 })
    }
    return new Response('Not found', { status: 404 })
  }) as unknown as typeof fetch

  return { fetch, calls, webhookPayloads }
}

function makeClient(
  config: SecurePodConfig,
  ssh: () => SshTransportLike,
  fetch: typeof fetch,
  materiae?: ConstructorParameters<typeof SecurePodClient>[3],
): SecurePodClient {
  return new SecurePodClient(config, ssh, fetch, materiae, undefined, terminateSpy.fn)
}

// ── provisioning ──────────────────────────────────────────────────────────────

test('submit provisions a SECURE pod via RunPod REST API', async () => {
  const { fetch, calls } = makeFetchMock()
  const client = makeClient(makeConfig(), () => makeSshTransport(), fetch)
  await client.submit({ input: {} })
  const provision = calls.find(c => c.method === 'POST' && c.url.includes('rest.runpod.io'))
  assert.ok(provision, 'expected a provision POST')
})

test('submit returns pod ID immediately', async () => {
  const { fetch } = makeFetchMock('pod-abc')
  const client = makeClient(makeConfig(), () => makeSshTransport(), fetch)
  const result = await client.submit({ input: {} })
  assert.equal(result.id, 'pod-abc')
})

test('submit throws when RunPod returns an error', async () => {
  const failFetch = (async () => new Response('{"error":"no capacity"}', { status: 500 })) as unknown as typeof fetch
  const client = makeClient(makeConfig(), () => makeSshTransport(), failFetch)
  await assert.rejects(() => client.submit({ input: {} }), /pod provision failed/i)
})

test('submit provisions with SECURE cloudType by default', async () => {
  let provisionBody: unknown
  const fetchFn = (async (url: string, opts?: RequestInit): Promise<Response> => {
    if ((opts?.method ?? 'GET').toUpperCase() === 'POST' && url.includes('rest.runpod.io')) {
      provisionBody = JSON.parse(opts?.body as string)
      return new Response(JSON.stringify({ id: 'pod-1' }), { status: 200 })
    }
    if (url.includes('/pods/pod-1')) {
      return new Response(JSON.stringify({
        desiredStatus: 'RUNNING', publicIp: '1.2.3.4', portMappings: { '22': 22, '8080': 8080 },
      }), { status: 200 })
    }
    if (url.includes('health')) return new Response('{"status":"ready"}', { status: 200 })
    if ((opts?.method ?? 'GET').toUpperCase() === 'POST') return new Response('{}', { status: 200 })
    if (url.includes('/job/')) return makeSseStream([{ type: 'complete' }])
    if ((opts?.method ?? 'GET').toUpperCase() === 'DELETE') return new Response('{}', { status: 200 })
    return new Response('{}', { status: 200 })
  }) as unknown as typeof fetch

  const client = makeClient(makeConfig({ cloudType: undefined }), () => makeSshTransport(), fetchFn)
  await client.submit({ input: {} })
  assert.equal((provisionBody as { cloudType: string }).cloudType, 'SECURE')
})

// ── SSH bootstrap ─────────────────────────────────────────────────────────────

test('SSH bootstrap: closes SSH after bootstrap completes', async () => {
  const { fetch } = makeFetchMock()
  const ssh = makeSshTransport()
  const client = makeClient(makeConfig(), () => ssh, fetch)
  await client.submit({ input: {} })
  await new Promise(r => setTimeout(r, 50))
  assert.equal(ssh.closeCalled, true)
})

test('SSH bootstrap: runs exec commands before submitting to comfyrunner', async () => {
  const { fetch } = makeFetchMock()
  const ssh = makeSshTransport()
  const client = makeClient(makeConfig(), () => ssh, fetch)
  await client.submit({ input: {} })
  await new Promise(r => setTimeout(r, 50))
  assert.ok(ssh.execCalls.length > 0, 'expected exec calls during bootstrap')
  assert.ok(ssh.execCalls.some(c => c.includes('git')), 'expected git exec')
})

test('SSH bootstrap: terminates pod + fires FAILED webhook when SSH throws', async () => {
  const brokenSsh = makeSshTransport({ async exec(cmd) { if (cmd === 'true') return ''; throw new Error('ECONNREFUSED') } })
  const webhookPayloads: unknown[] = []
  const { fetch } = makeFetchMock('pod-fail', { webhookPayloads })
  const client = makeClient(makeConfig(), () => brokenSsh, fetch)
  await client.submit({ input: {}, webhook: 'https://hook.example.com/done' })
  await new Promise(r => setTimeout(r, 300))
  assert.ok(terminateSpy.calls.length > 0, 'expected terminatePod call')
  const failed = (webhookPayloads as Array<{ status?: string }>).find(p => p.status === 'FAILED')
  assert.ok(failed, 'expected a FAILED webhook')
})

test('SSH bootstrap: does NOT fire FAILED after comfyrunner accepted (comfyrunner owns webhook)', async () => {
  const webhookPayloads: unknown[] = []
  const { fetch } = makeFetchMock('pod-accepted', { webhookPayloads, sseEvents: [{ type: 'error', error: 'OOM' }] })
  const client = makeClient(makeConfig(), () => makeSshTransport(), fetch)
  await client.submit({ input: {}, webhook: 'https://hook.example.com/done' })
  await new Promise(r => setTimeout(r, 300))
  assert.equal((webhookPayloads as Array<{ status?: string }>).some(p => p.status === 'FAILED'), false)
})

test('SSH bootstrap: no re-provision after comfyrunner accepted (no retry cascade)', async () => {
  const { fetch, calls } = makeFetchMock('pod-accepted', { sseEvents: [{ type: 'error', error: 'OOM' }] })
  const client = makeClient(makeConfig(), () => makeSshTransport(), fetch)
  await client.submit({ input: {}, webhook: 'https://hook.example.com/done' })
  await new Promise(r => setTimeout(r, 300))
  const provisionCalls = calls.filter(c =>
    c.method === 'POST' && c.url.includes('rest.runpod.io') && c.url.includes('/pods'),
  )
  assert.equal(provisionCalls.length, 1)
})

// ── pod lifecycle ─────────────────────────────────────────────────────────────

test('pod lifecycle: terminates pod after job completes', async () => {
  const { fetch } = makeFetchMock('pod-term')
  const client = makeClient(makeConfig(), () => makeSshTransport(), fetch)
  await client.submit({ input: {} })
  await new Promise(r => setTimeout(r, 100))
  assert.ok(terminateSpy.calls.some(c => c.apiKey === 'test-key' && c.podId === 'pod-term'),
    `expected terminate('test-key', 'pod-term'); calls=${JSON.stringify(terminateSpy.calls)}`)
})

test('pod lifecycle: terminates pod even when SSH never becomes ready', async () => {
  const { fetch } = makeFetchMock('pod-ssh-timeout', { sshReadyAfterCalls: 9999 })
  const client = makeClient(
    makeConfig({ sshReadyTimeoutMs: 50, sshPollIntervalMs: 10 }),
    () => makeSshTransport(),
    fetch,
  )
  await client.submit({ input: {}, webhook: 'https://hook.example.com/done' })
  await new Promise(r => setTimeout(r, 300))
  assert.ok(terminateSpy.calls.length > 0, 'expected terminatePod call')
})

test('pod lifecycle: terminates pod when comfyrunner never becomes ready', async () => {
  const { fetch } = makeFetchMock('pod-norunner', { runnerHealthStatus: 'starting' })
  const client = makeClient(
    makeConfig({ comfyReadyTimeoutMs: 50, comfyPollIntervalMs: 0 }),
    () => makeSshTransport(),
    fetch,
  )
  await client.submit({ input: {} })
  await new Promise(r => setTimeout(r, 300))
  assert.ok(terminateSpy.calls.length > 0, 'expected terminatePod call')
})

// ── keepWarm ──────────────────────────────────────────────────────────────────

function makeWarmMateriaStore(): {
  createCalls: unknown[]
  create(input: unknown): Promise<{ id: string }>
  findById(): Promise<null>
  update(): Promise<never>
  findWarm(): Promise<null>
} {
  const createCalls: unknown[] = []
  return {
    createCalls,
    async create(input) { createCalls.push(input); return { ...(input as object), id: 'mat-new' } },
    async findById() { return null },
    async update() { return null as never },
    async findWarm() { return null },
  }
}

test('keepWarm: registers Materia as idle after job completes (no termination)', async () => {
  const { fetch } = makeFetchMock('pod-warm')
  const store = makeWarmMateriaStore()
  const client = makeClient(makeConfig({ keepWarm: true }), () => makeSshTransport(), fetch, store as never)
  await client.submit({ input: {} })
  await new Promise(r => setTimeout(r, 100))
  assert.equal(store.createCalls.length, 1)
  assert.equal((store.createCalls[0] as { status: string }).status, 'idle')
  assert.equal(terminateSpy.calls.length, 0)
})

test('keepWarm: registered Materia has imageRef matching config.imageName', async () => {
  const { fetch } = makeFetchMock('pod-warm-img')
  const store = makeWarmMateriaStore()
  const client = makeClient(makeConfig({ keepWarm: true, imageName: 'test/image:v2' }), () => makeSshTransport(), fetch, store as never)
  await client.submit({ input: {} })
  await new Promise(r => setTimeout(r, 100))
  assert.equal((store.createCalls[0] as { imageRef: string }).imageRef, 'test/image:v2')
})

test('keepWarm: registered Materia has correct externusId', async () => {
  const { fetch } = makeFetchMock('pod-warm-id')
  const store = makeWarmMateriaStore()
  const client = makeClient(makeConfig({ keepWarm: true }), () => makeSshTransport(), fetch, store as never)
  await client.submit({ input: {} })
  await new Promise(r => setTimeout(r, 100))
  assert.equal((store.createCalls[0] as { externusId: string }).externusId, 'pod-warm-id')
})

test('keepWarm: terminates pod (no Materia registered) when bootstrap SSH throws', async () => {
  const brokenSsh = makeSshTransport({ async exec(cmd) { if (cmd === 'true') return ''; throw new Error('SSH refused') } })
  const { fetch } = makeFetchMock('pod-warm-fail')
  const store = makeWarmMateriaStore()
  const client = makeClient(makeConfig({ keepWarm: true }), () => brokenSsh, fetch, store as never)
  await client.submit({ input: {} })
  await new Promise(r => setTimeout(r, 300))
  assert.ok(terminateSpy.calls.length > 0, 'expected terminatePod call')
  assert.equal(store.createCalls.length, 0)
})

// ── provisionStudio (/arm Start, Part A) ───────────────────────────────────────

test('provisionStudio provisions + parks a warm Materia WITHOUT submitting a job', async () => {
  const { fetch, calls } = makeFetchMock('pod-studio')
  const store = makeWarmMateriaStore()
  const client = makeClient(makeConfig({ keepWarm: true }), () => makeSshTransport(), fetch, store as never)
  const res = await client.provisionStudio({ runtime: 'ComfyUI' })

  assert.ok(res, 'returns pod telemetry')
  assert.equal(res!.podId, 'pod-studio')
  assert.equal(typeof res!.provisionMs, 'number')
  assert.equal(store.createCalls.length, 1, 'a warm Materia was parked')
  const parked = store.createCalls[0] as { status: string; externusId: string; runtime?: string }
  assert.equal(parked.status, 'idle', 'parked idle (warm), not running a gen')
  assert.equal(parked.externusId, 'pod-studio')
  assert.equal(parked.runtime, 'ComfyUI', 'runtime stamped on the studio')
  assert.equal(terminateSpy.calls.length, 0, 'a healthy provision is not terminated')
  // No gen ran: comfyrunner /job is never POSTed.
  assert.ok(!calls.some(c => c.method === 'POST' && c.url.endsWith('/job')), 'no job submitted')
})

test('provisionStudio terminates the pod and returns null when bootstrap fails', async () => {
  const brokenSsh = makeSshTransport({ async exec(cmd) { if (cmd === 'true') return ''; throw new Error('SSH refused') } })
  const { fetch } = makeFetchMock('pod-studio-fail')
  const store = makeWarmMateriaStore()
  const client = makeClient(makeConfig({ keepWarm: true }), () => brokenSsh, fetch, store as never)
  const res = await client.provisionStudio({})
  assert.equal(res, null, 'returns null on failure')
  assert.equal(store.createCalls.length, 0, 'nothing parked')
  assert.ok(terminateSpy.calls.length > 0, 'the half-provisioned pod is terminated')
})
