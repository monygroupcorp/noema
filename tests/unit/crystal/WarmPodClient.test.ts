import { test } from 'node:test'
import assert from 'node:assert/strict'
import { WarmPodClient } from '../../../src/crystal/WarmPodClient.js'
import type { Materia, MateriaStore } from '../../../src/types/materia.js'
import { registerProgressusRecorder } from '../../../src/execution/progressusSink.js'
import { withTrace, makeTraceContext } from '../../../src/lib/trace.js'
import type { Progressus } from '../../../src/types/progressus.js'

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
    // The rest of the MateriaStore surface — unreached by the warm client, so these throw
    // rather than return a plausible default.
    async findActive(): Promise<Materia[]> { throw new Error('makeMateriaStore.findActive: not implemented for this suite') },
    async reapIdle(): Promise<Materia[]> { throw new Error('makeMateriaStore.reapIdle: not implemented for this suite') },
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
  // `typeof globalThis.fetch`, not `typeof fetch`: this binding is itself named `fetch`, so the
  // unqualified form would be a self-reference in its own initializer.
  }) as unknown as typeof globalThis.fetch

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

test('submit records a warm-pod-found Progressus so the UI can react 🔥', async () => {
  const materia = makeMateria()
  const { fetch } = makeComfyrunnerFetch('pod-xyz')
  const client = new WarmPodClient(materia, makeMateriaStore(materia), fetch)
  const seen: Progressus[] = []
  registerProgressusRecorder(async (_id, p) => { seen.push(p) })
  try {
    await withTrace(makeTraceContext({ actumId: 'actum-warm' }), async () => {
      await client.submit({ input: {} })
    })
  } finally {
    registerProgressusRecorder(async () => {})
  }
  // warm reuse → a near-zero `provisioning` report tagged 'warm pod reused' (the 🔥 signal, #6e).
  assert.ok(seen.some(p => p.phase === 'provisioning' && p.message === 'warm pod reused'), 'missing warm-pod-found Progressus')
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

test('warm window: a job never shortens a host-set deadline', async () => {
  // The host bought 30 minutes from the warm-window buttons. Delivering a job on the pod
  // must not collapse that to the 60 s default — the host owns the deadline and pays
  // Census for it, and truncating it kills the pod under any chain of guests after the first.
  const hostWindow = new Date(Date.now() + 30 * 60_000)
  const materia = makeMateria({ warmUntil: hostWindow })
  const store = makeMateriaStore(materia)
  const { fetch } = makeComfyrunnerFetch('pod-xyz')
  const client = new WarmPodClient(materia, store, fetch, { warmTtlMs: 60_000 })
  await client.submit({ input: {} })
  await new Promise(r => setTimeout(r, 100))
  const idleUpdate = store.updates.find(u => (u.patch as { status?: string }).status === 'idle')
  assert.ok(idleUpdate, 'expected an idle status update')
  assert.equal((idleUpdate!.patch as { warmUntil?: Date }).warmUntil?.getTime(), hostWindow.getTime())
})

test('warm window: a deadline set WHILE the job runs still survives it', async () => {
  // `this.materia` is the snapshot taken when the client was built. A host pressing the
  // warm-window buttons mid-run writes straight to the store, so the deadline has to be
  // re-read at completion or the run silently reverts it.
  const materia = makeMateria()
  const stored = makeMateria()
  const store = makeMateriaStore(stored)
  const { fetch } = makeComfyrunnerFetch('pod-xyz')
  const client = new WarmPodClient(materia, store, fetch, { warmTtlMs: 60_000 })
  const midRunWindow = new Date(Date.now() + 10 * 60_000)
  stored.warmUntil = midRunWindow
  await client.submit({ input: {} })
  await new Promise(r => setTimeout(r, 100))
  const idleUpdate = store.updates.find(u => (u.patch as { status?: string }).status === 'idle')
  assert.equal((idleUpdate!.patch as { warmUntil?: Date }).warmUntil?.getTime(), midRunWindow.getTime())
})

test('warm window: an expired or absent deadline is re-armed to the configured TTL', async () => {
  // The ordinary case, unchanged: a pod whose window has already lapsed (or was never set)
  // gets a fresh one past this job's delivery so a follow-up can reuse it.
  const materia = makeMateria({ warmUntil: new Date(Date.now() - 5_000) })
  const store = makeMateriaStore(materia)
  const { fetch } = makeComfyrunnerFetch('pod-xyz')
  const before = Date.now()
  const client = new WarmPodClient(materia, store, fetch, { warmTtlMs: 60_000 })
  await client.submit({ input: {} })
  await new Promise(r => setTimeout(r, 100))
  const idleUpdate = store.updates.find(u => (u.patch as { status?: string }).status === 'idle')
  const armed = (idleUpdate!.patch as { warmUntil?: Date }).warmUntil!.getTime()
  assert.ok(armed >= before + 60_000, `expected a fresh 60 s window, got ${armed - before} ms`)
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

test('Materia status: a job failure the pod cannot answer for leaves the Materia terminated, never re-armed warm', async () => {
  const materia = makeMateria({ podPolicy: 'economy' })
  const store = makeMateriaStore(materia)
  const runnerBase = 'https://pod-xyz-8080.proxy.runpod.net'
  let healthCalls = 0
  // The pod answers the readiness probe, the job then fails with an error whose text carries no
  // transport marker at all, and the pod stops answering. Its fate must come from the /health
  // probe, not from reading the error.
  const fetch = (async (url: string, init?: RequestInit): Promise<Response> => {
    const method = (init?.method ?? 'GET').toUpperCase()
    if (method === 'GET' && url === `${runnerBase}/health`) {
      healthCalls++
      if (healthCalls === 1) return new Response(JSON.stringify({ status: 'ready' }), { status: 200 })
      throw new Error('connect ETIMEDOUT')
    }
    if (method === 'POST' && url === `${runnerBase}/job`) return new Response('{}', { status: 200 })
    if (method === 'GET' && url.startsWith(`${runnerBase}/job/`)) return makeSseStream([{ type: 'error', error: 'kaboom' }])
    return new Response('{}', { status: 200 })
  // `typeof globalThis.fetch`, not `typeof fetch`: this binding is itself named `fetch`, so the
  // unqualified form would be a self-reference in its own initializer.
  }) as unknown as typeof globalThis.fetch

  const client = new WarmPodClient(materia, store, fetch)
  await client.submit({ input: {} })
  await new Promise(r => setTimeout(r, 200))

  assert.ok(healthCalls >= 2, 'the pod fate must be asked, not inferred from the error text')
  assert.deepEqual(store.updates, [{ id: 'mat-warm-1', patch: { status: 'terminated' } }])
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
