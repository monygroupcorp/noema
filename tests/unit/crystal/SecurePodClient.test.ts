import { test } from 'node:test'
import assert from 'node:assert/strict'
import { SecurePodClient } from '../../../src/crystal/SecurePodClient.js'
import type { SecurePodConfig, SshTransportLike } from '../../../src/crystal/SecurePodClient.js'

// ── Helpers ───────────────────────────────────────────────────────────────────

function makePodApiMock(podId = 'pod-xyz', sshReadyAfterCalls = 1) {
  let provisionCalls = 0
  let statusCalls = 0
  let terminateCalls = 0
  const webhookPayloads: unknown[] = []

  const podApi = async (url: string, opts: RequestInit = {}): Promise<Response> => {
    const method = (opts.method ?? 'GET').toUpperCase()

    if (method === 'POST' && url.includes('/pods') && !url.includes(podId)) {
      provisionCalls++
      return new Response(JSON.stringify({ id: podId }), { status: 200 })
    }

    if (method === 'GET' && url.includes(`/pods/${podId}`)) {
      statusCalls++
      if (statusCalls >= sshReadyAfterCalls) {
        return new Response(JSON.stringify({
          desiredStatus: 'RUNNING',
          runtime: {
            ports: [
              { ip: '1.2.3.4', privatePort: 22, publicPort: 12345, type: 'tcp' },
              { ip: '1.2.3.4', privatePort: 8188, publicPort: 18188, type: 'http' },
            ],
          },
        }), { status: 200 })
      }
      return new Response(JSON.stringify({ desiredStatus: 'STARTING' }), { status: 200 })
    }

    if (method === 'DELETE' && url.includes(`/pods/${podId}`)) {
      terminateCalls++
      return new Response('{}', { status: 200 })
    }

    // Webhook POST
    if (method === 'POST') {
      webhookPayloads.push(JSON.parse((opts.body as string) ?? '{}'))
      return new Response('{}', { status: 200 })
    }

    return new Response('Not found', { status: 404 })
  }

  return { podApi, provisionCalls: () => provisionCalls, statusCalls: () => statusCalls, terminateCalls: () => terminateCalls, webhookPayloads }
}

function makeSshTransport(overrides: Partial<SshTransportLike> = {}): SshTransportLike {
  let execCalls: string[] = []
  return {
    execCalls,
    async exec(cmd: string) {
      execCalls.push(cmd)
      if (cmd.includes('/system_stats')) return '{"system":{}}'
      if (cmd.includes('/prompt')) return JSON.stringify({ prompt_id: 'P1' })
      if (cmd.includes('/history')) return JSON.stringify({
        P1: { outputs: { '9': { images: [{ filename: 'render_001.png', subfolder: '', type: 'output' }] } } }
      })
      return ''
    },
    async close() {},
    ...overrides,
  } as SshTransportLike & { execCalls: string[] }
}

function makeConfig(overrides: Partial<SecurePodConfig> = {}): SecurePodConfig {
  return {
    apiKey: 'test-key',
    sshKeyPath: '/tmp/test-key',
    gpuTypeIds: ['NVIDIA GeForce RTX 4090'],
    imageName: 'runpod/pytorch:2.4.0',
    cloudType: 'SECURE',
    // Fast timeouts so background jobs fail quickly in tests
    sshReadyTimeoutMs: 200,
    sshPollIntervalMs: 0,
    comfyReadyTimeoutMs: 50,
    comfyPollIntervalMs: 0,
    jobTimeoutMs: 500,
    ...overrides,
  }
}

// ── submit() — provisioning ───────────────────────────────────────────────────

test('submit() provisions a SECURE pod via RunPod REST API', async () => {
  const mock = makePodApiMock()
  const client = new SecurePodClient(makeConfig(), () => makeSshTransport(), mock.podApi)
  await client.submit({ input: { '1': {} }, webhook: 'https://example.com/hook' })
  assert.equal(mock.provisionCalls(), 1)
})

test('submit() returns the pod ID as externusJobId immediately', async () => {
  const mock = makePodApiMock('pod-abc-123')
  const client = new SecurePodClient(makeConfig(), () => makeSshTransport(), mock.podApi)
  const result = await client.submit({ input: {}, webhook: 'https://example.com/hook' })
  assert.equal(result.id, 'pod-abc-123')
})

test('submit() throws when RunPod pod API returns an error', async () => {
  const failFetch = async (_url: string, _opts?: RequestInit): Promise<Response> =>
    new Response('{"error":"no capacity"}', { status: 500 })
  const client = new SecurePodClient(makeConfig(), () => makeSshTransport(), failFetch)
  await assert.rejects(
    () => client.submit({ input: {} }),
    /pod provision failed/i
  )
})

test('submit() provisions with SECURE cloudType by default', async () => {
  let body: unknown
  const captureFetch = async (url: string, opts: RequestInit = {}): Promise<Response> => {
    if ((opts.method ?? 'GET').toUpperCase() === 'POST' && url.includes('/pods')) {
      body = JSON.parse(opts.body as string)
      return new Response(JSON.stringify({ id: 'pod-1' }), { status: 200 })
    }
    return new Response(JSON.stringify({ desiredStatus: 'RUNNING', runtime: { ports: [{ ip: '1.2.3.4', privatePort: 22, publicPort: 22, type: 'tcp' }] } }), { status: 200 })
  }
  const client = new SecurePodClient(makeConfig({ cloudType: undefined }), () => makeSshTransport(), captureFetch)
  await client.submit({ input: {} })
  assert.equal((body as { cloudType: string }).cloudType, 'SECURE')
})

// ── background job — webhook POSTed on completion ─────────────────────────────

test('background job POSTs COMPLETED webhook after workflow finishes', async () => {
  const mock = makePodApiMock()
  const client = new SecurePodClient(makeConfig(), () => makeSshTransport(), mock.podApi)
  await client.submit({ input: { '1': {} }, webhook: 'https://hook.example.com/done' })
  // Allow microtasks + background job to complete
  await new Promise(r => setTimeout(r, 50))
  const webhooks = mock.webhookPayloads.filter(p => (p as { status?: string }).status === 'COMPLETED')
  assert.equal(webhooks.length, 1)
})

test('background job webhook payload includes pod ID as id field', async () => {
  const mock = makePodApiMock('pod-id-123')
  const client = new SecurePodClient(makeConfig(), () => makeSshTransport(), mock.podApi)
  await client.submit({ input: {}, webhook: 'https://hook.example.com/done' })
  await new Promise(r => setTimeout(r, 50))
  const webhook = mock.webhookPayloads.find(p => (p as { status?: string }).status === 'COMPLETED') as { id?: string }
  assert.equal(webhook?.id, 'pod-id-123')
})

test('background job terminates pod after completion', async () => {
  const mock = makePodApiMock()
  const client = new SecurePodClient(makeConfig(), () => makeSshTransport(), mock.podApi)
  await client.submit({ input: {}, webhook: 'https://hook.example.com/done' })
  await new Promise(r => setTimeout(r, 50))
  assert.ok(mock.terminateCalls() >= 1)
})

test('background job POSTs FAILED webhook when SSH run throws', async () => {
  const brokenSsh = makeSshTransport({
    async exec(_cmd: string) { throw new Error('SSH connection refused') },
  })
  const mock = makePodApiMock()
  const client = new SecurePodClient(makeConfig(), () => brokenSsh, mock.podApi)
  await client.submit({ input: {}, webhook: 'https://hook.example.com/done' })
  // comfyReadyTimeoutMs=50, then FAILED webhook fires — allow 500ms for safety
  await new Promise(r => setTimeout(r, 500))
  const failed = mock.webhookPayloads.find(p => (p as { status?: string }).status === 'FAILED')
  assert.ok(failed, 'FAILED webhook should be POSTed on SSH error')
})

test('background job terminates pod even on SSH error', async () => {
  const brokenSsh = makeSshTransport({
    async exec(_cmd: string) { throw new Error('oops') },
  })
  const mock = makePodApiMock()
  const client = new SecurePodClient(makeConfig(), () => brokenSsh, mock.podApi)
  await client.submit({ input: {}, webhook: 'https://hook.example.com/done' })
  await new Promise(r => setTimeout(r, 500))
  assert.ok(mock.terminateCalls() >= 1)
})

test('submit() without webhook does not throw when background job completes', async () => {
  const mock = makePodApiMock()
  const client = new SecurePodClient(makeConfig(), () => makeSshTransport(), mock.podApi)
  const result = await client.submit({ input: {} })
  assert.ok(result.id)
  await new Promise(r => setTimeout(r, 50))
})

// ── keep-warm mode ────────────────────────────────────────────────────────────

function makeMateriaStore() {
  const createCalls: unknown[] = []
  return {
    createCalls,
    async create(input: unknown) { createCalls.push(input); return { ...input as object, id: 'mat-new' } },
    async findById(_id: string) { return null },
    async update(_id: string, _patch: unknown) { return null as never },
    async findWarm(_spec: unknown) { return null },
  }
}

test('keepWarm: registers Materia as idle after job completes', async () => {
  const mock = makePodApiMock()
  const store = makeMateriaStore()
  const client = new SecurePodClient(makeConfig({ keepWarm: true }), () => makeSshTransport(), mock.podApi, store)
  await client.submit({ input: {} })
  await new Promise(r => setTimeout(r, 50))
  assert.equal(store.createCalls.length, 1)
  assert.equal((store.createCalls[0] as { status: string }).status, 'idle')
})

test('keepWarm: does NOT terminate pod after successful job', async () => {
  const mock = makePodApiMock()
  const store = makeMateriaStore()
  const client = new SecurePodClient(makeConfig({ keepWarm: true }), () => makeSshTransport(), mock.podApi, store)
  await client.submit({ input: {} })
  await new Promise(r => setTimeout(r, 50))
  assert.equal(mock.terminateCalls(), 0)
})

test('keepWarm: registered Materia has imageRef matching config.imageName', async () => {
  const mock = makePodApiMock()
  const store = makeMateriaStore()
  const client = new SecurePodClient(makeConfig({ keepWarm: true, imageName: 'test/image:v2' }), () => makeSshTransport(), mock.podApi, store)
  await client.submit({ input: {} })
  await new Promise(r => setTimeout(r, 50))
  assert.equal((store.createCalls[0] as { imageRef: string }).imageRef, 'test/image:v2')
})

test('keepWarm: registered Materia has sshHost and sshPort from pod runtime', async () => {
  const mock = makePodApiMock()
  const store = makeMateriaStore()
  const client = new SecurePodClient(makeConfig({ keepWarm: true }), () => makeSshTransport(), mock.podApi, store)
  await client.submit({ input: {} })
  await new Promise(r => setTimeout(r, 50))
  const created = store.createCalls[0] as { sshHost: string; sshPort: number }
  assert.equal(created.sshHost, '1.2.3.4')
  assert.equal(created.sshPort, 12345)
})

test('keepWarm: registered Materia has externusId matching the pod ID', async () => {
  const mock = makePodApiMock('pod-warm-123')
  const store = makeMateriaStore()
  const client = new SecurePodClient(makeConfig({ keepWarm: true }), () => makeSshTransport(), mock.podApi, store)
  await client.submit({ input: {} })
  await new Promise(r => setTimeout(r, 50))
  assert.equal((store.createCalls[0] as { externusId: string }).externusId, 'pod-warm-123')
})

test('background job terminates pod when SSH readiness times out', async () => {
  // sshReadyAfterCalls=9999 — pod never becomes SSH-ready within the short timeout
  const mock = makePodApiMock('pod-ssh-timeout', 9999)
  const client = new SecurePodClient(
    makeConfig({ sshReadyTimeoutMs: 50, sshPollIntervalMs: 10 }),
    () => makeSshTransport(),
    mock.podApi,
  )
  await client.submit({ input: {}, webhook: 'https://hook.example.com/done' })
  await new Promise(r => setTimeout(r, 300))
  assert.ok(mock.terminateCalls() >= 1, 'pod must be terminated even when SSH never becomes ready')
})

// ── fetch timeouts ────────────────────────────────────────────────────────────

function makeHangingFetch(podId = 'pod-hang') {
  const webhookPayloads: unknown[] = []
  const terminateCalls = { count: 0 }

  const fetch = async (url: string, opts: RequestInit = {}): Promise<Response> => {
    const method = (opts.method ?? 'GET').toUpperCase()

    // Provision POST succeeds immediately
    if (method === 'POST' && url.includes('/pods') && !url.includes(podId)) {
      return new Response(JSON.stringify({ id: podId }), { status: 200 })
    }

    // Status GET hangs — aborts when signal fires
    if (method === 'GET' && url.includes(`/pods/${podId}`)) {
      return new Promise((_resolve, reject) => {
        opts.signal?.addEventListener('abort', () =>
          reject(Object.assign(new Error('The operation was aborted'), { name: 'AbortError' })))
      })
    }

    // DELETE — termination
    if (method === 'DELETE' && url.includes(`/pods/${podId}`)) {
      terminateCalls.count++
      return new Response('{}', { status: 200 })
    }

    // Webhook POST
    if (method === 'POST') {
      webhookPayloads.push(JSON.parse((opts.body as string) ?? '{}'))
      return new Response('{}', { status: 200 })
    }

    return new Response('Not found', { status: 404 })
  }

  return { fetch, webhookPayloads, terminateCalls }
}

test('submit() rejects when pod provision fetch hangs past provisionTimeoutMs', async () => {
  const hangFetch = async (_url: string, opts: RequestInit = {}): Promise<Response> =>
    new Promise((_resolve, reject) => {
      opts.signal?.addEventListener('abort', () =>
        reject(Object.assign(new Error('Aborted'), { name: 'AbortError' })))
    })

  const client = new SecurePodClient(
    makeConfig({ provisionTimeoutMs: 50 }),
    () => makeSshTransport(),
    hangFetch,
  )
  await assert.rejects(() => client.submit({ input: {} }))
})

test('background job fires FAILED webhook when SSH status poll hangs past sshInfoTimeoutMs', async () => {
  const hang = makeHangingFetch('pod-hang-ssh')
  const client = new SecurePodClient(
    makeConfig({ sshInfoTimeoutMs: 30, sshReadyTimeoutMs: 100, sshPollIntervalMs: 0 }),
    () => makeSshTransport(),
    hang.fetch,
  )
  await client.submit({ input: {}, webhook: 'https://hook.example.com/done' })
  await new Promise(r => setTimeout(r, 500))
  const failed = hang.webhookPayloads.find(p => (p as { status?: string }).status === 'FAILED')
  assert.ok(failed, 'FAILED webhook should fire after SSH poll hangs past timeout')
})

test('SSH status poll timeout terminates the pod', async () => {
  const hang = makeHangingFetch('pod-hang-term')
  const client = new SecurePodClient(
    makeConfig({ sshInfoTimeoutMs: 30, sshReadyTimeoutMs: 100, sshPollIntervalMs: 0 }),
    () => makeSshTransport(),
    hang.fetch,
  )
  await client.submit({ input: {} })
  await new Promise(r => setTimeout(r, 500))
  assert.ok(hang.terminateCalls.count >= 1, 'pod must be terminated when SSH polls hang')
})

// ── COMPLETED webhook retries ─────────────────────────────────────────────────

function makeReadyPodFetch(podId: string, webhookHandler: (body: unknown) => Response) {
  return async (url: string, opts: RequestInit = {}): Promise<Response> => {
    const method = (opts.method ?? 'GET').toUpperCase()
    if (method === 'POST' && url.includes('/pods') && !url.includes(podId)) {
      return new Response(JSON.stringify({ id: podId }), { status: 200 })
    }
    if (method === 'GET' && url.includes(`/pods/${podId}`)) {
      return new Response(JSON.stringify({
        desiredStatus: 'RUNNING',
        runtime: { ports: [
          { ip: '1.2.3.4', privatePort: 22, publicPort: 12345, type: 'tcp' },
          { ip: '1.2.3.4', privatePort: 8188, publicPort: 18188, type: 'http' },
        ] },
      }), { status: 200 })
    }
    if (method === 'DELETE') return new Response('{}', { status: 200 })
    if (method === 'POST') return webhookHandler(JSON.parse((opts.body as string) ?? '{}'))
    return new Response('Not found', { status: 404 })
  }
}

test('COMPLETED webhook fires on second attempt after transient failure', async () => {
  const podId = 'pod-retry-ok'
  let webhookCalls = 0
  const captured: unknown[] = []

  const fetch = makeReadyPodFetch(podId, (body) => {
    webhookCalls++
    if ((body as { status?: string }).status === 'COMPLETED' && webhookCalls === 1) {
      return new Response('Service unavailable', { status: 503 })
    }
    captured.push(body)
    return new Response('{}', { status: 200 })
  })

  const client = new SecurePodClient(
    makeConfig({ webhookRetries: 2, webhookRetryDelayMs: 0 }),
    () => makeSshTransport(),
    fetch,
  )
  await client.submit({ input: {}, webhook: 'https://hook.example.com/done' })
  await new Promise(r => setTimeout(r, 100))

  const completed = captured.find(p => (p as { status?: string }).status === 'COMPLETED')
  assert.ok(completed, 'COMPLETED webhook should fire after retry')
  assert.equal(webhookCalls, 2, 'should have attempted the webhook twice')
})

test('fires FAILED webhook when all COMPLETED webhook retries are exhausted', async () => {
  const podId = 'pod-retry-fail'
  const captured: unknown[] = []

  const fetch = makeReadyPodFetch(podId, (body) => {
    const status = (body as { status?: string }).status
    if (status === 'COMPLETED') return new Response('Server error', { status: 500 })
    captured.push(body)
    return new Response('{}', { status: 200 })
  })

  const client = new SecurePodClient(
    makeConfig({ webhookRetries: 1, webhookRetryDelayMs: 0 }),
    () => makeSshTransport(),
    fetch,
  )
  await client.submit({ input: {}, webhook: 'https://hook.example.com/done' })
  await new Promise(r => setTimeout(r, 200))

  const failed = captured.find(p => (p as { status?: string }).status === 'FAILED')
  assert.ok(failed, 'FAILED webhook should fire after all COMPLETED retries are exhausted')
})

test('pod is terminated even when all COMPLETED webhook retries fail', async () => {
  const podId = 'pod-retry-term'
  let terminateCalls = 0

  const fetch = async (url: string, opts: RequestInit = {}): Promise<Response> => {
    const method = (opts.method ?? 'GET').toUpperCase()
    if (method === 'POST' && url.includes('/pods') && !url.includes(podId)) {
      return new Response(JSON.stringify({ id: podId }), { status: 200 })
    }
    if (method === 'GET' && url.includes(`/pods/${podId}`)) {
      return new Response(JSON.stringify({
        desiredStatus: 'RUNNING',
        runtime: { ports: [
          { ip: '1.2.3.4', privatePort: 22, publicPort: 12345, type: 'tcp' },
          { ip: '1.2.3.4', privatePort: 8188, publicPort: 18188, type: 'http' },
        ] },
      }), { status: 200 })
    }
    if (method === 'DELETE' && url.includes(podId)) { terminateCalls++; return new Response('{}', { status: 200 }) }
    // All webhook POSTs fail
    if (method === 'POST') return new Response('err', { status: 500 })
    return new Response('Not found', { status: 404 })
  }

  const client = new SecurePodClient(
    makeConfig({ webhookRetries: 1, webhookRetryDelayMs: 0 }),
    () => makeSshTransport(),
    fetch,
  )
  await client.submit({ input: {} })
  await new Promise(r => setTimeout(r, 200))
  assert.ok(terminateCalls >= 1, 'pod must be terminated even when webhook retries all fail')
})

test('keepWarm: terminates pod on job failure, does NOT register Materia', async () => {
  const brokenSsh = makeSshTransport({
    async exec(_cmd: string) { throw new Error('SSH connection refused') },
  })
  const mock = makePodApiMock()
  const store = makeMateriaStore()
  const client = new SecurePodClient(makeConfig({ keepWarm: true }), () => brokenSsh, mock.podApi, store)
  await client.submit({ input: {} })
  await new Promise(r => setTimeout(r, 500))
  assert.ok(mock.terminateCalls() >= 1)
  assert.equal(store.createCalls.length, 0)
})
