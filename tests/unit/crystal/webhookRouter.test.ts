import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { Actum } from '../../../src/types/actum.js'
import type { Actorum, Exitus } from '../../../src/types/cursus.js'

// ── Helpers (copied from executionWebhook.test.ts pattern) ───────────────────

function makeActum(overrides: Partial<Actum> = {}): Actum {
  return {
    id: 'actum-router-1',
    modusId: 'flux-schnell',
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

/**
 * `actum` is what the reported job id resolves to (as before). `others` are additional acta the
 * store knows about, so a nonce can be made to resolve to a DIFFERENT actum than the job id does.
 */
function makeActorum(actum: Actum | null, others: Actum[] = []): Actorum {
  const all = [...(actum ? [actum] : []), ...others]
  return {
    async create(a: Omit<Actum, 'inceptum'>) { return { ...a, inceptum: new Date() } as Actum },
    async update(_id: string, _patch: Partial<Actum>) { return actum! },
    async findById(_id: string) { return actum },
    async findByExternusJobId(_jobId: string) { return actum },
    async findByCallbackNonce(nonce: string) { return all.find(a => a.callbackNonce === nonce) ?? null },
    async findExpired() { return [] as Actum[] },
    async findByNullifier() { throw new Error('findByNullifier is not exercised by this suite') },
    async findInFlight() { throw new Error('findInFlight is not exercised by this suite') },
    async findByCompositum() { throw new Error('findByCompositum is not exercised by this suite') },
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
  options: { rawBody?: string; signature?: string; nonce?: string } = {},
): Promise<FakeRes> {
  const router = createWebhookRouter(deps)

  // Find the route handler by peeking at router.stack. With a nonce we exercise the
  // nonce-bearing route (and hand it the path param Express would have parsed).
  const path = options.nonce === undefined ? '/runpod' : '/runpod/:nonce'
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const stack = (router as any).stack as Array<{ route?: { path: string; stack: Array<{ handle: Function }> } }>
  const routeLayer = stack.find(l => l.route?.path === path)
  assert.ok(routeLayer, `POST ${path} route not found on router`)

  const handler = routeLayer.route!.stack[0].handle

  const rawBody = options.rawBody ?? JSON.stringify(body)
  const req = {
    body,
    rawBody,
    params: options.nonce === undefined ? {} : { nonce: options.nonce },
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

// ── Callback admission: the nonce binds a callback to the job it reports ───────

// 5. Matching nonce → completes exactly as the nonce-less route did.
test('POST /runpod/:nonce with the actum\'s own nonce completes the run', async () => {
  const actum = makeActum({ callbackNonce: 'nonce-A' })
  const completor = makeCompletor()
  const deps: WebhookRouterDeps = { actorum: makeActorum(actum), completor }

  const body = { id: 'job-router-abc', status: 'COMPLETED', output: [{ url: 'https://example.com/out.png' }], executionTime: 3000 }
  const res = await callRunpodRoute(deps, body, { nonce: 'nonce-A' })

  assert.equal(res.statusCode, 200)
  assert.equal(completor.completed.length, 1)
  assert.equal(completor.completed[0].actumId, 'actum-router-1')
})

// 6. Unknown nonce → refused, and nothing is completed or failed.
test('POST /runpod/:nonce with an unknown nonce is refused and completes nothing', async () => {
  const actum = makeActum({ callbackNonce: 'nonce-A' })
  const completor = makeCompletor()
  const deps: WebhookRouterDeps = { actorum: makeActorum(actum), completor }

  const body = { id: 'job-router-abc', status: 'COMPLETED', output: [{ url: 'https://example.com/out.png' }], executionTime: 3000 }
  const res = await callRunpodRoute(deps, body, { nonce: 'not-a-real-nonce' })

  assert.equal(res.statusCode, 404)
  assert.equal((res.responseBody as { success: boolean }).success, false)
  assert.equal(completor.completed.length, 0)
  assert.equal(completor.failed.length, 0)
})

// 7. A nonce belonging to one run, presented with another run's job id → refused.
test('POST /runpod/:nonce refuses a nonce that resolves to a different actum than the job id', async () => {
  const reported = makeActum({ id: 'actum-A', callbackNonce: 'nonce-A' })
  const other = makeActum({ id: 'actum-B', externusJobId: 'job-router-B', callbackNonce: 'nonce-B' })
  const completor = makeCompletor()
  const deps: WebhookRouterDeps = { actorum: makeActorum(reported, [other]), completor }

  // Job id resolves to actum-A; the presented nonce belongs to actum-B.
  const body = { id: 'job-router-abc', status: 'COMPLETED', output: [{ url: 'https://example.com/out.png' }], executionTime: 3000 }
  const res = await callRunpodRoute(deps, body, { nonce: 'nonce-B' })

  assert.equal(res.statusCode, 404)
  assert.equal(completor.completed.length, 0)
  assert.equal(completor.failed.length, 0)
})

// 8. Migration: a run dispatched before the nonce existed still completes on the nonce-less route.
test('POST /runpod still completes a run that carries no nonce', async () => {
  const actum = makeActum()   // no callbackNonce — dispatched before the nonce existed
  const completor = makeCompletor()
  const deps: WebhookRouterDeps = { actorum: makeActorum(actum), completor }

  const body = { id: 'job-router-abc', status: 'COMPLETED', output: [{ url: 'https://example.com/out.png' }], executionTime: 3000 }
  const res = await callRunpodRoute(deps, body)

  assert.equal(res.statusCode, 200)
  assert.equal(completor.completed.length, 1)
})

// 9. …but a run that HAS a nonce cannot be completed over the nonce-less route.
test('POST /runpod refuses a run that carries a nonce', async () => {
  const actum = makeActum({ callbackNonce: 'nonce-A' })
  const completor = makeCompletor()
  const deps: WebhookRouterDeps = { actorum: makeActorum(actum), completor }

  const body = { id: 'job-router-abc', status: 'COMPLETED', output: [{ url: 'https://example.com/out.png' }], executionTime: 3000 }
  const res = await callRunpodRoute(deps, body)

  assert.equal(res.statusCode, 404)
  assert.equal((res.responseBody as { success: boolean }).success, false)
  assert.equal(completor.completed.length, 0)
  assert.equal(completor.failed.length, 0)
})

// 10. A FAILED payload cannot be forged onto a run either — refusal precedes `fail`.
test('POST /runpod/:nonce with a wrong nonce cannot fail a run', async () => {
  const actum = makeActum({ callbackNonce: 'nonce-A' })
  const completor = makeCompletor()
  const deps: WebhookRouterDeps = { actorum: makeActorum(actum), completor }

  const res = await callRunpodRoute(deps, { id: 'job-router-abc', status: 'FAILED', error: 'GPU OOM' }, { nonce: 'wrong' })

  assert.equal(res.statusCode, 404)
  assert.equal(completor.failed.length, 0)
})
