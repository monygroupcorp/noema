import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { Actum } from '../../../src/types/actum.js'
import type { Exitus } from '../../../src/types/cursus.js'

// ── Helpers (copied from executionWebhook.test.ts pattern) ───────────────────

function makeActum(overrides: Partial<Actum> = {}): Actum {
  return {
    id: 'actum-router-1',
    modusId: 'runmake.flux-schnell',
    modusVersiono: '1.0.0',
    impetus: 0n,
    signaConsumed: [],
    aditus: { prompt: 'a cat' },
    status: 'nascens',
    inceptum: new Date(),
    expirat: new Date(Date.now() + 60_000),
    externusJobId: 'job-router-abc',
    ...overrides,
  }
}

interface CompletorMock {
  completed: Array<{ actumId: string; exitus: Exitus }>
  failed: Array<{ actumId: string; error: string }>
  complete(actum: Actum, exitus: Exitus): Promise<Actum>
  fail(actum: Actum, error: string): Promise<Actum>
}

function makeCompletor(): CompletorMock {
  const mock: CompletorMock = {
    completed: [],
    failed: [],
    async complete(actum, exitus) {
      mock.completed.push({ actumId: actum.id, exitus })
      return { ...actum, status: 'completus' as const }
    },
    async fail(actum, error) {
      mock.failed.push({ actumId: actum.id, error })
      return { ...actum, status: 'fractus' as const }
    },
  }
  return mock
}

function makeActorum(actum: Actum | null) {
  return {
    async create(a: Omit<Actum, 'inceptum'>) { return { ...a, inceptum: new Date() } as Actum },
    async update(_id: string, _patch: Partial<Actum>) { return actum! },
    async findById(_id: string) { return actum },
    async findByExternusJobId(_jobId: string) { return actum },
    async findExpired() { return [] as Actum[] },
  }
}

// ── Fake Express req/res ──────────────────────────────────────────────────────

interface FakeRes {
  statusCode: number
  responseBody: unknown
  status(code: number): FakeRes
  json(body: unknown): void
}

function makeFakeRes(): FakeRes {
  const res: FakeRes = {
    statusCode: 200,
    responseBody: null,
    status(code) {
      res.statusCode = code
      return res
    },
    json(body) {
      res.responseBody = body
    },
  }
  return res
}

// Simulate what the router does: call handleExecutionWebhook with extracted req
// fields, then res.status(result.status).json(result.body).
// This tests the router's wiring logic without spinning up an HTTP server.

import { createWebhookRouter } from '../../../src/api/webhooks/webhookRouter.js'
import type { WebhookRouterDeps } from '../../../src/api/webhooks/webhookRouter.js'

// ── Helper to invoke the /runpod route handler ────────────────────────────────

async function callRunpodRoute(
  deps: WebhookRouterDeps,
  body: unknown,
  options: { rawBody?: string; signature?: string } = {},
): Promise<FakeRes> {
  const router = createWebhookRouter(deps)

  // Find the POST /runpod route handler by peeking at router.stack
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const stack = (router as any).stack as Array<{ route?: { path: string; stack: Array<{ handle: Function }> } }>
  const routeLayer = stack.find(l => l.route?.path === '/runpod')
  assert.ok(routeLayer, 'POST /runpod route not found on router')

  const handler = routeLayer.route!.stack[0].handle

  const rawBody = options.rawBody ?? JSON.stringify(body)
  const req = {
    body,
    rawBody,
    headers: {
      'x-webhook-secret': options.signature,
    } as Record<string, string | undefined>,
  }

  const res = makeFakeRes()
  await handler(req, res)
  return res
}

// ── Tests ─────────────────────────────────────────────────────────────────────

// 1. POST /runpod with COMPLETED payload returns 200 and calls completor.complete
test('POST /runpod with COMPLETED payload returns 200 and calls completor.complete', async () => {
  const actum = makeActum()
  const completor = makeCompletor()
  const deps: WebhookRouterDeps = {
    actorum: makeActorum(actum),
    completor,
  }

  const body = { id: 'job-router-abc', status: 'COMPLETED', output: [{ url: 'https://example.com/out.png' }], executionTime: 3000 }
  const res = await callRunpodRoute(deps, body)

  assert.equal(res.statusCode, 200)
  assert.deepEqual((res.responseBody as { success: boolean }).success, true)
  assert.equal(completor.completed.length, 1)
  assert.equal(completor.completed[0].actumId, 'actum-router-1')
})

// 2. POST /runpod with FAILED payload returns 200 and calls completor.fail
test('POST /runpod with FAILED payload returns 200 and calls completor.fail', async () => {
  const actum = makeActum()
  const completor = makeCompletor()
  const deps: WebhookRouterDeps = {
    actorum: makeActorum(actum),
    completor,
  }

  const body = { id: 'job-router-abc', status: 'FAILED', error: 'GPU OOM' }
  const res = await callRunpodRoute(deps, body)

  assert.equal(res.statusCode, 200)
  assert.deepEqual((res.responseBody as { success: boolean }).success, true)
  assert.equal(completor.failed.length, 1)
  assert.equal(completor.failed[0].error, 'GPU OOM')
})

// 3. POST /runpod with missing id returns 400
test('POST /runpod with missing id returns 400', async () => {
  const actum = makeActum()
  const completor = makeCompletor()
  const deps: WebhookRouterDeps = {
    actorum: makeActorum(actum),
    completor,
  }

  const body = { status: 'COMPLETED', output: [] }
  const res = await callRunpodRoute(deps, body)

  assert.equal(res.statusCode, 400)
  assert.equal((res.responseBody as { success: boolean }).success, false)
})

// 4. POST /runpod with unknown externusJobId returns 404
test('POST /runpod with unknown externusJobId returns 404', async () => {
  const completor = makeCompletor()
  const deps: WebhookRouterDeps = {
    actorum: makeActorum(null),
    completor,
  }

  const body = { id: 'job-does-not-exist', status: 'COMPLETED', output: [] }
  const res = await callRunpodRoute(deps, body)

  assert.equal(res.statusCode, 404)
  assert.equal((res.responseBody as { success: boolean }).success, false)
})
