import { test } from 'node:test'
import assert from 'node:assert/strict'
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

interface FetchCall { url: string; method: string }

function makeComfyrunnerFetch(externusId: string, opts: {
  healthStatus?: string
  jobAccepted?: boolean
  sseEvents?: Array<Record<string, unknown>>
  webhookPayloads?: unknown[]
} = {}): { fetch: typeof fetch; calls: FetchCall[]; webhookPayloads: unknown[] } {
  const {
    healthStatus = 'ready',
    jobAccepted = true,
    sseEvents = [{ type: 'complete' }],
    webhookPayloads = [],
  } = opts
  const runnerBase = `https://${externusId}-8080.proxy.runpod.net`
  const calls: FetchCall[] = []

  const fetch = (async (url: string, init?: RequestInit): Promise<Response> => {
    const method = (init?.method ?? 'GET').toUpperCase()
    calls.push({ url, method })

    if (method === 'GET' && url === `${runnerBase}/health`) {
      return new Response(JSON.stringify({ status: healthStatus }), { status: 200 })
    }
    if (method === 'POST' && url === `${runnerBase}/job`) {
      return new Response('{}', { status: jobAccepted ? 200 : 503 })
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

// ── submit() ──────────────────────────────────────────────────────────────────

test('submit returns the per-submission jobId immediately (must match the webhook id)', async () => {
  const materia = makeMateria()
  const { fetch } = makeComfyrunnerFetch('pod-xyz')
  const client = new WarmPodClient(materia, makeMateriaStore(materia), fetch)
  const result = await client.submit({ input: {}, webhook: 'https://hook.example.com/done' })
  // jobId is `${externusId}-${Date.now()}` — the id comfyrunner fires the webhook with
  assert.match(result.id, /^pod-xyz-\d+$/)
})

test('submit emits a warm-pod-found stage so the UI can react 🔥', async () => {
  const materia = makeMateria()
  const { fetch } = makeComfyrunnerFetch('pod-xyz')
  const client = new WarmPodClient(materia, makeMateriaStore(materia), fetch)
  const stages: string[] = []
  const listener = (d: { stage: string }): void => { stages.push(d.stage) }
  bus.on('actum.stage', listener)
  await withTrace(makeTraceContext({ actumId: 'actum-warm' }), async () => {
    await client.submit({ input: {} })
  })
  bus.off('actum.stage', listener)
  assert.ok(stages.includes('warm-pod-found'), `stages missing warm-pod-found: ${stages.join(',')}`)
})

test('submit polls /health then POSTs to /job', async () => {
  const materia = makeMateria()
  const { fetch, calls } = makeComfyrunnerFetch('pod-xyz')
  const client = new WarmPodClient(materia, makeMateriaStore(materia), fetch)
  await client.submit({ input: {} })
  await new Promise(r => setTimeout(r, 50))
  assert.ok(calls.some(c => c.url.includes('/health') && c.method === 'GET'), 'no /health GET')
  assert.ok(calls.some(c => c.url.includes('/job') && !c.url.includes('/stream') && c.method === 'POST'), 'no /job POST')
})

test('submit awaits the SSE stream after submitting the job', async () => {
  const materia = makeMateria()
  const { fetch, calls } = makeComfyrunnerFetch('pod-xyz')
  const client = new WarmPodClient(materia, makeMateriaStore(materia), fetch)
  await client.submit({ input: {} })
  await new Promise(r => setTimeout(r, 50))
  assert.ok(calls.some(c => c.url.includes('/job/') && c.url.includes('/stream')), 'no /job/:id/stream GET')
})

// ── Materia status after job ──────────────────────────────────────────────────

test('Materia status: sets to idle after stream completes (economy pod)', async () => {
  const materia = makeMateria({ podPolicy: 'economy' })
  const store = makeMateriaStore(materia)
  const { fetch } = makeComfyrunnerFetch('pod-xyz')
  const client = new WarmPodClient(materia, store, fetch)
  await client.submit({ input: {} })
  await new Promise(r => setTimeout(r, 100))
  const idleUpdate = store.updates.find(u => (u.patch as { status?: string }).status === 'idle')
  assert.ok(idleUpdate, 'expected an idle status update')
})

test('Materia status: sets to idle when no podPolicy set (default)', async () => {
  const materia = makeMateria()
  const store = makeMateriaStore(materia)
  const { fetch } = makeComfyrunnerFetch('pod-xyz')
  const client = new WarmPodClient(materia, store, fetch)
  await client.submit({ input: {} })
  await new Promise(r => setTimeout(r, 100))
  const idleUpdate = store.updates.find(u => (u.patch as { status?: string }).status === 'idle')
  assert.ok(idleUpdate, 'expected an idle status update')
})

test('Materia status: sets to terminated for private pod', async () => {
  const materia = makeMateria({ podPolicy: 'private' })
  const store = makeMateriaStore(materia)
  const { fetch } = makeComfyrunnerFetch('pod-xyz')
  const client = new WarmPodClient(materia, store, fetch)
  await client.submit({ input: {} })
  await new Promise(r => setTimeout(r, 100))
  const terminatedUpdate = store.updates.find(u => (u.patch as { status?: string }).status === 'terminated')
  assert.ok(terminatedUpdate, 'expected terminated update')
  const idleUpdate = store.updates.find(u => (u.patch as { status?: string }).status === 'idle')
  assert.equal(idleUpdate, undefined, 'should NOT mark idle for private pods')
})

test('Materia status: sets to terminated for private pod even on failure', async () => {
  const materia = makeMateria({ podPolicy: 'private' })
  const store = makeMateriaStore(materia)
  const { fetch } = makeComfyrunnerFetch('pod-xyz', { healthStatus: 'starting' })
  const client = new WarmPodClient(materia, store, fetch, { runnerReadyTimeoutMs: 50, runnerPollIntervalMs: 0 })
  await client.submit({ input: {}, webhook: 'https://hook.example.com/done' })
  await new Promise(r => setTimeout(r, 300))
  const terminatedUpdate = store.updates.find(u => (u.patch as { status?: string }).status === 'terminated')
  assert.ok(terminatedUpdate, 'expected terminated update')
})

// ── webhook behaviour ─────────────────────────────────────────────────────────

test('webhook: fires FAILED when comfyrunner health never becomes ready', async () => {
  const materia = makeMateria()
  const store = makeMateriaStore(materia)
  const webhookPayloads: unknown[] = []
  const { fetch } = makeComfyrunnerFetch('pod-xyz', { healthStatus: 'starting', webhookPayloads })
  const client = new WarmPodClient(materia, store, fetch, { runnerReadyTimeoutMs: 50, runnerPollIntervalMs: 0 })
  await client.submit({ input: {}, webhook: 'https://hook.example.com/done' })
  await new Promise(r => setTimeout(r, 300))
  const failed = (webhookPayloads as Array<{ status?: string }>).find(p => p.status === 'FAILED')
  assert.ok(failed, 'expected a FAILED webhook')
})

test('webhook: does NOT fire FAILED when comfyrunner accepted the job (comfyrunner owns it)', async () => {
  const materia = makeMateria()
  const store = makeMateriaStore(materia)
  const webhookPayloads: unknown[] = []
  // comfyrunner accepts job but SSE stream returns an error
  const { fetch } = makeComfyrunnerFetch('pod-xyz', { sseEvents: [{ type: 'error', error: 'OOM' }], webhookPayloads })
  const client = new WarmPodClient(materia, store, fetch)
  await client.submit({ input: {}, webhook: 'https://hook.example.com/done' })
  await new Promise(r => setTimeout(r, 200))
  assert.equal((webhookPayloads as Array<{ status?: string }>).some(p => p.status === 'FAILED'), false)
})
