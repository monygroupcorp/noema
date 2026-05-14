import { test } from 'node:test'
import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import { handleExecutionWebhook } from '../../../src/api/webhooks/executionWebhook.js'
import type { ExecutionWebhookDeps, WebhookRequest } from '../../../src/api/webhooks/executionWebhook.js'
import type { Actum } from '../../../src/types/actum.js'
import type { Exitus } from '../../../src/types/cursus.js'
import type { Nexus, SignumEvent, SignumEventType } from '../../../src/types/nexus.js'
import type { Signum, Signorum } from '../../../src/types/significandi.js'

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeActum(overrides: Partial<Actum> = {}): Actum {
  return {
    id: 'actum-test-1',
    modusId: 'runmake.flux-schnell',
    modusVersiono: '1.0.0',
    impetus: 0n,
    signaConsumed: [],
    aditus: { prompt: 'a cat' },
    status: 'nascens',
    inceptum: new Date(),
    expirat: new Date(Date.now() + 60_000),
    externusJobId: 'job-abc-123',
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

function makeReq(body: unknown, overrides: Partial<WebhookRequest> = {}): WebhookRequest {
  const rawBody = JSON.stringify(body)
  return { body, rawBody, ...overrides }
}

function sign(secret: string, rawBody: string): string {
  return crypto.createHmac('sha256', secret).update(rawBody).digest('hex')
}

// ── Tests ─────────────────────────────────────────────────────────────────────

// 1. Valid COMPLETED payload → calls completor.complete() with correct exitus, returns 200
test('COMPLETED payload calls completor.complete and returns 200', async () => {
  const actum = makeActum()
  const completor = makeCompletor()
  const deps: ExecutionWebhookDeps = {
    actorum: makeActorum(actum),
    completor,
  }
  const body = { id: 'job-abc-123', status: 'COMPLETED', output: [{ url: 'https://example.com/out.png' }], executionTime: 5000 }
  const result = await handleExecutionWebhook(makeReq(body), deps)

  assert.equal(result.status, 200)
  assert.equal(result.body.success, true)
  assert.equal(completor.completed.length, 1)
  assert.equal(completor.completed[0].actumId, 'actum-test-1')
  assert.deepEqual(completor.completed[0].exitus.exitus, { outputs: [{ url: 'https://example.com/out.png' }] })
})

// 2. Valid FAILED payload → calls completor.fail(), returns 200
test('FAILED payload calls completor.fail and returns 200', async () => {
  const actum = makeActum()
  const completor = makeCompletor()
  const deps: ExecutionWebhookDeps = { actorum: makeActorum(actum), completor }
  const body = { id: 'job-abc-123', status: 'FAILED', error: 'GPU OOM' }
  const result = await handleExecutionWebhook(makeReq(body), deps)

  assert.equal(result.status, 200)
  assert.equal(result.body.success, true)
  assert.equal(completor.failed.length, 1)
  assert.equal(completor.failed[0].error, 'GPU OOM')
})

// 3. CANCELLED payload → calls completor.fail(), returns 200
test('CANCELLED payload calls completor.fail and returns 200', async () => {
  const actum = makeActum()
  const completor = makeCompletor()
  const deps: ExecutionWebhookDeps = { actorum: makeActorum(actum), completor }
  const body = { id: 'job-abc-123', status: 'CANCELLED' }
  const result = await handleExecutionWebhook(makeReq(body), deps)

  assert.equal(result.status, 200)
  assert.equal(result.body.success, true)
  assert.equal(completor.failed.length, 1)
  assert.equal(completor.failed[0].error, 'Job failed')
})

// 4. IN_PROGRESS payload → no complete/fail called, returns 200
test('IN_PROGRESS payload does not call complete or fail, returns 200', async () => {
  const actum = makeActum()
  const completor = makeCompletor()
  const deps: ExecutionWebhookDeps = { actorum: makeActorum(actum), completor }
  const body = { id: 'job-abc-123', status: 'IN_PROGRESS' }
  const result = await handleExecutionWebhook(makeReq(body), deps)

  assert.equal(result.status, 200)
  assert.equal(result.body.success, true)
  assert.equal(completor.completed.length, 0)
  assert.equal(completor.failed.length, 0)
})

// 5. Unknown status → returns 200, no side effects
test('unknown status returns 200 with no side effects', async () => {
  const actum = makeActum()
  const completor = makeCompletor()
  const deps: ExecutionWebhookDeps = { actorum: makeActorum(actum), completor }
  const body = { id: 'job-abc-123', status: 'QUEUED' }
  const result = await handleExecutionWebhook(makeReq(body), deps)

  assert.equal(result.status, 200)
  assert.equal(result.body.success, true)
  assert.equal(completor.completed.length, 0)
  assert.equal(completor.failed.length, 0)
})

// 6. Missing id field → returns 400
test('missing id field returns 400', async () => {
  const actum = makeActum()
  const completor = makeCompletor()
  const deps: ExecutionWebhookDeps = { actorum: makeActorum(actum), completor }
  const body = { status: 'COMPLETED', output: [] }
  const result = await handleExecutionWebhook(makeReq(body), deps)

  assert.equal(result.status, 400)
  assert.equal(result.body.success, false)
})

// 7. externusJobId not found → returns 404
test('externusJobId not found returns 404', async () => {
  const completor = makeCompletor()
  const deps: ExecutionWebhookDeps = { actorum: makeActorum(null), completor }
  const body = { id: 'job-unknown', status: 'COMPLETED', output: [] }
  const result = await handleExecutionWebhook(makeReq(body), deps)

  assert.equal(result.status, 404)
  assert.equal(result.body.success, false)
})

// 8. Invalid HMAC signature → returns 401
test('invalid HMAC signature returns 401', async () => {
  const actum = makeActum()
  const completor = makeCompletor()
  const deps: ExecutionWebhookDeps = {
    actorum: makeActorum(actum),
    completor,
    secret: 'my-secret',
  }
  const body = { id: 'job-abc-123', status: 'COMPLETED', output: [] }
  const req = makeReq(body, { signature: 'deadbeef-wrong-signature' })
  const result = await handleExecutionWebhook(req, deps)

  assert.equal(result.status, 401)
  assert.equal(result.body.success, false)
  assert.match(result.body.message ?? '', /invalid signature/i)
})

// 9. No secret configured → signature validation skipped, processes normally
test('no secret configured skips signature validation and processes request', async () => {
  const actum = makeActum()
  const completor = makeCompletor()
  const deps: ExecutionWebhookDeps = {
    actorum: makeActorum(actum),
    completor,
    // no secret
  }
  const body = { id: 'job-abc-123', status: 'COMPLETED', output: [] }
  // send a request with no signature — should still process
  const result = await handleExecutionWebhook(makeReq(body, { signature: undefined }), deps)

  assert.equal(result.status, 200)
  assert.equal(completor.completed.length, 1)
})

// 10. executionTime → correct bigint impetus computed (ceil to seconds)
test('executionTime 5001ms produces impetus of 6n (ceil)', async () => {
  const actum = makeActum()
  const completor = makeCompletor()
  const deps: ExecutionWebhookDeps = { actorum: makeActorum(actum), completor }
  const body = { id: 'job-abc-123', status: 'COMPLETED', output: [], executionTime: 5001 }
  await handleExecutionWebhook(makeReq(body), deps)

  assert.equal(completor.completed[0].exitus.impetus, 6n)
})

test('executionTime 5000ms produces impetus of 5n (exact)', async () => {
  const actum = makeActum()
  const completor = makeCompletor()
  const deps: ExecutionWebhookDeps = { actorum: makeActorum(actum), completor }
  const body = { id: 'job-abc-123', status: 'COMPLETED', output: [], executionTime: 5000 }
  await handleExecutionWebhook(makeReq(body), deps)

  assert.equal(completor.completed[0].exitus.impetus, 5n)
})

test('missing executionTime defaults to 0n impetus', async () => {
  const actum = makeActum()
  const completor = makeCompletor()
  const deps: ExecutionWebhookDeps = { actorum: makeActorum(actum), completor }
  const body = { id: 'job-abc-123', status: 'COMPLETED', output: [] }
  await handleExecutionWebhook(makeReq(body), deps)

  assert.equal(completor.completed[0].exitus.impetus, 0n)
})

// 11. completor.complete() throws → returns 500
test('completor.complete throwing returns 500', async () => {
  const actum = makeActum()
  const completor = makeCompletor()
  completor.complete = async () => { throw new Error('DB write failed') }
  const deps: ExecutionWebhookDeps = { actorum: makeActorum(actum), completor }
  const body = { id: 'job-abc-123', status: 'COMPLETED', output: [] }
  const result = await handleExecutionWebhook(makeReq(body), deps)

  assert.equal(result.status, 500)
  assert.equal(result.body.success, false)
  assert.match(result.body.message ?? '', /DB write failed/)
})

// 12. Valid HMAC signature is accepted
test('valid HMAC signature is accepted and request processed', async () => {
  const actum = makeActum()
  const completor = makeCompletor()
  const secret = 'super-secret'
  const deps: ExecutionWebhookDeps = {
    actorum: makeActorum(actum),
    completor,
    secret,
  }
  const body = { id: 'job-abc-123', status: 'COMPLETED', output: [] }
  const rawBody = JSON.stringify(body)
  const signature = sign(secret, rawBody)
  const req: WebhookRequest = { body, rawBody, signature }
  const result = await handleExecutionWebhook(req, deps)

  assert.equal(result.status, 200)
  assert.equal(completor.completed.length, 1)
})

// 13. COMPLETED duratio is set from executionTime
test('COMPLETED exitus.duratio is set from executionTime', async () => {
  const actum = makeActum()
  const completor = makeCompletor()
  const deps: ExecutionWebhookDeps = { actorum: makeActorum(actum), completor }
  const body = { id: 'job-abc-123', status: 'COMPLETED', output: [], executionTime: 3500 }
  await handleExecutionWebhook(makeReq(body), deps)

  assert.equal(completor.completed[0].exitus.duratio, 3500)
})

// ── flowRouter tests ──────────────────────────────────────────────────────────

interface FlowRouterCall {
  actumId: string
  result: { kind: 'complete'; exitus: Record<string, unknown> } | { kind: 'failed'; error: string }
}

function makeFlowRouter() {
  const calls: FlowRouterCall[] = []
  return {
    calls,
    async handleActumComplete(
      actumId: string,
      result: { kind: 'complete'; exitus: Record<string, unknown> } | { kind: 'failed'; error: string },
    ): Promise<void> {
      calls.push({ actumId, result })
    },
  }
}

// 14. flowRouter.handleActumComplete is called with complete result when COMPLETED
test('flowRouter.handleActumComplete is called with complete result when COMPLETED', async () => {
  const actum = makeActum()
  const completor = makeCompletor()
  const flowRouter = makeFlowRouter()
  const deps: ExecutionWebhookDeps = {
    actorum: makeActorum(actum),
    completor,
    flowRouter,
  }
  const body = {
    id: 'job-abc-123',
    status: 'COMPLETED',
    output: [{ url: 'https://example.com/out.png' }],
    executionTime: 5000,
  }
  const result = await handleExecutionWebhook(makeReq(body), deps)

  assert.equal(result.status, 200)
  assert.equal(flowRouter.calls.length, 1)
  assert.equal(flowRouter.calls[0].actumId, 'actum-test-1')
  assert.deepEqual(flowRouter.calls[0].result, {
    kind: 'complete',
    exitus: { outputs: [{ url: 'https://example.com/out.png' }] },
  })
})

// 15. flowRouter.handleActumComplete is called with failed result when FAILED
test('flowRouter.handleActumComplete is called with failed result when FAILED', async () => {
  const actum = makeActum()
  const completor = makeCompletor()
  const flowRouter = makeFlowRouter()
  const deps: ExecutionWebhookDeps = {
    actorum: makeActorum(actum),
    completor,
    flowRouter,
  }
  const body = { id: 'job-abc-123', status: 'FAILED', error: 'Job failed' }
  const result = await handleExecutionWebhook(makeReq(body), deps)

  assert.equal(result.status, 200)
  assert.equal(flowRouter.calls.length, 1)
  assert.equal(flowRouter.calls[0].actumId, 'actum-test-1')
  assert.deepEqual(flowRouter.calls[0].result, { kind: 'failed', error: 'Job failed' })
})

// 16. flowRouter is optional — works fine when absent
test('flowRouter is optional — works fine when absent', async () => {
  const actum = makeActum()
  const completor = makeCompletor()
  const deps: ExecutionWebhookDeps = {
    actorum: makeActorum(actum),
    completor,
    // no flowRouter
  }
  const body = { id: 'job-abc-123', status: 'COMPLETED', output: [] }
  const result = await handleExecutionWebhook(makeReq(body), deps)

  assert.equal(result.status, 200)
  assert.equal(result.body.success, true)
})

// ── Nexus tests ───────────────────────────────────────────────────────────────

interface NexusMock {
  emitted: Array<SignumEvent<SignumEventType>>
  returnSigna: Array<Omit<Signum, 'id' | 'natum' | 'status'>>
  emit<T extends SignumEventType>(event: SignumEvent<T>): Promise<Array<Omit<Signum, 'id' | 'natum' | 'status'>>>
  on<T extends SignumEventType>(type: T, hook: unknown): void
}

function makeNexus(returnSigna: Array<Omit<Signum, 'id' | 'natum' | 'status'>> = []): NexusMock {
  const mock: NexusMock = {
    emitted: [],
    returnSigna,
    async emit(event) {
      mock.emitted.push(event as SignumEvent<SignumEventType>)
      return returnSigna
    },
    on() {},
  }
  return mock
}

interface SignorumMock {
  created: Array<Array<Omit<Signum, 'id' | 'natum' | 'status'>>>
  createMany(signa: Array<Omit<Signum, 'id' | 'natum' | 'status'>>): Promise<Signum[]>
}

function makeSignorum(): SignorumMock {
  const mock: SignorumMock = {
    created: [],
    async createMany(signa) {
      mock.created.push(signa)
      return signa.map((s, i) => ({ ...s, id: `signum-${i}`, natum: new Date(), status: 'valid' as const }))
    },
  }
  return mock
}

// 17. Nexus emit is called with correct actum and impetus on COMPLETED
test('nexus.emit is called with correct actum and impetus on COMPLETED', async () => {
  const actum = makeActum()
  const completor = makeCompletor()
  const nexus = makeNexus()
  const signorum = makeSignorum()
  const deps: ExecutionWebhookDeps = {
    actorum: makeActorum(actum),
    completor,
    nexus: nexus as unknown as Nexus,
    signorum: signorum as unknown as Signorum,
  }
  const body = { id: 'job-abc-123', status: 'COMPLETED', output: [], executionTime: 3000 }
  const result = await handleExecutionWebhook(makeReq(body), deps)

  assert.equal(result.status, 200)
  assert.equal(nexus.emitted.length, 1)
  const event = nexus.emitted[0]
  assert.equal(event.type, 'execution_spend')
  const payload = event.payload as { actum: Actum; impetus: bigint }
  assert.equal(payload.actum.id, 'actum-test-1')
  assert.equal(payload.actum.status, 'completus')
  assert.equal(payload.impetus, 3n)
})

// 18. Returned signa trigger royalty_fired chain; all land in one createMany
test('signa returned by nexus.emit trigger royalty_fired and all land in one createMany', async () => {
  const actum = makeActum()
  const completor = makeCompletor()
  const hookSigna: Array<Omit<Signum, 'id' | 'natum' | 'status'>> = [
    { forma: 'reward', valor: 50n, auctor: 'hook:hostCut', animaId: 'anima-host' },
    { forma: 'reward', valor: 10n, auctor: 'hook:spellRoyalty', animaId: 'anima-author' },
  ]
  const nexus = makeNexus(hookSigna)
  const signorum = makeSignorum()
  const deps: ExecutionWebhookDeps = {
    actorum: makeActorum(actum),
    completor,
    nexus: nexus as unknown as Nexus,
    signorum: signorum as unknown as Signorum,
  }
  const body = { id: 'job-abc-123', status: 'COMPLETED', output: [], executionTime: 2000 }
  await handleExecutionWebhook(makeReq(body), deps)

  // execution_spend fires, then royalty_fired since hooks produced signa
  assert.equal(nexus.emitted.length, 2)
  assert.equal(nexus.emitted[0].type, 'execution_spend')
  assert.equal(nexus.emitted[1].type, 'royalty_fired')
  const royaltyPayload = nexus.emitted[1].payload as { royaltyValor: bigint; baseValor: bigint }
  assert.equal(royaltyPayload.royaltyValor, 60n)  // 50 + 10
  assert.equal(royaltyPayload.baseValor, 2n)       // 2000ms → 2 impetus

  // Both execution_spend and royalty_fired signa land in one createMany call
  assert.equal(signorum.created.length, 1)
  assert.equal(signorum.created[0].length, 4)  // 2 royalty + 2 skim (mock returns same signa)
  assert.equal(signorum.created[0][0].auctor, 'hook:hostCut')
  assert.equal(signorum.created[0][1].auctor, 'hook:spellRoyalty')
})

// 19. signorum.createMany is NOT called when nexus returns no signa
test('signorum.createMany is not called when nexus returns empty signa', async () => {
  const actum = makeActum()
  const completor = makeCompletor()
  const nexus = makeNexus([]) // empty — no hooks produced signa
  const signorum = makeSignorum()
  const deps: ExecutionWebhookDeps = {
    actorum: makeActorum(actum),
    completor,
    nexus: nexus as unknown as Nexus,
    signorum: signorum as unknown as Signorum,
  }
  const body = { id: 'job-abc-123', status: 'COMPLETED', output: [] }
  await handleExecutionWebhook(makeReq(body), deps)

  assert.equal(signorum.created.length, 0)
})

// 20. Nexus is NOT called on FAILED
test('nexus.emit is NOT called on FAILED', async () => {
  const actum = makeActum()
  const completor = makeCompletor()
  const nexus = makeNexus()
  const signorum = makeSignorum()
  const deps: ExecutionWebhookDeps = {
    actorum: makeActorum(actum),
    completor,
    nexus: nexus as unknown as Nexus,
    signorum: signorum as unknown as Signorum,
  }
  const body = { id: 'job-abc-123', status: 'FAILED', error: 'OOM' }
  const result = await handleExecutionWebhook(makeReq(body), deps)

  assert.equal(result.status, 200)
  assert.equal(nexus.emitted.length, 0)
  assert.equal(signorum.created.length, 0)
})

// 21. Nexus is NOT called on CANCELLED
test('nexus.emit is NOT called on CANCELLED', async () => {
  const actum = makeActum()
  const completor = makeCompletor()
  const nexus = makeNexus()
  const signorum = makeSignorum()
  const deps: ExecutionWebhookDeps = {
    actorum: makeActorum(actum),
    completor,
    nexus: nexus as unknown as Nexus,
    signorum: signorum as unknown as Signorum,
  }
  const body = { id: 'job-abc-123', status: 'CANCELLED' }
  const result = await handleExecutionWebhook(makeReq(body), deps)

  assert.equal(result.status, 200)
  assert.equal(nexus.emitted.length, 0)
  assert.equal(signorum.created.length, 0)
})

// 22. Missing nexus dep is a no-op (backward compat)
test('missing nexus dep is a no-op — request still succeeds', async () => {
  const actum = makeActum()
  const completor = makeCompletor()
  const deps: ExecutionWebhookDeps = {
    actorum: makeActorum(actum),
    completor,
    // no nexus, no signorum
  }
  const body = { id: 'job-abc-123', status: 'COMPLETED', output: [], executionTime: 1000 }
  const result = await handleExecutionWebhook(makeReq(body), deps)

  assert.equal(result.status, 200)
  assert.equal(result.body.success, true)
  assert.equal(completor.completed.length, 1)
})
