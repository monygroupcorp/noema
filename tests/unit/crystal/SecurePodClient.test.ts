import { describe, it, expect, vi, beforeEach } from 'vitest'
import { SecurePodClient } from '../../../src/crystal/SecurePodClient.js'
import type { SecurePodConfig, SshTransportLike } from '../../../src/crystal/SecurePodClient.js'

vi.mock('../../../src/crystal/terminatePod.js', () => ({
  terminatePod: vi.fn().mockResolvedValue(undefined),
  listRunPodPods: vi.fn().mockResolvedValue([]),
}))

import { terminatePod as _terminatePod } from '../../../src/crystal/terminatePod.js'
const terminatePodMock = _terminatePod as ReturnType<typeof vi.fn>

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

function makeSshTransport(overrides: Partial<SshTransportLike> = {}): SshTransportLike & { execCalls: string[]; closeCalled: boolean } {
  const execCalls: string[] = []
  let closeCalled = false
  return {
    execCalls,
    get closeCalled() { return closeCalled },
    async exec(cmd: string) { execCalls.push(cmd); return '' },
    async close() { closeCalled = true },
    ...overrides,
  } as SshTransportLike & { execCalls: string[]; closeCalled: boolean }
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

/**
 * Full mock fetch for the SecurePodClient flow:
 *   POST /pods          → provision
 *   GET  /pods/:id      → SSH-ready status
 *   DELETE /pods/:id    → terminate
 *   GET  <runner>/health → {status:'ready'}
 *   POST <runner>/job    → 200
 *   GET  <runner>/job/:jobId/stream → SSE stream
 *   POST <webhook>       → capture
 */
function makeFetchMock(podId = 'pod-xyz', opts: {
  sshReadyAfterCalls?: number
  runnerHealthStatus?: string
  sseEvents?: Array<Record<string, unknown>>
  webhookPayloads?: unknown[]
} = {}) {
  const {
    sshReadyAfterCalls = 1,
    runnerHealthStatus = 'ready',
    sseEvents = [{ type: 'complete' }],
    webhookPayloads = [],
  } = opts

  let statusCalls = 0
  const runnerBase = `https://${podId}-8080.proxy.runpod.net`

  const fetch = vi.fn(async (url: string, init?: RequestInit): Promise<Response> => {
    const method = (init?.method ?? 'GET').toUpperCase()

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

  return { fetch, webhookPayloads }
}

beforeEach(() => terminatePodMock.mockClear())

// ── provisioning ──────────────────────────────────────────────────────────────

describe('submit() provisioning', () => {
  it('provisions a SECURE pod via RunPod REST API', async () => {
    const { fetch } = makeFetchMock()
    const client = new SecurePodClient(makeConfig(), () => makeSshTransport(), fetch)
    await client.submit({ input: {} })
    const provision = (fetch as ReturnType<typeof vi.fn>).mock.calls.find(
      ([url, opts]) => (opts?.method ?? 'GET').toUpperCase() === 'POST' && (url as string).includes('rest.runpod.io'),
    )
    expect(provision).toBeDefined()
  })

  it('returns pod ID immediately', async () => {
    const { fetch } = makeFetchMock('pod-abc')
    const client = new SecurePodClient(makeConfig(), () => makeSshTransport(), fetch)
    const result = await client.submit({ input: {} })
    expect(result.id).toBe('pod-abc')
  })

  it('throws when RunPod returns an error', async () => {
    const failFetch = vi.fn(async () =>
      new Response('{"error":"no capacity"}', { status: 500 }),
    ) as unknown as typeof fetch
    const client = new SecurePodClient(makeConfig(), () => makeSshTransport(), failFetch)
    await expect(client.submit({ input: {} })).rejects.toThrow(/pod provision failed/i)
  })

  it('provisions with SECURE cloudType by default', async () => {
    let provisionBody: unknown
    const fetchFn = vi.fn(async (url: string, opts?: RequestInit): Promise<Response> => {
      if ((opts?.method ?? 'GET').toUpperCase() === 'POST' && (url as string).includes('rest.runpod.io')) {
        provisionBody = JSON.parse(opts?.body as string)
        return new Response(JSON.stringify({ id: 'pod-1' }), { status: 200 })
      }
      if ((url as string).includes('/pods/pod-1')) {
        return new Response(JSON.stringify({
          desiredStatus: 'RUNNING', publicIp: '1.2.3.4', portMappings: { '22': 22, '8080': 8080 },
        }), { status: 200 })
      }
      if ((url as string).includes('health')) return new Response('{"status":"ready"}', { status: 200 })
      if ((opts?.method ?? 'GET').toUpperCase() === 'POST') return new Response('{}', { status: 200 })
      if ((url as string).includes('/job/')) return makeSseStream([{ type: 'complete' }])
      if ((opts?.method ?? 'GET').toUpperCase() === 'DELETE') return new Response('{}', { status: 200 })
      return new Response('{}', { status: 200 })
    }) as unknown as typeof fetch

    const client = new SecurePodClient(makeConfig({ cloudType: undefined }), () => makeSshTransport(), fetchFn)
    await client.submit({ input: {} })
    expect((provisionBody as { cloudType: string }).cloudType).toBe('SECURE')
  })
})

// ── SSH bootstrap ─────────────────────────────────────────────────────────────

describe('SSH bootstrap', () => {
  it('closes SSH after bootstrap completes', async () => {
    const { fetch } = makeFetchMock()
    const ssh = makeSshTransport()
    const client = new SecurePodClient(makeConfig(), () => ssh, fetch)
    await client.submit({ input: {} })
    await new Promise(r => setTimeout(r, 50))
    expect(ssh.closeCalled).toBe(true)
  })

  it('runs bootstrap exec commands before submitting to comfyrunner', async () => {
    const { fetch } = makeFetchMock()
    const ssh = makeSshTransport()
    const client = new SecurePodClient(makeConfig(), () => ssh, fetch)
    await client.submit({ input: {} })
    await new Promise(r => setTimeout(r, 50))
    expect(ssh.execCalls.length).toBeGreaterThan(0)
    expect(ssh.execCalls.some(c => c.includes('git'))).toBe(true)
  })

  it('terminates pod and fires FAILED webhook when bootstrap SSH throws', async () => {
    const brokenSsh = makeSshTransport({ async exec(cmd) { if (cmd === 'true') return ''; throw new Error('ECONNREFUSED') } })
    const webhookPayloads: unknown[] = []
    const { fetch } = makeFetchMock('pod-fail', { webhookPayloads })
    const client = new SecurePodClient(makeConfig(), () => brokenSsh, fetch)
    await client.submit({ input: {}, webhook: 'https://hook.example.com/done' })
    await new Promise(r => setTimeout(r, 300))
    expect(terminatePodMock).toHaveBeenCalled()
    const failed = (webhookPayloads as Array<{ status?: string }>).find(p => p.status === 'FAILED')
    expect(failed).toBeDefined()
  })

  it('does NOT fire FAILED webhook after comfyrunner accepts the job', async () => {
    // comfyrunner accepts job but stream returns an error — comfyrunner owns the webhook
    const webhookPayloads: unknown[] = []
    const { fetch } = makeFetchMock('pod-accepted', {
      webhookPayloads,
      sseEvents: [{ type: 'error', error: 'OOM' }],
    })
    const client = new SecurePodClient(makeConfig(), () => makeSshTransport(), fetch)
    await client.submit({ input: {}, webhook: 'https://hook.example.com/done' })
    await new Promise(r => setTimeout(r, 300))
    expect((webhookPayloads as Array<{ status?: string }>).some(p => p.status === 'FAILED')).toBe(false)
  })
})

// ── pod lifecycle ─────────────────────────────────────────────────────────────

describe('pod lifecycle', () => {
  it('terminates pod after job completes', async () => {
    const { fetch } = makeFetchMock('pod-term')
    const client = new SecurePodClient(makeConfig(), () => makeSshTransport(), fetch)
    await client.submit({ input: {} })
    await new Promise(r => setTimeout(r, 100))
    expect(terminatePodMock).toHaveBeenCalledWith('test-key', 'pod-term')
  })

  it('terminates pod even when SSH never becomes ready', async () => {
    const { fetch } = makeFetchMock('pod-ssh-timeout', { sshReadyAfterCalls: 9999 })
    const client = new SecurePodClient(
      makeConfig({ sshReadyTimeoutMs: 50, sshPollIntervalMs: 10 }),
      () => makeSshTransport(),
      fetch,
    )
    await client.submit({ input: {}, webhook: 'https://hook.example.com/done' })
    await new Promise(r => setTimeout(r, 300))
    expect(terminatePodMock).toHaveBeenCalled()
  })

  it('terminates pod when comfyrunner never becomes ready', async () => {
    const { fetch } = makeFetchMock('pod-norunner', { runnerHealthStatus: 'starting' })
    const client = new SecurePodClient(
      makeConfig({ comfyReadyTimeoutMs: 50, comfyPollIntervalMs: 0 }),
      () => makeSshTransport(),
      fetch,
    )
    await client.submit({ input: {} })
    await new Promise(r => setTimeout(r, 300))
    expect(terminatePodMock).toHaveBeenCalled()
  })
})

// ── keepWarm ──────────────────────────────────────────────────────────────────

describe('keepWarm', () => {
  function makeMateriaStore() {
    const createCalls: unknown[] = []
    return {
      createCalls,
      async create(input: unknown) { createCalls.push(input); return { ...input as object, id: 'mat-new' } },
      async findById() { return null },
      async update() { return null as never },
      async findWarm() { return null },
    }
  }

  it('registers Materia as idle after job completes (no termination)', async () => {
    const { fetch } = makeFetchMock('pod-warm')
    const store = makeMateriaStore()
    const client = new SecurePodClient(makeConfig({ keepWarm: true }), () => makeSshTransport(), fetch, store)
    await client.submit({ input: {} })
    await new Promise(r => setTimeout(r, 100))
    expect(store.createCalls.length).toBe(1)
    expect((store.createCalls[0] as { status: string }).status).toBe('idle')
    expect(terminatePodMock).not.toHaveBeenCalled()
  })

  it('registered Materia has imageRef matching config.imageName', async () => {
    const { fetch } = makeFetchMock('pod-warm-img')
    const store = makeMateriaStore()
    const client = new SecurePodClient(makeConfig({ keepWarm: true, imageName: 'test/image:v2' }), () => makeSshTransport(), fetch, store)
    await client.submit({ input: {} })
    await new Promise(r => setTimeout(r, 100))
    expect((store.createCalls[0] as { imageRef: string }).imageRef).toBe('test/image:v2')
  })

  it('registered Materia has correct externusId', async () => {
    const { fetch } = makeFetchMock('pod-warm-id')
    const store = makeMateriaStore()
    const client = new SecurePodClient(makeConfig({ keepWarm: true }), () => makeSshTransport(), fetch, store)
    await client.submit({ input: {} })
    await new Promise(r => setTimeout(r, 100))
    expect((store.createCalls[0] as { externusId: string }).externusId).toBe('pod-warm-id')
  })

  it('terminates pod (does not register Materia) when bootstrap SSH throws', async () => {
    const brokenSsh = makeSshTransport({ async exec(cmd) { if (cmd === 'true') return ''; throw new Error('SSH refused') } })
    const { fetch } = makeFetchMock('pod-warm-fail')
    const store = makeMateriaStore()
    const client = new SecurePodClient(makeConfig({ keepWarm: true }), () => brokenSsh, fetch, store)
    await client.submit({ input: {} })
    await new Promise(r => setTimeout(r, 300))
    expect(terminatePodMock).toHaveBeenCalled()
    expect(store.createCalls.length).toBe(0)
  })
})
