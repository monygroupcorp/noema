import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import {
  SecurePodClient,
  DEFAULT_GPU_TYPE_IDS,
  ACCEPTED_GPU_TYPE_IDS,
  assertGpuTypeIdsAccepted,
  PROVISION_BUDGET_MS,
  SSH_IPLESS_BAILOUT_MS,
} from '../../../src/crystal/SecurePodClient.js'
import type { SecurePodConfig, SshTransportLike } from '../../../src/crystal/SecurePodClient.js'
import { impetusPerSecondFromHourly } from '../../../src/ledger/rates.js'
import { withTrace, makeTraceContext } from '../../../src/lib/trace.js'
import { bus } from '../../../src/lib/bus.js'
import type { LogEntry } from '../../../src/lib/logger.js'

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

// A promise a test can settle from inside a callback — how the background launch phase is
// observed now that it no longer resolves to the caller.
function deferred<T = void>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(r => { resolve = r })
  return { promise, resolve }
}

/** Bound a wait on the background phase, so a regression that never reports fails the test
 *  quickly and legibly instead of hanging it. */
async function within<T>(p: Promise<T>, what: string, ms = 1000): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const bound = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`timed out waiting for ${what}`)), ms)
  })
  try { return await Promise.race([p, bound]) } finally { clearTimeout(timer) }
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
  costPerHr?: number
} = {}): { fetch: typeof fetch; calls: FetchCall[]; webhookPayloads: unknown[] } {
  const {
    sshReadyAfterCalls = 1,
    runnerHealthStatus = 'ready',
    sseEvents = [{ type: 'complete' }],
    webhookPayloads = [],
    costPerHr,
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
          ...(costPerHr !== undefined ? { costPerHr } : {}),
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
  // `typeof globalThis.fetch`, not `typeof fetch`: this binding is itself named `fetch`, so the
  // unqualified form would be a self-reference in its own initializer.
  }) as unknown as typeof globalThis.fetch

  return { fetch, calls, webhookPayloads }
}

function makeClient(
  config: SecurePodConfig,
  ssh: () => SshTransportLike,
  fetch: typeof globalThis.fetch,
  materiae?: ConstructorParameters<typeof SecurePodClient>[3],
  isActumLive?: ConstructorParameters<typeof SecurePodClient>[6],
): SecurePodClient {
  return new SecurePodClient(config, ssh, fetch, materiae, undefined, terminateSpy.fn, isActumLive)
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
  const failed = (webhookPayloads as Array<{ status?: string; id?: string }>).find(p => p.status === 'FAILED')
  assert.ok(failed, 'expected a FAILED webhook')
  // The FAILED webhook must be keyed by the ACTIVE pod id — that's what the actum's
  // externusJobId tracks (onPodActive). Posting a different pod id 404s the webhook and
  // the run never reaches `fractus` (incident 2026-06-19, retry path).
  assert.equal(failed!.id, 'pod-fail', 'FAILED webhook keyed by the active pod id')
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

test('pod lifecycle: the SSH timeout error names the last-seen desiredStatus / publicIp / port-22 mapping', async () => {
  // sshReadyAfterCalls: 9999 means every status poll returns the mock's default
  // `{ desiredStatus: 'STARTING' }` body — a successful read, but never ready. The
  // give-up message must carry that last reading, not the bare "SSH not ready" line.
  const webhookPayloads: unknown[] = []
  const { fetch } = makeFetchMock('pod-ssh-timeout', { sshReadyAfterCalls: 9999, webhookPayloads })
  const client = makeClient(
    makeConfig({ sshReadyTimeoutMs: 50, sshPollIntervalMs: 10 }),
    () => makeSshTransport(),
    fetch,
  )
  await client.submit({ input: {}, webhook: 'https://hook.example.com/done' })
  await new Promise(r => setTimeout(r, 300))
  const failed = (webhookPayloads as Array<{ status?: string; error?: string }>).find(p => p.status === 'FAILED')
  assert.ok(failed, 'expected a FAILED webhook')
  assert.match(failed!.error ?? '', /desiredStatus=STARTING/)
  assert.match(failed!.error ?? '', /publicIp=<absent>/)
  assert.match(failed!.error ?? '', /port22=<absent>/)
})

test('pod lifecycle: a pod whose every status fetch failed reports that it was never observed, not a false "not RUNNING"', async () => {
  // Every GET to /pods/:id 500s — _getSshInfo never gets a successful read, so there is
  // no observation to name. An absent reading must not render as desiredStatus=<absent>,
  // which would read as "the API answered and said nothing" rather than "never answered".
  const webhookPayloads: unknown[] = []
  const podId = 'pod-ssh-unreachable'
  const fetchFn = (async (url: string, init?: RequestInit): Promise<Response> => {
    const method = (init?.method ?? 'GET').toUpperCase()
    if (method === 'POST' && url.includes('rest.runpod.io') && url.includes('/pods') && !url.includes(podId)) {
      return new Response(JSON.stringify({ id: podId }), { status: 200 })
    }
    if (method === 'GET' && url.includes(`/pods/${podId}`)) {
      return new Response('{"error":"internal"}', { status: 500 })
    }
    if (method === 'POST') {
      webhookPayloads.push(JSON.parse((init?.body as string) ?? '{}'))
      return new Response('{}', { status: 200 })
    }
    return new Response('Not found', { status: 404 })
  }) as unknown as typeof fetch

  const client = makeClient(
    makeConfig({ sshReadyTimeoutMs: 50, sshPollIntervalMs: 10 }),
    () => makeSshTransport(),
    fetchFn,
  )
  await client.submit({ input: {}, webhook: 'https://hook.example.com/done' })
  await new Promise(r => setTimeout(r, 300))
  const failed = (webhookPayloads as Array<{ status?: string; error?: string }>).find(p => p.status === 'FAILED')
  assert.ok(failed, 'expected a FAILED webhook')
  assert.match(failed!.error ?? '', /no successful status read/)
  assert.doesNotMatch(failed!.error ?? '', /desiredStatus=/)
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

// ── zombie-retry guard (noema-043) ─────────────────────────────────────────────
// The retry loop (attempt 1's `_runBackground` failing via a broken SSH transport, before
// comfyrunner ever accepts the job) is a safe, deterministic way to force entry into the
// attempt>=2 branch without tripping the "comfyrunner owns the webhook" / permanent-error
// short-circuits, matching the existing bootstrap-failure tests above.

function makeBrokenSsh(): SshTransportLike {
  return makeSshTransport({ async exec(cmd) { if (cmd === 'true') return ''; throw new Error('ECONNREFUSED') } })
}

/** SSH factory that fails bootstrap on the first pod, then succeeds on every retry pod. */
function makeFlakySshFactory(): () => SshTransportLike {
  let calls = 0
  return () => (++calls === 1 ? makeBrokenSsh() : makeSshTransport())
}

test('zombie guard: aborts before provisioning a retry pod when the actum is already terminal', async () => {
  const { fetch, calls } = makeFetchMock('pod-zombie')
  const client = makeClient(makeConfig(), () => makeBrokenSsh(), fetch, undefined, async () => false)
  await withTrace(makeTraceContext({ actumId: 'act-dead' }), () => client.submit({ input: {} }))
  await new Promise(r => setTimeout(r, 300))

  const provisionCalls = calls.filter(c => c.method === 'POST' && c.url.includes('rest.runpod.io') && c.url.includes('/pods'))
  assert.equal(provisionCalls.length, 1, 'no retry provision for an actum already terminal')
  assert.equal(terminateSpy.calls.length, 1, 'only the attempt-1 pod was terminated — no retry pod was ever spun up')
})

test('zombie guard: terminates a freshly-provisioned retry pod when the actum goes terminal before job submit', async () => {
  const { fetch, calls } = makeFetchMock('pod-zombie2')
  let liveChecks = 0
  const isActumLive = async (): Promise<boolean> => (++liveChecks === 1)   // live for the pre-provision check, terminal by submit-time
  const client = makeClient(makeConfig(), () => makeBrokenSsh(), fetch, undefined, isActumLive)
  await withTrace(makeTraceContext({ actumId: 'act-dies-mid-retry' }), () => client.submit({ input: {} }))
  await new Promise(r => setTimeout(r, 300))

  const provisionCalls = calls.filter(c => c.method === 'POST' && c.url.includes('rest.runpod.io') && c.url.includes('/pods'))
  assert.equal(provisionCalls.length, 2, 'the retry pod WAS provisioned (actum still live at that check)')
  const jobPosts = calls.filter(c => c.method === 'POST' && c.url.endsWith('/job'))
  assert.equal(jobPosts.length, 0, 'the job was never submitted for the now-terminal actum')
  assert.equal(terminateSpy.calls.length, 2, 'attempt-1 pod (bootstrap failure) + the aborted retry pod, both terminated')
})

test('zombie guard: live actum lets retries proceed unchanged (regression guard)', async () => {
  const { fetch, calls } = makeFetchMock('pod-live-retry')
  const client = makeClient(makeConfig(), makeFlakySshFactory(), fetch, undefined, async () => true)
  await withTrace(makeTraceContext({ actumId: 'act-live' }), () => client.submit({ input: {} }))
  await new Promise(r => setTimeout(r, 300))

  const jobPosts = calls.filter(c => c.method === 'POST' && c.url.endsWith('/job'))
  assert.equal(jobPosts.length, 1, 'the retry pod still submits the job when the actum stays live')
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

test('provisionStudio derives Materia.impetusPerSecond from the pod hourly cost (not a static 0)', async () => {
  const { fetch } = makeFetchMock('pod-rate', { costPerHr: 4.0 })
  const store = makeWarmMateriaStore()
  const client = makeClient(makeConfig({ keepWarm: true }), () => makeSshTransport(), fetch, store as never)
  await client.provisionStudio({})

  const parked = store.createCalls[0] as { impetusPerSecond: bigint; costPerHr?: number }
  // costPerHr is the billing source of truth — stamped from the pod's live $/hr.
  assert.equal(parked.costPerHr, 4.0, 'real hourly cost stamped for per-window billing')
  // impetusPerSecond is kept as a coarse display/legacy-fallback figure ($4/hr → 4/s).
  assert.equal(parked.impetusPerSecond, impetusPerSecondFromHourly(4.0))
  assert.equal(parked.impetusPerSecond, 4n)
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

// ── ComfyUI clone pin (2026-07-10 P0 regression guard) ─────────────────────────
// Unpinned `git clone` of ComfyUI HEAD drifted onto a torch-2.5+-only code path while every
// fundament's image pinned torch 2.4.0 — every ComfyUI pod broke. This guard fails loudly if
// the clone ever goes unpinned again: the bootstrap command MUST carry `--branch`.

test('ComfyUI bootstrap: clone is pinned to a ref (never unpinned HEAD)', async () => {
  const { fetch } = makeFetchMock()
  const ssh = makeSshTransport()
  const client = makeClient(makeConfig(), () => ssh, fetch)
  await client.submit({ input: {} })
  await new Promise(r => setTimeout(r, 50))
  const cloneCmd = ssh.execCalls.find(c => c.includes('git clone') && c.includes('ComfyUI.git'))
  assert.ok(cloneCmd, 'expected a ComfyUI clone command')
  assert.match(cloneCmd!, /--branch/, 'clone must pin a ref via --branch (never unpinned HEAD)')
})

test("ComfyUI bootstrap: provisionStudio's clone is also pinned via --branch", async () => {
  const { fetch } = makeFetchMock('pod-studio-pin')
  const ssh = makeSshTransport()
  const store = makeWarmMateriaStore()
  const client = makeClient(makeConfig({ keepWarm: true }), () => ssh, fetch, store as never)
  await client.provisionStudio({ runtime: 'ComfyUI' })
  const cloneCmd = ssh.execCalls.find(c => c.includes('git clone') && c.includes('ComfyUI.git'))
  assert.ok(cloneCmd, 'expected a ComfyUI clone command')
  assert.match(cloneCmd!, /--branch/, 'clone must pin a ref via --branch (never unpinned HEAD)')
})

// ── RunPod gpuTypeIds enum (noema-103) ─────────────────────────────────────────
// SECURE-tier provisioning (attempts 1-2) sends DEFAULT_GPU_TYPE_IDS as the pod's
// `gpuTypeIds`. RunPod 400s an unknown id, degrading SECURE to a COMMUNITY fallback
// (loses the private/TEE guarantee). These pin the sent list to RunPod's accepted enum
// and prove the construct-time drift guard fails loud (naming the SKU) before any POST.

test('default-path provision sends DEFAULT_GPU_TYPE_IDS as gpuTypeIds when config omits it', async () => {
  const { fetch, calls } = makeFetchMock('pod-default-gpus')
  // No gpuTypeIds in config → resolves to DEFAULT_GPU_TYPE_IDS, mirroring the real
  // wiring at src/index.ts:308-323 (SecurePodClient built with no gpuTypeIds).
  const client = makeClient(makeConfig({ gpuTypeIds: undefined }), () => makeSshTransport(), fetch)
  await client.submit({ input: {} })
  const provision = calls.find(c =>
    c.method === 'POST' && c.url.includes('rest.runpod.io') && c.url.includes('/pods'),
  )
  assert.ok(provision, 'expected a provision POST')
  const body = JSON.parse(provision!.body ?? '{}') as { gpuTypeIds?: string[] }
  assert.deepEqual(body.gpuTypeIds, DEFAULT_GPU_TYPE_IDS,
    'default provision must send exactly the pruned DEFAULT_GPU_TYPE_IDS')
})

test('DEFAULT_GPU_TYPE_IDS is a subset of RunPod\'s accepted enum (no stale SKUs)', () => {
  const offending = DEFAULT_GPU_TYPE_IDS.filter(id => !ACCEPTED_GPU_TYPE_IDS.includes(id))
  assert.deepEqual(offending, [], `stale gpuTypeIds present: ${offending.join(', ')}`)
  // Regression pin for the specific pruned SKU (noema-103).
  assert.ok(!DEFAULT_GPU_TYPE_IDS.includes('NVIDIA A30'), "'NVIDIA A30' must stay pruned")
  // Over-pruning guard: the primary SECURE GPU must remain.
  assert.ok(DEFAULT_GPU_TYPE_IDS.includes('NVIDIA GeForce RTX 4090'),
    'primary SECURE GPU must be retained')
})

test('construct-time guard: constructing SecurePodClient with the real DEFAULT list does not throw', () => {
  assert.doesNotThrow(() => makeClient(makeConfig(), () => makeSshTransport(), makeFetchMock().fetch))
})

test('assertGpuTypeIdsAccepted: does not throw for the real DEFAULT_GPU_TYPE_IDS', () => {
  assert.doesNotThrow(() => assertGpuTypeIdsAccepted(DEFAULT_GPU_TYPE_IDS))
})

test('assertGpuTypeIdsAccepted: throws naming the offending SKU on a synthetic drifted list', () => {
  const drifted = [...DEFAULT_GPU_TYPE_IDS, 'NVIDIA A30']
  assert.throws(
    () => assertGpuTypeIdsAccepted(drifted),
    (err: unknown) => {
      assert.ok(err instanceof Error)
      assert.match(err.message, /NVIDIA A30/, 'error must name the offending SKU explicitly')
      return true
    },
  )
})

test('assertGpuTypeIdsAccepted: names every offending SKU when multiple have drifted', () => {
  assert.throws(
    () => assertGpuTypeIdsAccepted(['NVIDIA A30', 'NVIDIA GeForce RTX 4090', 'NVIDIA MADE-UP-GPU']),
    (err: unknown) => {
      assert.ok(err instanceof Error)
      assert.match(err.message, /NVIDIA A30/)
      assert.match(err.message, /NVIDIA MADE-UP-GPU/)
      return true
    },
  )
})

// ── bootstrap phase deadline ──────────────────────────────────────────────────
//
// Each setup command keeps a generous individual ceiling — the dependency install is legitimately
// slow — but individually-permissible commands can add up past the provisioning budget the actum's
// deadline is derived from. The phase deadline is what stops that, and it names the command it
// stopped at so the failure is legible instead of resurfacing later as a run that never reported
// back. Time is driven by the mocked clock; each command "takes" 20 minutes.

test('a bootstrap whose commands outlast the provisioning budget is stopped at the budget, naming the command that was running', async (t) => {
  t.mock.timers.enable({ apis: ['Date'] })

  const CMD_MS = 20 * 60 * 1000
  const setup = ['apt-get install', 'git clone', 'git checkout', 'pip install -r', 'pip install --force-reinstall']
  const attempted: string[] = []
  const ssh = makeSshTransport({
    async exec(cmd: string) {
      if (cmd === 'true') return ''            // the sshd readiness probe, not a setup command
      attempted.push(cmd)
      t.mock.timers.tick(CMD_MS)
      return ''
    },
  })
  const { fetch } = makeFetchMock()
  const client = makeClient(makeConfig(), () => ssh, fetch)

  // The bootstrap is the background phase now, so the budget failure arrives at the failure sink
  // rather than at the caller — the caller already has its pod id.
  const failure = deferred<unknown>()
  await client.launchTrainingPod({
    image: 'runpod/pytorch:2.4.0', env: {}, setup,
    onLaunchFailed: async (err) => { failure.resolve(err) },
  })
  const err = await within(failure.promise, 'the provisioning-budget failure') as Error

  assert.match(err.message, /provisioning budget/i)
  assert.ok(err.message.includes(setup[attempted.length]),
    `the error must name the command it stopped before, got: ${err.message}`)

  // Per-command ceilings ALONE would have permitted every command to run: 5 × 20 min = 100 min,
  // inside a 45-min budget. The phase deadline is what refuses the ones past the budget.
  assert.ok(attempted.length < setup.length, 'the phase deadline must stop the run short of the full setup')
  assert.ok(setup.length * CMD_MS > PROVISION_BUDGET_MS, 'per-command ceilings alone do not bound the phase')
  // The pod is not leaked when provisioning gives up.
  assert.equal(terminateSpy.calls.length, 1)
})

// ── asynchronous launch ───────────────────────────────────────────────────────
//
// `launchTrainingPod` resolves at the pod id and finishes SSH + bootstrap in the background. The
// four tests below pin the properties that split depends on: the early resolve, the background
// failure path (terminate + report), the terminal catch that keeps a background rejection from
// escaping, and the ordering that puts the caller's stamp ahead of any pod-side work.

/** A pod-status gate: the SSH wait blocks on `gate` so the caller's resolve can be observed while
 *  the background phase is provably still waiting. */
function makeGatedFetch(gate: Promise<void>, onPodStatus?: () => void): typeof fetch {
  const base = makeFetchMock()
  return (async (url: string, init?: RequestInit): Promise<Response> => {
    if ((init?.method ?? 'GET').toUpperCase() === 'GET' && url.includes('/pods/pod-xyz')) {
      onPodStatus?.()
      await gate
    }
    return (base.fetch as unknown as (u: string, i?: RequestInit) => Promise<Response>)(url, init)
  }) as unknown as typeof fetch
}

test('launchTrainingPod resolves with a pod id while the SSH wait is still pending, and finishes the bootstrap in the background', async () => {
  // The SSH wait is held for a beat, long enough for a launch that (wrongly) waited on it to be
  // visibly still working when the assertions below run.
  const gate = deferred<void>()
  const gateTimer = setTimeout(() => gate.resolve(), 50)
  const detached = deferred<void>()
  const execs: string[] = []
  let sshSessions = 0
  const ssh = makeSshTransport({
    async exec(cmd: string) {
      execs.push(cmd)
      if (cmd.includes('nohup')) detached.resolve()
      return ''
    },
  })
  const client = makeClient(makeConfig(), () => { sshSessions++; return ssh }, makeGatedFetch(gate.promise))

  const { podId } = await client.launchTrainingPod({ image: 'runpod/pytorch:2.4.0', env: {}, setup: ['pip install -r'] })

  // The pod id is the external run handle and it exists the moment provisioning returns. The SSH
  // wait is still blocked at this point, so nothing has been bootstrapped.
  assert.equal(podId, 'pod-xyz')
  assert.equal(sshSessions, 0, 'the launch must resolve before SSH is even reachable')
  // `[] as string[]`: node's `deepEqual` is typed `asserts actual is T`, so a bare `[]` narrows
  // `execs` to `never[]` for the rest of the test and the later `includes` check stops compiling.
  assert.deepEqual(execs, [] as string[], 'no pod-side command can have run yet')

  await within(detached.promise, 'the detached launch command')
  clearTimeout(gateTimer)

  // ...and the work still happens, in full, after the caller has been answered.
  assert.ok(execs.includes('pip install -r'), 'the setup recipe runs in the background phase')
  assert.equal(terminateSpy.calls.length, 0, 'a launch that bootstrapped is not terminated')
})

test('a bootstrap that throws after launch resolved still terminates the pod AND fails the actum', async () => {
  const failure = deferred<unknown>()
  const ssh = makeSshTransport({
    async exec(cmd: string) {
      if (cmd === 'true') return ''                       // the sshd readiness probe
      throw new Error('setup command failed on the pod')
    },
  })
  const { fetch } = makeFetchMock()
  const client = makeClient(makeConfig(), () => ssh, fetch)

  const { podId } = await client.launchTrainingPod({
    image: 'runpod/pytorch:2.4.0', env: {}, setup: ['pip install -r'],
    onLaunchFailed: async (err) => { failure.resolve(err) },
  })

  const err = await within(failure.promise, 'the background launch failure') as Error
  // Both halves matter: the pod must not leak (nothing else terminates it once the caller is gone),
  // and the run must learn the real error now rather than at its deadline.
  assert.match(err.message, /setup command failed on the pod/)
  assert.deepEqual(terminateSpy.calls.map(c => c.podId), [podId])
})

test('a background bootstrap rejection never escapes as an unhandled rejection', async () => {
  const escaped: unknown[] = []
  const onUnhandled = (reason: unknown): void => { escaped.push(reason) }
  process.on('unhandledRejection', onUnhandled)
  try {
    const sank = deferred<void>()
    const ssh = makeSshTransport({
      async exec(cmd: string) {
        if (cmd === 'true') return ''
        throw new Error('setup command failed on the pod')
      },
    })
    const { fetch } = makeFetchMock()
    const client = makeClient(makeConfig(), () => ssh, fetch)

    // The sink itself throws — the harshest case, and the one that reaches the continuation's own
    // terminal catch rather than the inner failure handling.
    await client.launchTrainingPod({
      image: 'runpod/pytorch:2.4.0', env: {}, setup: ['pip install -r'],
      onLaunchFailed: async () => { sank.resolve(); throw new Error('the failure sink threw') },
    })

    await within(sank.promise, 'the background launch failure')
    await new Promise(resolve => setTimeout(resolve, 20))   // let the rejection settle, if it can
    assert.deepEqual(escaped, [], 'the unawaited continuation must own a terminal catch')
  } finally {
    process.off('unhandledRejection', onUnhandled)
  }
})

test('the actum carries externusJobId + callbackNonce before any pod-side work can call back', async () => {
  const order: string[] = []
  const detached = deferred<void>()
  const gate = deferred<void>()
  gate.resolve()
  const ssh = makeSshTransport({
    async exec(cmd: string) {
      order.push(`exec:${cmd}`)
      if (cmd.includes('nohup')) detached.resolve()
      return ''
    },
  })
  const fetch = makeGatedFetch(gate.promise, () => { order.push('ssh-wait') })
  const client = makeClient(makeConfig(), () => ssh, fetch)

  await client.launchTrainingPod({
    image: 'runpod/pytorch:2.4.0', env: {}, setup: ['pip install -r'],
    onPodId: async (podId) => { order.push(`stamp:${podId}`) },
  })
  await within(detached.promise, 'the detached launch command')

  // The stamp is what lets the run answer for the pod — the handle and the per-job callback
  // credential land on it. It is awaited before the background phase is scheduled, so a pod cannot
  // be live carrying a credential the run does not yet have.
  assert.equal(order[0], 'stamp:pod-xyz', 'the stamp must precede every pod-side step')
  assert.ok(order.includes('ssh-wait'), 'the background phase did run')
  assert.ok(order.indexOf('stamp:pod-xyz') < order.indexOf('ssh-wait'))
})

// The background half of the launch is where the minutes are: the SSH wait, the dependency
// bootstrap, then the detached start. It runs after the caller has been answered and outside its
// trace, so `onPhase` is the only way those minutes can reach a run's timeline.
test('the background launch reports the pod lock, the preparation and the handover', async () => {
  const detached = deferred<void>()
  const ssh = makeSshTransport({
    async exec(cmd: string) {
      if (cmd.includes('nohup')) detached.resolve()
      return ''
    },
  })
  const { fetch } = makeFetchMock()
  const client = makeClient(makeConfig(), () => ssh, fetch)

  const phases: Array<{ phase: string; message?: string }> = []
  await client.launchTrainingPod({
    image: 'runpod/pytorch:2.4.0', env: {}, setup: ['pip install -r'],
    onPhase: (p) => { phases.push({ phase: p.phase, ...(p.message ? { message: p.message } : {}) }) },
  })
  await within(detached.promise, 'the detached launch command')

  assert.deepEqual(phases.map(p => p.phase), ['provisioning', 'installing', 'loading'])
  // The pod-locked report carries the identity/cost of the machine that was acquired.
  assert.ok(phases[0].message, 'the pod lock says which pod was acquired')
  // The bootstrap is reported BEFORE it runs — it is the phase the wait is spent in, not a
  // summary of one that already finished.
  assert.equal(phases[1].message, 'preparing the pod')
})

test('a launch with no phase hook behaves exactly as before', async () => {
  const detached = deferred<void>()
  const ssh = makeSshTransport({
    async exec(cmd: string) {
      if (cmd.includes('nohup')) detached.resolve()
      return ''
    },
  })
  const { fetch } = makeFetchMock()
  const client = makeClient(makeConfig(), () => ssh, fetch)

  const { podId } = await client.launchTrainingPod({ image: 'runpod/pytorch:2.4.0', env: {}, setup: ['pip install -r'] })
  await within(detached.promise, 'the detached launch command')
  assert.equal(podId, 'pod-xyz')
  assert.equal(terminateSpy.calls.length, 0)
})

// ── the detached launch names its own arm (noema-269 gave captioning its own script; the log
// lines never followed) ─────────────────────────────────────────────────────────────────────
//
// A structured `arm` field survives grep-by-arm regardless of message wording — that is why it
// carries the selector rather than a string-switched message.

test('a captioner launch logs its own arm, not a hardcoded training-pod message', async () => {
  const detached = deferred<void>()
  const ssh = makeSshTransport({
    async exec(cmd: string) {
      if (cmd.includes('nohup')) detached.resolve()
      return ''
    },
  })
  const { fetch } = makeFetchMock()
  const client = makeClient(makeConfig(), () => ssh, fetch)

  const entries: LogEntry[] = []
  const onLog = (e: LogEntry) => { entries.push(e) }
  bus.on('log', onLog)
  try {
    await client.launchTrainingPod({ image: 'runpod/pytorch:2.4.0', env: {}, setup: [], script: 'captioner' })
    await within(detached.promise, 'the detached launch command')
  } finally {
    bus.off('log', onLog)
  }

  const locked = entries.find(e => e.msg === 'pod locked')
  const bootstrapping = entries.find(e => e.msg === 'bootstrapping pod')
  const launched = entries.find(e => e.msg === 'pod launched')
  assert.ok(locked && bootstrapping && launched, 'expected all three lifecycle log lines')
  assert.equal(locked!.arm, 'captioner')
  assert.equal(bootstrapping!.arm, 'captioner')
  assert.equal(launched!.arm, 'captioner')
  for (const e of entries) assert.doesNotMatch(String(e.msg), /training/i)
})

test('a trainer launch (the default, no script given) still logs arm "trainer"', async () => {
  const detached = deferred<void>()
  const ssh = makeSshTransport({
    async exec(cmd: string) {
      if (cmd.includes('nohup')) detached.resolve()
      return ''
    },
  })
  const { fetch } = makeFetchMock()
  const client = makeClient(makeConfig(), () => ssh, fetch)

  const entries: LogEntry[] = []
  const onLog = (e: LogEntry) => { entries.push(e) }
  bus.on('log', onLog)
  try {
    await client.launchTrainingPod({ image: 'runpod/pytorch:2.4.0', env: {}, setup: [] })
    await within(detached.promise, 'the detached launch command')
  } finally {
    bus.off('log', onLog)
  }

  const launched = entries.find(e => e.msg === 'pod launched')
  assert.equal(launched!.arm, 'trainer')
})

// ── ip-less hosts and the SSH-readiness attempt (noema-305) ────────────────────
//
// A public IP is not assigned on every host. When one is coming it is there at or shortly after
// the pod reports RUNNING, so a pod that stays RUNNING without one is an answer, not a wait — and
// waiting out `sshReadyTimeoutMs` on it spends the run's whole cold-start budget on a machine that
// will never be reachable. These pin both halves of the behaviour: the pod is abandoned at the
// ip-less window, and reaching SSH-readiness is part of an attempt, so the next attempt gets a
// fresh pod.

test('SSH_IPLESS_BAILOUT_MS clears the measured healthy-attach floor (noema-311)', () => {
  // A healthy pod probed 2026-08-25 attached its public IP at ~136s after RUNNING. The default
  // bailout must stay clear of that floor with margin, or a healthy pod gets abandoned mid-attach.
  const measuredHealthyAttachMs = 136_000
  assert.ok(
    SSH_IPLESS_BAILOUT_MS > measuredHealthyAttachMs,
    `default bailout (${SSH_IPLESS_BAILOUT_MS}ms) must clear the measured healthy attach floor (${measuredHealthyAttachMs}ms)`,
  )
  assert.ok(
    SSH_IPLESS_BAILOUT_MS >= 8 * 60 * 1000,
    `default bailout (${SSH_IPLESS_BAILOUT_MS}ms) regressed below the calibrated 8-minute floor`,
  )
})

type PodBehaviour =
  | { kind: 'healthy' }
  | { kind: 'ipless' }                              // RUNNING forever, never a publicIp
  | { kind: 'slowThenHealthy'; runningAfterCalls: number }   // STARTING for a while, then healthy

/** Fetch mock that hands out a NEW pod id per provision POST and drives each pod's status polls
 *  from its own behaviour, so a test can say "first machine is ip-less, the next one is fine".
 *  The last behaviour in the list applies to every further pod. */
function makeMultiPodFetchMock(
  behaviours: PodBehaviour[],
  opts: { webhookPayloads?: unknown[] } = {},
): { fetch: typeof fetch; calls: FetchCall[]; webhookPayloads: unknown[]; provisionCount: () => number } {
  const calls: FetchCall[] = []
  const webhookPayloads = opts.webhookPayloads ?? []
  const behaviourOf = new Map<string, PodBehaviour>()
  const statusPolls = new Map<string, number>()
  let provisioned = 0

  const fetchFn = (async (url: string, init?: RequestInit): Promise<Response> => {
    const method = (init?.method ?? 'GET').toUpperCase()
    calls.push({ url, method, body: init?.body as string | undefined })

    if (method === 'POST' && url === 'https://rest.runpod.io/v1/pods') {
      const behaviour = behaviours[Math.min(provisioned, behaviours.length - 1)]
      provisioned++
      const podId = `pod-${provisioned}`
      behaviourOf.set(podId, behaviour)
      return new Response(JSON.stringify({ id: podId }), { status: 200 })
    }

    const status = /\/v1\/pods\/(pod-\d+)$/.exec(url)
    if (method === 'GET' && status) {
      const podId = status[1]
      const polls = (statusPolls.get(podId) ?? 0) + 1
      statusPolls.set(podId, polls)
      const behaviour = behaviourOf.get(podId) ?? { kind: 'healthy' as const }
      if (behaviour.kind === 'ipless') {
        // The shape of an ip-less host: the pod is up, but no direct address ever appears.
        return new Response(JSON.stringify({ desiredStatus: 'RUNNING', portMappings: {} }), { status: 200 })
      }
      if (behaviour.kind === 'slowThenHealthy' && polls < behaviour.runningAfterCalls) {
        return new Response(JSON.stringify({ desiredStatus: 'STARTING' }), { status: 200 })
      }
      return new Response(JSON.stringify({
        desiredStatus: 'RUNNING', publicIp: '1.2.3.4', portMappings: { '22': 12345, '8080': 18080 },
      }), { status: 200 })
    }

    const runner = /^https:\/\/(pod-\d+)-8080\.proxy\.runpod\.net(\/.*)$/.exec(url)
    if (runner) {
      const routePath = runner[2]
      if (routePath === '/health') return new Response('{"status":"ready"}', { status: 200 })
      if (method === 'POST' && routePath === '/job') return new Response('{}', { status: 200 })
      if (routePath.startsWith('/job/')) return makeSseStream([{ type: 'complete' }])
    }

    if (method === 'POST') {
      webhookPayloads.push(JSON.parse((init?.body as string) ?? '{}'))
      return new Response('{}', { status: 200 })
    }
    return new Response('Not found', { status: 404 })
  }) as unknown as typeof globalThis.fetch

  return { fetch: fetchFn, calls, webhookPayloads, provisionCount: () => provisioned }
}

/** Config for the ip-less tests: a bailout window far below the overall SSH deadline, so a run
 *  that waits out the deadline instead of bailing is visibly slower than the assertions allow. */
function makeIplessConfig(overrides: Partial<SecurePodConfig> = {}): SecurePodConfig {
  return makeConfig({
    sshReadyTimeoutMs: 3000,
    sshPollIntervalMs: 5,
    sshIplessBailoutMs: 40,
    ...overrides,
  })
}

function provisionPosts(calls: FetchCall[]): FetchCall[] {
  return calls.filter(c => c.method === 'POST' && c.url === 'https://rest.runpod.io/v1/pods')
}

test('ip-less host: the pod is abandoned at the window and the job runs on a fresh pod', async () => {
  const { fetch, calls, provisionCount } = makeMultiPodFetchMock([{ kind: 'ipless' }, { kind: 'healthy' }])
  const retryPod = deferred<string>()
  const client = makeClient(makeIplessConfig(), () => makeSshTransport(), fetch)

  await client.submit({ input: {}, onPodActive: async (podId) => { retryPod.resolve(podId) } })

  // Bounded well under `sshReadyTimeoutMs`: without the ip-less window the first pod is still
  // being polled when this bound expires and no second pod exists yet.
  const second = await within(retryPod.promise, 'the fresh pod after the ip-less bailout', 1000)
  assert.equal(second, 'pod-2', 'the run moved to a freshly provisioned pod')
  await new Promise(r => setTimeout(r, 100))

  assert.equal(provisionCount(), 2, 'exactly one re-provision')
  const jobPosts = calls.filter(c => c.method === 'POST' && c.url.endsWith('/job'))
  assert.equal(jobPosts.length, 1, 'the job was submitted on the healthy pod')
  assert.ok(jobPosts[0].url.includes('pod-2'), 'submitted to the fresh pod, not the abandoned one')
  assert.ok(terminateSpy.calls.some(c => c.podId === 'pod-1'), 'the abandoned pod is not left running')
})

test('ip-less host: every attempt ip-less fails the run with the ip-less reason, and no pod is left running', async () => {
  const webhookPayloads: unknown[] = []
  const { fetch, calls } = makeMultiPodFetchMock([{ kind: 'ipless' }], { webhookPayloads })
  const client = makeClient(makeIplessConfig(), () => makeSshTransport(), fetch)

  await client.submit({ input: {}, webhook: 'https://hook.example.com/done' })
  await new Promise(r => setTimeout(r, 600))

  assert.equal(provisionPosts(calls).length, 3, 'all three attempts were spent, each on a fresh pod')
  const failed = (webhookPayloads as Array<{ status?: string; error?: string }>).find(p => p.status === 'FAILED')
  assert.ok(failed, 'expected a FAILED webhook')
  // The reason has to be distinguishable from the generic deadline, in the webhook and the log —
  // "this host never had an address" and "this pod was slow" call for different responses.
  assert.match(failed!.error ?? '', /ip-less host/)
  assert.deepEqual(terminateSpy.calls.map(c => c.podId).sort(), ['pod-1', 'pod-2', 'pod-3'])
})

test('ip-less window starts at RUNNING: a pod that is slow to boot keeps the full SSH deadline', async () => {
  // Six polls at 5ms of STARTING is far longer than the 40ms ip-less window would allow if the
  // window ran from the first not-ready poll rather than from RUNNING.
  const { fetch, calls, provisionCount } = makeMultiPodFetchMock([{ kind: 'slowThenHealthy', runningAfterCalls: 12 }])
  const client = makeClient(makeIplessConfig(), () => makeSshTransport(), fetch)

  await client.submit({ input: {} })
  await new Promise(r => setTimeout(r, 400))

  assert.equal(provisionCount(), 1, 'a slow boot is not an ip-less host — no re-provision')
  const jobPosts = calls.filter(c => c.method === 'POST' && c.url.endsWith('/job'))
  assert.equal(jobPosts.length, 1, 'the job ran on the pod once it came up')
})

test('ip-less host: no fresh pod is provisioned for an actum that has already gone terminal', async () => {
  const { fetch, calls } = makeMultiPodFetchMock([{ kind: 'ipless' }, { kind: 'healthy' }])
  const client = makeClient(makeIplessConfig(), () => makeSshTransport(), fetch, undefined, async () => false)

  await withTrace(makeTraceContext({ actumId: 'act-terminal' }), () => client.submit({ input: {} }))
  await new Promise(r => setTimeout(r, 400))

  assert.equal(provisionPosts(calls).length, 1, 'the liveness gate stops the retry before a pod is spent')
  assert.deepEqual(terminateSpy.calls.map(c => c.podId), ['pod-1'], 'the abandoned pod is still cleaned up')
})

test('provisionStudio: an ip-less pod costs one attempt, not the studio', async () => {
  const { fetch, provisionCount } = makeMultiPodFetchMock([{ kind: 'ipless' }, { kind: 'healthy' }])
  const store = makeWarmMateriaStore()
  const client = makeClient(makeIplessConfig({ keepWarm: true }), () => makeSshTransport(), fetch, store as never)

  const startedAt = Date.now()
  const res = await client.provisionStudio({ runtime: 'ComfyUI' })
  const elapsedMs = Date.now() - startedAt

  assert.ok(res, 'the studio is provisioned on the next machine')
  assert.equal(res!.podId, 'pod-2')
  // The abandoned machine costs the ip-less window, not the whole SSH deadline.
  assert.ok(elapsedMs < 3000, `the ip-less pod was waited out for the full deadline (${elapsedMs}ms)`)
  assert.equal(provisionCount(), 2)
  assert.deepEqual(terminateSpy.calls.map(c => c.podId), ['pod-1'], 'only the abandoned pod is terminated')
  assert.equal(store.createCalls.length, 1, 'the warm Materia is parked on the healthy pod')
})

// ── the detached launch and unreachable hosts (noema-308) ─────────────────────
//
// The detached launch resolves at the pod id and does the SSH wait in the background, so reaching
// SSH-readiness on the machine it was handed used to be the whole of its chance: one host that
// never became reachable ended the run. These pin the same attempt loop the gen and studio paths
// run — a fresh pod for a machine that will not answer — plus the two things that loop owes the
// rest of the system: the recorded handle follows the machine, and the failure a run ends on
// accounts for every pod it spent.

/** A transport whose `exec` settles `detached` once the nohup launch command runs — the point at
 *  which the pod owns the job and the background phase is done. */
function makeDetachedSpyTransport(detached: { resolve: (v: void) => void }): SshTransportLike & { execCalls: string[] } {
  return makeSshTransport({
    async exec(cmd: string) {
      if (cmd.includes('nohup')) detached.resolve()
      return ''
    },
  }) as SshTransportLike & { execCalls: string[] }
}

test('training launch: an ip-less host is abandoned and the job is launched on a fresh pod', async () => {
  const { fetch, calls, provisionCount } = makeMultiPodFetchMock([{ kind: 'ipless' }, { kind: 'healthy' }])
  const detached = deferred<void>()
  const execs: string[] = []
  const ssh = makeSshTransport({
    async exec(cmd: string) {
      execs.push(cmd)
      if (cmd.includes('nohup')) detached.resolve()
      return ''
    },
  })
  const stamps: string[] = []
  const failure: unknown[] = []
  const client = makeClient(makeIplessConfig(), () => ssh, fetch)

  const { podId } = await client.launchTrainingPod({
    image: 'runpod/pytorch:2.4.0', env: {}, setup: ['pip install -r'],
    onPodId: async (id) => { stamps.push(id) },
    onLaunchFailed: async (err) => { failure.push(err) },
  })
  assert.equal(podId, 'pod-1', 'the launch resolves on the pod it first acquired')

  await within(detached.promise, 'the detached launch on the fresh pod')

  assert.equal(provisionCount(), 2, 'exactly one re-provision')
  assert.deepEqual(failure, [], 'the launch did not fail')
  // The handle has to follow the machine: the reaper, the status posts and the completion webhook
  // all key off it, and the abandoned pod is gone.
  assert.deepEqual(stamps, ['pod-1', 'pod-2'], 'the recorded handle was moved to the fresh pod')
  const launch = execs.find(c => c.includes('nohup'))
  // The env is shell-quoted on its way onto the command line, so match the value, not a literal.
  assert.match(launch ?? '', /RUNPOD_POD_ID='?pod-2'?\s/, `the pod runs as pod-2, got: ${launch}`)
  assert.deepEqual(terminateSpy.calls.map(c => c.podId), ['pod-1'], 'the abandoned pod is not left running')
  assert.equal(provisionPosts(calls).length, 2)
})

test('training launch: every attempt ip-less ends on an attempts-exhausted error naming each abandoned pod', async () => {
  const { fetch, calls } = makeMultiPodFetchMock([{ kind: 'ipless' }])
  const failure = deferred<unknown>()
  const stamps: string[] = []
  const client = makeClient(makeIplessConfig(), () => makeSshTransport(), fetch)

  await client.launchTrainingPod({
    image: 'runpod/pytorch:2.4.0', env: {}, setup: ['pip install -r'],
    onPodId: async (id) => { stamps.push(id) },
    onLaunchFailed: async (err) => { failure.resolve(err) },
  })
  const err = await within(failure.promise, 'the exhausted-attempts failure', 2000) as Error

  assert.equal(provisionPosts(calls).length, 3, 'all three attempts were spent, each on a fresh pod')
  assert.match(err.message, /exhausted 3 attempts/i, 'the run ends on "the attempts ran out"')
  for (const pod of ['pod-1', 'pod-2', 'pod-3']) {
    assert.ok(err.message.includes(pod), `the terminal error must name ${pod}, got: ${err.message}`)
  }
  assert.match(err.message, /ip-less host/, 'the reason each machine was abandoned survives')
  // A single attempt's bailout promises another pod. That text is true of an attempt and false of
  // a run that has none left, so it must never be what the run terminates on.
  assert.doesNotMatch(err.message, /retrying on a fresh pod/,
    'a single-attempt bailout message must not surface as the terminal error')
  assert.deepEqual(terminateSpy.calls.map(c => c.podId).sort(), ['pod-1', 'pod-2', 'pod-3'],
    'no abandoned pod is left running')
  assert.deepEqual(stamps, ['pod-1', 'pod-2', 'pod-3'], 'each machine was recorded while it was the live one')
})

test('training launch: no fresh pod is provisioned for a run that has already gone terminal', async () => {
  const { fetch, calls } = makeMultiPodFetchMock([{ kind: 'ipless' }, { kind: 'healthy' }])
  const failure = deferred<unknown>()
  const stamps: string[] = []
  const client = makeClient(makeIplessConfig(), () => makeSshTransport(), fetch, undefined, async () => false)

  await withTrace(makeTraceContext({ actumId: 'act-terminal' }), () => client.launchTrainingPod({
    image: 'runpod/pytorch:2.4.0', env: {}, setup: ['pip install -r'],
    onPodId: async (id) => { stamps.push(id) },
    onLaunchFailed: async (err) => { failure.resolve(err) },
  }))
  const err = await within(failure.promise, 'the aborted-launch failure') as Error

  assert.equal(provisionPosts(calls).length, 1, 'the liveness gate stops the retry before a pod is spent')
  assert.match(err.message, /already terminal/i)
  assert.deepEqual(terminateSpy.calls.map(c => c.podId), ['pod-1'], 'the abandoned pod is still cleaned up')
  assert.deepEqual(stamps, ['pod-1'], 'no handle was moved to a pod that was never provisioned')
})

test('training launch: a healthy first pod is launched on directly, with no extra provision', async () => {
  const { fetch, calls, provisionCount } = makeMultiPodFetchMock([{ kind: 'healthy' }])
  const detached = deferred<void>()
  const stamps: string[] = []
  const client = makeClient(makeIplessConfig(), () => makeDetachedSpyTransport(detached), fetch)

  await client.launchTrainingPod({
    image: 'runpod/pytorch:2.4.0', env: {}, setup: ['pip install -r'],
    onPodId: async (id) => { stamps.push(id) },
  })
  await within(detached.promise, 'the detached launch command')

  assert.equal(provisionCount(), 1, 'a reachable machine costs one attempt')
  assert.deepEqual(stamps, ['pod-1'], 'the handle is stamped once')
  assert.equal(provisionPosts(calls).length, 1)
  assert.equal(terminateSpy.calls.length, 0, 'a launch that bootstrapped is not terminated')
})

// ── Substrate timeout budgets (noema-392) ─────────────────────────────────────
// `minimax-h3-fl2v` (the first fl2v run) died on `job … timed out after 900s waiting for ComfyUI`
// at executionMs 898405 — the pod, the bootstrap and 56 GB of weights all already paid for.
// comfyrunner reads JOB_TIMEOUT from its environment, and the launch line carried only
// RUNPOD_POD_ID and COMFYUI_DIR, so its 900 s default was in practice a hard platform constant.
// These pin the declaration all the way to the launch line, and the no-declaration case to a
// byte-identical one.

/** A minimally-shaped ComfyUI compiled spec — enough for `isCompiledSpec` to narrow. */
function makeSpec(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    image: { imageId: 'runpod/pytorch', imageVersion: '1.2.0', ociRef: 'runpod/pytorch:1.2.0' },
    models: [],
    genFlags: {},
    sourceTool: { id: 'minimax-h3-fl2v', versio: '1.0.0' },
    runtime: 'ComfyUI',
    workflow: { templateId: 't', templateVersion: '1', inputTemplate: {} },
    seed: 42,
    ...extra,
  }
}

function runnerLaunchLine(execCalls: string[]): string | undefined {
  return execCalls.find(c => c.includes('comfyrunner.py') && c.includes('nohup'))
}

test('substrate budgets: a declared job budget reaches the comfyrunner launch line as JOB_TIMEOUT', async () => {
  const { fetch } = makeFetchMock()
  const ssh = makeSshTransport()
  const client = makeClient(makeConfig(), () => ssh, fetch)
  await client.submit({ input: makeSpec({ jobTimeoutMs: 2_400_000, readyTimeoutMs: 900_000 }) })
  await new Promise(r => setTimeout(r, 50))

  const launch = runnerLaunchLine(ssh.execCalls)
  assert.ok(launch, 'expected a comfyrunner launch command')
  // Seconds, not ms — comfyrunner does `int(os.environ.get("JOB_TIMEOUT", "900"))` and compares
  // it against `time.time()`. Shipping 2400000 here would be a 27-day budget, not a 40-minute one.
  assert.match(launch!, /(^|\s)JOB_TIMEOUT=2400(\s|$)/, 'JOB_TIMEOUT must travel, in seconds')
  assert.match(launch!, /(^|\s)COMFY_READY_TIMEOUT=900(\s|$)/, 'COMFY_READY_TIMEOUT must travel too')
  // Without this the pod-side message says "timed out after 2400s" and nothing about whose
  // budget that was (noema-390).
  assert.match(launch!, /SUBSTRATE_REF=/, 'the launch line must name the substrate')
  // And the two that always travelled still do.
  assert.match(launch!, /RUNPOD_POD_ID=/)
  assert.match(launch!, /COMFYUI_DIR=\/root\/ComfyUI/)
})

test('substrate budgets: the readiness budget reaches BOTH ends of the same wait', async () => {
  // comfyrunner does not serve /health at all until ComfyUI answers, and `sys.exit(1)`s when its
  // own COMFY_READY_TIMEOUT lapses. Lengthening only Crystal's poll would buy a longer wait on a
  // process that had already quit — so the declaration has to reach the pod as well.
  const { fetch } = makeFetchMock()
  const ssh = makeSshTransport()
  const client = makeClient(makeConfig(), () => ssh, fetch)
  await client.submit({ input: makeSpec({ readyTimeoutMs: 900_000 }) })
  await new Promise(r => setTimeout(r, 50))

  const launch = runnerLaunchLine(ssh.execCalls)
  assert.match(launch!, /COMFY_READY_TIMEOUT=900/, 'the pod half of the readiness budget')
  assert.doesNotMatch(launch!, /JOB_TIMEOUT=/, 'declaring one budget must not synthesise the other')
})

test('substrate budgets: a spec declaring none leaves the launch line exactly as it was', async () => {
  const { fetch } = makeFetchMock()
  const ssh = makeSshTransport()
  const client = makeClient(makeConfig(), () => ssh, fetch)
  await client.submit({ input: makeSpec() })
  await new Promise(r => setTimeout(r, 50))

  const launch = runnerLaunchLine(ssh.execCalls)
  assert.ok(launch, 'expected a comfyrunner launch command')
  assert.doesNotMatch(launch!, /JOB_TIMEOUT=/, 'no JOB_TIMEOUT when the substrate declares none')
  assert.doesNotMatch(launch!, /COMFY_READY_TIMEOUT=/, 'no COMFY_READY_TIMEOUT either')
  // The pod-side defaults (900 s / 300 s) are what every existing substrate has always run on.
  // This is the regression guard for that: the env prefix is the historical one, unchanged
  // apart from SUBSTRATE_REF, which is diagnostic and carries no budget.
  assert.match(launch!, /^RUNPOD_POD_ID=pod-xyz COMFYUI_DIR=\/root\/ComfyUI SUBSTRATE_REF=/,
    'the historical launch prefix is preserved')
})

test('substrate budgets: a raw (non-compiled) input carries no budgets and no substrate ref', async () => {
  const { fetch } = makeFetchMock()
  const ssh = makeSshTransport()
  const client = makeClient(makeConfig(), () => ssh, fetch)
  await client.submit({ input: {} })            // a bare workflow, the legacy caller shape
  await new Promise(r => setTimeout(r, 50))

  const launch = runnerLaunchLine(ssh.execCalls)
  assert.equal(launch, 'RUNPOD_POD_ID=pod-xyz COMFYUI_DIR=/root/ComfyUI nohup python3 /root/comfyrunner.py >> /tmp/comfyrunner.log 2>&1 &',
    'a caller with no compiled envelope gets byte-identical the command it always got')
})

test('substrate budgets: the readiness timeout error names the budget, its source and the substrate', async () => {
  // The old message was "comfyrunner did not become ready within timeout" — no number, no
  // substrate, so the next occurrence starts its investigation from zero (noema-390).
  const { fetch, webhookPayloads } = makeFetchMock('pod-slowboot', { runnerHealthStatus: 'starting' })
  const client = makeClient(
    makeConfig({ comfyReadyTimeoutMs: 40, comfyPollIntervalMs: 0 }),
    () => makeSshTransport(),
    fetch,
  )
  await client.submit({ input: makeSpec(), webhook: 'https://hook.example.com/done' })
  await new Promise(r => setTimeout(r, 300))

  const failed = (webhookPayloads as Array<{ status?: string; error?: string }>).find(p => p.status === 'FAILED')
  assert.ok(failed, 'expected a FAILED webhook')
  assert.match(failed!.error ?? '', /did not become ready within \d+ms/, 'the budget, as a number with its unit')
  assert.match(failed!.error ?? '', /platform default budget/, 'and where that number came from')
  assert.match(failed!.error ?? '', /substrate runpod\/pytorch:1\.2\.0/, 'and whose it was')
})

test('substrate budgets: a declared readiness budget only ever lengthens the poll, never shortens it', async () => {
  // A test injects a tiny comfyReadyTimeoutMs to make the give-up path fast. A substrate
  // declaring 15 minutes must not turn that into a 15-minute test — and equally, a substrate
  // declaring 10 seconds must not shorten a production budget of 5 minutes. Both directions are
  // the same rule: honour the declaration only when it is LONGER.
  const { fetch, webhookPayloads } = makeFetchMock('pod-shortdecl', { runnerHealthStatus: 'starting' })
  const client = makeClient(
    makeConfig({ comfyReadyTimeoutMs: 40, comfyPollIntervalMs: 0 }),
    () => makeSshTransport(),
    fetch,
  )
  const started = Date.now()
  await client.submit({ input: makeSpec({ readyTimeoutMs: 5 }), webhook: 'https://hook.example.com/done' })
  await new Promise(r => setTimeout(r, 300))

  const failed = (webhookPayloads as Array<{ status?: string; error?: string }>).find(p => p.status === 'FAILED')
  assert.ok(failed, 'expected a FAILED webhook')
  assert.match(failed!.error ?? '', /platform default budget/,
    'a shorter declaration must not displace the configured budget')
  assert.ok(Date.now() - started < 5_000, 'and the give-up path stays fast')
})

test('substrate budgets: a LONGER declared readiness budget keeps polling past the configured one', async () => {
  // The half that matters in production: the H3 pod that reached ready in ~26s on one run and
  // missed the 5-minute default on the next. The declaration has to actually extend the poll,
  // not merely be carried. Health stays 'starting' well past the configured budget and only then
  // flips — with the declaration ignored this run fails; with it honoured it completes.
  const podId = 'pod-latereadu'
  const runnerBase = `https://${podId}-8080.proxy.runpod.net`
  let healthCalls = 0
  const fetchFn = (async (url: string, init?: RequestInit): Promise<Response> => {
    const method = (init?.method ?? 'GET').toUpperCase()
    if (method === 'POST' && url.includes('rest.runpod.io') && !url.includes(podId)) {
      return new Response(JSON.stringify({ id: podId }), { status: 200 })
    }
    if (method === 'GET' && url.includes(`/pods/${podId}`)) {
      return new Response(JSON.stringify({
        desiredStatus: 'RUNNING', publicIp: '1.2.3.4', portMappings: { '22': 12345, '8080': 18080 },
      }), { status: 200 })
    }
    if (method === 'GET' && url === `${runnerBase}/health`) {
      healthCalls++
      // 'starting' for the first ~150ms of polling — past the 20ms configured budget, inside
      // the 3000ms declared one.
      return new Response(JSON.stringify({ status: healthCalls > 15 ? 'ready' : 'starting' }), { status: 200 })
    }
    if (method === 'GET' && url.startsWith(`${runnerBase}/job/`)) return makeSseStream([{ type: 'complete' }])
    return new Response('{}', { status: 200 })
  }) as unknown as typeof globalThis.fetch

  const client = makeClient(
    makeConfig({ comfyReadyTimeoutMs: 20, comfyPollIntervalMs: 10 }),
    () => makeSshTransport(),
    fetchFn,
  )
  await client.submit({ input: makeSpec({ readyTimeoutMs: 3000 }), webhook: 'https://hook.example.com/done' })
  await new Promise(r => setTimeout(r, 600))

  assert.ok(healthCalls > 15, `expected polling to outlast the 20ms configured budget, got ${healthCalls} polls`)
  assert.equal(terminateSpy.calls.length, 1, 'the pod is terminated once, after a job that RAN')
})
