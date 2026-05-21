import { describe, it, expect, vi } from 'vitest'
import { WarmPodClient } from '../../../src/crystal/WarmPodClient.js'
import type { Materia, MateriaStore } from '../../../src/types/materia.js'
import { bus } from '../../../src/lib/bus.js'
import { withTrace, makeTraceContext } from '../../../src/lib/trace.js'

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

function makeMateriaStore(materia: Materia): MateriaStore & { updates: Array<{ id: string; patch: unknown }> } {
  const updates: Array<{ id: string; patch: unknown }> = []
  return {
    updates,
    async create(input) { return { ...input, id: 'mat-new' } },
    async findById(id) { return materia.id === id ? materia : null },
    async update(id, patch) { updates.push({ id, patch }); return { ...materia, ...patch } },
    async findWarm() { return null },
  } as MateriaStore & { updates: Array<{ id: string; patch: unknown }> }
}

/**
 * Mock fetch for comfyrunner endpoints on the warm pod.
 * Handles: GET /health, POST /job, GET /job/:id/stream, POST <webhook>
 */
function makeComfyrunnerFetch(externusId: string, opts: {
  healthStatus?: string
  jobAccepted?: boolean
  sseEvents?: Array<Record<string, unknown>>
  webhookPayloads?: unknown[]
} = {}) {
  const {
    healthStatus = 'ready',
    jobAccepted = true,
    sseEvents = [{ type: 'complete' }],
    webhookPayloads = [],
  } = opts

  const runnerBase = `https://${externusId}-8080.proxy.runpod.net`

  const fetch = vi.fn(async (url: string, init?: RequestInit): Promise<Response> => {
    const method = (init?.method ?? 'GET').toUpperCase()

    if (method === 'GET' && url === `${runnerBase}/health`) {
      return new Response(JSON.stringify({ status: healthStatus }), { status: 200 })
    }
    if (method === 'POST' && url === `${runnerBase}/job`) {
      return new Response('{}', { status: jobAccepted ? 200 : 503 })
    }
    if (method === 'GET' && url.startsWith(`${runnerBase}/job/`)) {
      return makeSseStream(sseEvents)
    }
    // webhook capture
    if (method === 'POST') {
      webhookPayloads.push(JSON.parse((init?.body as string) ?? '{}'))
      return new Response('{}', { status: 200 })
    }

    return new Response('Not found', { status: 404 })
  }) as unknown as typeof fetch

  return { fetch, webhookPayloads }
}

// ── submit() ──────────────────────────────────────────────────────────────────

describe('submit()', () => {
  it('returns the per-submission jobId immediately (must match the webhook id)', async () => {
    const materia = makeMateria()
    const { fetch } = makeComfyrunnerFetch('pod-xyz')
    const client = new WarmPodClient(materia, makeMateriaStore(materia), fetch)
    const result = await client.submit({ input: {}, webhook: 'https://hook.example.com/done' })
    // jobId is `${externusId}-${Date.now()}` — the id comfyrunner fires the webhook
    // with, so the actum's externusJobId must equal it (not the bare externusId).
    expect(result.id).toMatch(/^pod-xyz-\d+$/)
  })

  it('emits a warm-pod-found stage so the UI can react 🔥', async () => {
    const materia = makeMateria()
    const { fetch } = makeComfyrunnerFetch('pod-xyz')
    const client = new WarmPodClient(materia, makeMateriaStore(materia), fetch)
    const stages: string[] = []
    const listener = (d: { stage: string }) => stages.push(d.stage)
    bus.on('actum.stage', listener)
    await withTrace(makeTraceContext({ actumId: 'actum-warm' }), async () => {
      await client.submit({ input: {} })
    })
    bus.off('actum.stage', listener)
    expect(stages).toContain('warm-pod-found')
  })

  it('polls /health then POSTs to /job', async () => {
    const materia = makeMateria()
    const { fetch } = makeComfyrunnerFetch('pod-xyz')
    const client = new WarmPodClient(materia, makeMateriaStore(materia), fetch)
    await client.submit({ input: {} })
    await new Promise(r => setTimeout(r, 50))

    const calls = (fetch as ReturnType<typeof vi.fn>).mock.calls.map(([url, opts]) => ({
      url,
      method: (opts?.method ?? 'GET').toUpperCase(),
    }))
    expect(calls.some(c => c.url.includes('/health') && c.method === 'GET')).toBe(true)
    expect(calls.some(c => c.url.includes('/job') && !c.url.includes('/stream') && c.method === 'POST')).toBe(true)
  })

  it('awaits the SSE stream after submitting the job', async () => {
    const materia = makeMateria()
    const { fetch } = makeComfyrunnerFetch('pod-xyz')
    const client = new WarmPodClient(materia, makeMateriaStore(materia), fetch)
    await client.submit({ input: {} })
    await new Promise(r => setTimeout(r, 50))

    const calls = (fetch as ReturnType<typeof vi.fn>).mock.calls.map(([url]) => url as string)
    expect(calls.some(u => u.includes('/job/') && u.includes('/stream'))).toBe(true)
  })
})

// ── Materia status ─────────────────────────────────────────────────────────────

describe('Materia status after job', () => {
  it('sets status to idle after stream completes (economy pod)', async () => {
    const materia = makeMateria({ podPolicy: 'economy' })
    const store = makeMateriaStore(materia)
    const { fetch } = makeComfyrunnerFetch('pod-xyz')
    const client = new WarmPodClient(materia, store, fetch)
    await client.submit({ input: {} })
    await new Promise(r => setTimeout(r, 100))
    const idleUpdate = store.updates.find(u => (u.patch as { status?: string }).status === 'idle')
    expect(idleUpdate).toBeDefined()
  })

  it('sets status to idle when no podPolicy set (default)', async () => {
    const materia = makeMateria()  // no podPolicy
    const store = makeMateriaStore(materia)
    const { fetch } = makeComfyrunnerFetch('pod-xyz')
    const client = new WarmPodClient(materia, store, fetch)
    await client.submit({ input: {} })
    await new Promise(r => setTimeout(r, 100))
    const idleUpdate = store.updates.find(u => (u.patch as { status?: string }).status === 'idle')
    expect(idleUpdate).toBeDefined()
  })

  it('sets status to terminated for private pod', async () => {
    const materia = makeMateria({ podPolicy: 'private' })
    const store = makeMateriaStore(materia)
    const { fetch } = makeComfyrunnerFetch('pod-xyz')
    const client = new WarmPodClient(materia, store, fetch)
    await client.submit({ input: {} })
    await new Promise(r => setTimeout(r, 100))
    const terminatedUpdate = store.updates.find(u => (u.patch as { status?: string }).status === 'terminated')
    expect(terminatedUpdate).toBeDefined()
    const idleUpdate = store.updates.find(u => (u.patch as { status?: string }).status === 'idle')
    expect(idleUpdate).toBeUndefined()
  })

  it('sets status to terminated for private pod even on failure', async () => {
    const materia = makeMateria({ podPolicy: 'private' })
    const store = makeMateriaStore(materia)
    const { fetch } = makeComfyrunnerFetch('pod-xyz', {
      healthStatus: 'starting',  // never ready → triggers failure
    })
    const client = new WarmPodClient(materia, store, fetch, { runnerReadyTimeoutMs: 50, runnerPollIntervalMs: 0 })
    await client.submit({ input: {}, webhook: 'https://hook.example.com/done' })
    await new Promise(r => setTimeout(r, 300))
    const terminatedUpdate = store.updates.find(u => (u.patch as { status?: string }).status === 'terminated')
    expect(terminatedUpdate).toBeDefined()
  })
})

// ── webhook behaviour ─────────────────────────────────────────────────────────

describe('webhook behaviour', () => {
  it('fires FAILED webhook when comfyrunner health never becomes ready', async () => {
    const materia = makeMateria()
    const store = makeMateriaStore(materia)
    const webhookPayloads: unknown[] = []
    const { fetch } = makeComfyrunnerFetch('pod-xyz', {
      healthStatus: 'starting',
      webhookPayloads,
    })
    const client = new WarmPodClient(materia, store, fetch, { runnerReadyTimeoutMs: 50, runnerPollIntervalMs: 0 })
    await client.submit({ input: {}, webhook: 'https://hook.example.com/done' })
    await new Promise(r => setTimeout(r, 300))
    const failed = (webhookPayloads as Array<{ status?: string }>).find(p => p.status === 'FAILED')
    expect(failed).toBeDefined()
  })

  it('does NOT fire FAILED webhook when comfyrunner accepted the job (comfyrunner owns it)', async () => {
    const materia = makeMateria()
    const store = makeMateriaStore(materia)
    const webhookPayloads: unknown[] = []
    // comfyrunner accepts job but SSE stream returns an error
    const { fetch } = makeComfyrunnerFetch('pod-xyz', {
      sseEvents: [{ type: 'error', error: 'OOM' }],
      webhookPayloads,
    })
    const client = new WarmPodClient(materia, store, fetch)
    await client.submit({ input: {}, webhook: 'https://hook.example.com/done' })
    await new Promise(r => setTimeout(r, 200))
    expect((webhookPayloads as Array<{ status?: string }>).some(p => p.status === 'FAILED')).toBe(false)
  })
})
