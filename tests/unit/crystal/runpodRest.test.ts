import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import {
  RUNPOD_REST_BASE,
  RUNPOD_PODS_URL,
  runpodPodUrl,
  runpodFetch,
  createRunPodPod,
  deleteRunPodPod,
  directSshOf,
  type RunPodPod,
} from '../../../src/crystal/runpodRest.js'

type Call = { url: string; method: string; body?: Record<string, unknown> }

function recorder(answer: (call: Call) => Response | Promise<Response>) {
  const calls: Call[] = []
  const fetchFn = async (url: string, init?: RequestInit): Promise<Response> => {
    const call: Call = {
      url,
      method: (init?.method ?? 'GET').toUpperCase(),
      ...(init?.body ? { body: JSON.parse(init.body as string) } : {}),
    }
    calls.push(call)
    return answer(call)
  }
  return { fetchFn, calls }
}

const problem = (status: number, title: string, detail: string) =>
  new Response(JSON.stringify({ title, status, detail }), { status, headers: { 'Content-Type': 'application/problem+json' } })

const gpuCandidates = (...ids: string[]) =>
  ids.map(id => ({ label: id, body: { name: 'n', image: 'img', gpu: { id, count: 1 } } }))

// ── the base URL lives in one place ───────────────────────────────────────────

test('RunPod REST calls go to the v2 API', () => {
  assert.equal(RUNPOD_REST_BASE, 'https://api.runpod.io/v2')
  assert.equal(RUNPOD_PODS_URL, 'https://api.runpod.io/v2/pods')
  assert.equal(runpodPodUrl('abc'), 'https://api.runpod.io/v2/pods/abc')
})

test('no source file names the retired v1 REST host or builds its own v2 pods URL', () => {
  const offenders: string[] = []
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name)
      if (statSync(p).isDirectory()) { walk(p); continue }
      if (!p.endsWith('.ts')) continue
      const src = readFileSync(p, 'utf8')
      if (src.includes('rest.runpod.io')) offenders.push(`${p}: rest.runpod.io`)
      if (!p.endsWith('runpodRest.ts') && src.includes('api.runpod.io/v2')) offenders.push(`${p}: api.runpod.io/v2`)
    }
  }
  walk('src')
  assert.deepEqual(offenders, [])
})

// ── create: the candidate walk ────────────────────────────────────────────────

test('create returns the first pod RunPod places, and stops there', async () => {
  const { fetchFn, calls } = recorder(() => new Response(JSON.stringify({ id: 'p1', status: 'PROVISIONING', cost: 0.69 }), { status: 201 }))
  const pod = await createRunPodPod({ fetchFn, apiKey: 'k', candidates: gpuCandidates('A', 'B'), timeoutMs: 1000 })
  assert.equal(pod.id, 'p1')
  assert.equal(pod.cost, 0.69)
  assert.equal(calls.length, 1)
  assert.equal(calls[0]!.url, 'https://api.runpod.io/v2/pods')
  assert.deepEqual(calls[0]!.body!.gpu, { id: 'A', count: 1 })
})

test('a 400 (could not be placed) moves on to the next candidate', async () => {
  const { fetchFn, calls } = recorder(c =>
    (c.body!.gpu as { id: string }).id === 'A'
      ? problem(400, 'Bad Request', 'no capacity for A')
      : new Response(JSON.stringify({ id: 'p2' }), { status: 201 }))
  const pod = await createRunPodPod({ fetchFn, apiKey: 'k', candidates: gpuCandidates('A', 'B', 'C'), timeoutMs: 1000 })
  assert.equal(pod.id, 'p2')
  assert.deepEqual(calls.map(c => (c.body!.gpu as { id: string }).id), ['A', 'B'])
})

test('every candidate refused: the error names each one and why', async () => {
  const { fetchFn } = recorder(c => problem(400, 'Bad Request', `no capacity for ${(c.body!.gpu as { id: string }).id}`))
  await assert.rejects(
    createRunPodPod({ fetchFn, apiKey: 'k', candidates: gpuCandidates('A', 'B'), timeoutMs: 1000 }),
    (err: Error) => /no candidate could be placed/.test(err.message)
      && /'A': 400 Bad Request: no capacity for A/.test(err.message)
      && /'B': 400 Bad Request: no capacity for B/.test(err.message),
  )
})

test('a 422 (malformed body) is not retried on another candidate', async () => {
  const { fetchFn, calls } = recorder(() => problem(422, 'Unprocessable Entity', 'Request validation failed.'))
  await assert.rejects(
    createRunPodPod({ fetchFn, apiKey: 'k', candidates: gpuCandidates('A', 'B'), timeoutMs: 1000 }),
    /pod provision failed: 422 Unprocessable Entity: Request validation failed\./,
  )
  assert.equal(calls.length, 1)
})

test('a 401 is not retried on another candidate', async () => {
  const { fetchFn, calls } = recorder(() => problem(401, 'Unauthorized', 'missing bearer token'))
  await assert.rejects(
    createRunPodPod({ fetchFn, apiKey: 'k', candidates: gpuCandidates('A', 'B'), timeoutMs: 1000 }),
    /401 Unauthorized: missing bearer token/,
  )
  assert.equal(calls.length, 1)
})

const noSleep = async (): Promise<void> => {}
const placed = (id: string) => new Response(JSON.stringify({ id }), { status: 201 })
const gpuOf = (c: { body?: Record<string, unknown> }) => (c.body!.gpu as { id: string }).id

test('a 403 (no access to that pool) skips to the next candidate', async () => {
  const { fetchFn, calls } = recorder(c => gpuOf(c) === 'A' ? problem(403, 'Forbidden', 'pool not available') : placed('p3'))
  const pod = await createRunPodPod({ fetchFn, apiKey: 'k', candidates: gpuCandidates('A', 'B'), timeoutMs: 1000, sleepFn: noSleep })
  assert.equal(pod.id, 'p3')
  assert.deepEqual(calls.map(gpuOf), ['A', 'B'])
})

test('a 429 waits out Retry-After and retries the same candidate', async () => {
  let n = 0
  const waits: number[] = []
  const { fetchFn, calls } = recorder(() => n++ === 0
    ? new Response(JSON.stringify({ title: 'Too Many Requests', status: 429, detail: 'slow down' }), { status: 429, headers: { 'Retry-After': '3' } })
    : placed('p4'))
  const pod = await createRunPodPod({ fetchFn, apiKey: 'k', candidates: gpuCandidates('A', 'B'), timeoutMs: 1000, sleepFn: async ms => { waits.push(ms) } })
  assert.equal(pod.id, 'p4')
  assert.deepEqual(calls.map(gpuOf), ['A', 'A'])
  assert.deepEqual(waits, [3000])
})

test('a 5xx retries the same candidate with backoff, then gives up without trying others', async () => {
  const waits: number[] = []
  const { fetchFn, calls } = recorder(() => problem(503, 'Service Unavailable', 'try later'))
  await assert.rejects(
    createRunPodPod({ fetchFn, apiKey: 'k', candidates: gpuCandidates('A', 'B'), timeoutMs: 1000, sleepFn: async ms => { waits.push(ms) } }),
    /503 Service Unavailable: try later/,
  )
  assert.deepEqual(calls.map(gpuOf), ['A', 'A', 'A'])
  assert.equal(waits.length, 2)
  assert.ok(waits[1]! > waits[0]!, 'backoff grows')
})

test('a 402 (insufficient balance) stops at once', async () => {
  const { fetchFn, calls } = recorder(() => problem(402, 'Payment Required', 'insufficient balance'))
  await assert.rejects(
    createRunPodPod({ fetchFn, apiKey: 'k', candidates: gpuCandidates('A', 'B'), timeoutMs: 1000, sleepFn: noSleep }),
    /402 Payment Required/,
  )
  assert.equal(calls.length, 1)
})

test('a 202 (queued, no pod yet) is an error, not a pod', async () => {
  const { fetchFn } = recorder(() => new Response(JSON.stringify({ id: 'q1', status: 'QUEUED', podId: null }), { status: 202 }))
  await assert.rejects(
    createRunPodPod({ fetchFn, apiKey: 'k', candidates: gpuCandidates('A'), timeoutMs: 1000 }),
    /queued \(202\), not placed/,
  )
})

// ── DNS failures name themselves ──────────────────────────────────────────────

function dnsFailure(code: string, hostname: string): Error {
  const cause = Object.assign(new Error(`getaddrinfo ${code} ${hostname}`), { code, hostname, syscall: 'getaddrinfo' })
  return new TypeError('fetch failed', { cause })
}

test('a host that does not resolve is reported as a DNS failure naming the host, not "fetch failed"', async () => {
  const fetchFn = async (): Promise<Response> => { throw dnsFailure('ENOTFOUND', 'api.runpod.io') }
  await assert.rejects(
    createRunPodPod({ fetchFn, apiKey: 'k', candidates: gpuCandidates('A'), timeoutMs: 1000 }),
    /RunPod API unreachable: DNS lookup for api\.runpod\.io failed \(ENOTFOUND\)/,
  )
})

test('a temporary resolver failure (EAI_AGAIN) is named the same way', async () => {
  const fetchFn = async (): Promise<Response> => { throw dnsFailure('EAI_AGAIN', 'api.runpod.io') }
  await assert.rejects(runpodFetch(fetchFn, runpodPodUrl('p'), {}, 1000), /DNS lookup for api\.runpod\.io failed \(EAI_AGAIN\)/)
})

test('a non-DNS network failure is passed through unchanged', async () => {
  const original = new TypeError('fetch failed', { cause: Object.assign(new Error('reset'), { code: 'ECONNRESET' }) })
  const fetchFn = async (): Promise<Response> => { throw original }
  await assert.rejects(runpodFetch(fetchFn, runpodPodUrl('p'), {}, 1000), (err: unknown) => err === original)
})

// ── reading a v2 pod ──────────────────────────────────────────────────────────

test('SSH comes from ssh.direct when RunPod has published it', () => {
  const pod: RunPodPod = {
    id: 'p', status: 'RUNNING',
    ssh: { proxy: { host: 'ssh.runpod.io', port: 22, username: 'p-1' }, direct: { host: '203.0.113.7', port: 40122 } },
  }
  assert.deepEqual(directSshOf(pod), { host: '203.0.113.7', port: 40122 })
})

test('SSH falls back to the live mapping for private port 22', () => {
  const pod: RunPodPod = {
    id: 'p', status: 'RUNNING', ssh: { proxy: null, direct: null },
    runtime: { ports: [{ private: 8080, public: null, type: 'http', ip: null }, { private: 22, public: 40222, type: 'tcp', ip: '203.0.113.8' }] },
  }
  assert.deepEqual(directSshOf(pod), { host: '203.0.113.8', port: 40222 })
})

test('the SSH proxy is never taken for a direct endpoint', () => {
  const pod: RunPodPod = { id: 'p', status: 'RUNNING', ssh: { proxy: { host: 'ssh.runpod.io', port: 22 }, direct: null }, runtime: null }
  assert.deepEqual(directSshOf(pod), { host: undefined, port: undefined })
})

// ── terminate ─────────────────────────────────────────────────────────────────

test('terminate is one DELETE on the v2 pod URL', async () => {
  const { fetchFn, calls } = recorder(() => new Response(null, { status: 204 }))
  assert.deepEqual(await deleteRunPodPod(fetchFn, 'k', 'p9', 1000), { ok: true })
  assert.deepEqual(calls.map(c => `${c.method} ${c.url}`), ['DELETE https://api.runpod.io/v2/pods/p9'])
})

test('terminating a pod that is already gone (404) counts as done', async () => {
  const { fetchFn } = recorder(() => problem(404, 'Not Found', 'resource not found'))
  assert.deepEqual(await deleteRunPodPod(fetchFn, 'k', 'p9', 1000), { ok: true })
})

test('a refused terminate reports the problem detail', async () => {
  const { fetchFn } = recorder(() => problem(409, 'Conflict', 'pod is locked'))
  assert.deepEqual(await deleteRunPodPod(fetchFn, 'k', 'p9', 1000), { ok: false, reason: '409 Conflict: pod is locked' })
})
