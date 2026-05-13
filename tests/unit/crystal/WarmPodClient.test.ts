import { test } from 'node:test'
import assert from 'node:assert/strict'
import { WarmPodClient } from '../../../src/crystal/WarmPodClient.js'
import type { Materia, MateriaStore } from '../../../src/types/materia.js'
import type { SshTransportLike } from '../../../src/crystal/SecurePodClient.js'

// ── Helpers ───────────────────────────────────────────────────────────────────

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
    async update(id, patch) {
      updates.push({ id, patch })
      return { ...materia, ...patch }
    },
    async findWarm(_spec) { return null },
  } as MateriaStore & { updates: Array<{ id: string; patch: unknown }> }
}

function makeSshTransport(overrides: Partial<SshTransportLike> = {}): SshTransportLike & { execCalls: string[] } {
  const execCalls: string[] = []
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

function makeWebhookCapture(): { payloads: unknown[]; fetch: typeof fetch } {
  const payloads: unknown[] = []
  const fakeFetch = async (_url: string, opts: RequestInit = {}): Promise<Response> => {
    payloads.push(JSON.parse((opts.body as string) ?? '{}'))
    return new Response('{}', { status: 200 })
  }
  return { payloads, fetch: fakeFetch as typeof fetch }
}

// ── submit() ──────────────────────────────────────────────────────────────────

test('submit() returns the Materia id as externusJobId immediately', async () => {
  const materia = makeMateria()
  const store = makeMateriaStore(materia)
  const client = new WarmPodClient(materia, store, () => makeSshTransport())
  const result = await client.submit({ input: { '1': {} }, webhook: 'https://example.com/hook' })
  assert.equal(result.id, 'mat-warm-1')
})

test('submit() marks Materia active before running the job', async () => {
  const materia = makeMateria()
  const store = makeMateriaStore(materia)
  const client = new WarmPodClient(materia, store, () => makeSshTransport())
  await client.submit({ input: {}, webhook: 'https://example.com/hook' })
  const activeUpdate = store.updates.find(u => (u.patch as { status?: string }).status === 'active')
  assert.ok(activeUpdate, 'status should be set to active before job runs')
})

test('submit() marks Materia idle again after job completes', async () => {
  const materia = makeMateria()
  const store = makeMateriaStore(materia)
  const capture = makeWebhookCapture()
  const client = new WarmPodClient(materia, store, () => makeSshTransport(), capture.fetch, { comfyPollIntervalMs: 0, comfyReadyTimeoutMs: 500, jobTimeoutMs: 500 })
  await client.submit({ input: {} })
  await new Promise(r => setTimeout(r, 100))
  const idleUpdate = store.updates.find(u => (u.patch as { status?: string }).status === 'idle')
  assert.ok(idleUpdate, 'status should return to idle after job completes')
})

test('submit() does NOT terminate the pod after completion', async () => {
  let terminateCalled = false
  const materia = makeMateria()
  const store = makeMateriaStore(materia)
  const client = new WarmPodClient(materia, store, () => makeSshTransport(), async (_url: string, _opts?: RequestInit) => {
    if (_url.includes('/pods/') && (_opts?.method ?? 'GET') === 'DELETE') terminateCalled = true
    return new Response('{}', { status: 200 })
  })
  await client.submit({ input: {}, webhook: 'https://example.com/hook' })
  await new Promise(r => setTimeout(r, 100))
  assert.equal(terminateCalled, false, 'warm pod must not be terminated after job')
})

test('submit() POSTs COMPLETED webhook when workflow finishes', async () => {
  const materia = makeMateria()
  const store = makeMateriaStore(materia)
  const capture = makeWebhookCapture()
  const client = new WarmPodClient(materia, store, () => makeSshTransport(), capture.fetch, { comfyPollIntervalMs: 0, comfyReadyTimeoutMs: 500, jobTimeoutMs: 500 })
  await client.submit({ input: {}, webhook: 'https://hook.example.com/done' })
  await new Promise(r => setTimeout(r, 100))
  const completed = capture.payloads.find(p => (p as { status?: string }).status === 'COMPLETED')
  assert.ok(completed, 'COMPLETED webhook should be POSTed')
})

test('submit() webhook payload id matches the Materia id', async () => {
  const materia = makeMateria({ id: 'mat-unique-99' })
  const store = makeMateriaStore(materia)
  const capture = makeWebhookCapture()
  const client = new WarmPodClient(materia, store, () => makeSshTransport(), capture.fetch, { comfyPollIntervalMs: 0, comfyReadyTimeoutMs: 500, jobTimeoutMs: 500 })
  await client.submit({ input: {}, webhook: 'https://hook.example.com/done' })
  await new Promise(r => setTimeout(r, 100))
  const completed = capture.payloads.find(p => (p as { status?: string }).status === 'COMPLETED') as { id?: string }
  assert.equal(completed?.id, 'mat-unique-99')
})

test('submit() marks Materia idle and POSTs FAILED webhook when SSH throws', async () => {
  const brokenSsh = makeSshTransport({ async exec(_cmd) { throw new Error('ComfyUI gone') } })
  const materia = makeMateria()
  const store = makeMateriaStore(materia)
  const capture = makeWebhookCapture()
  const client = new WarmPodClient(materia, store, () => brokenSsh, capture.fetch, { comfyPollIntervalMs: 0, comfyReadyTimeoutMs: 50, jobTimeoutMs: 500 })
  await client.submit({ input: {}, webhook: 'https://hook.example.com/done' })
  await new Promise(r => setTimeout(r, 500))
  const failed = capture.payloads.find(p => (p as { status?: string }).status === 'FAILED')
  assert.ok(failed, 'FAILED webhook should be POSTed on SSH error')
  const idleUpdate = store.updates.find(u => (u.patch as { status?: string }).status === 'idle')
  assert.ok(idleUpdate, 'Materia should return to idle even on failure')
})
