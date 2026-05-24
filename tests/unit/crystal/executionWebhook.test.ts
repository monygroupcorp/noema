import { test } from 'node:test'
import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import { handleExecutionWebhook } from '../../../src/api/webhooks/executionWebhook.js'
import type { ExecutionWebhookDeps, WebhookRequest } from '../../../src/api/webhooks/executionWebhook.js'
import type { Actum } from '../../../src/types/actum.js'
import { MemoryModo } from '../../../src/execution/MemoryModo.js'
import type { Exitus } from '../../../src/types/cursus.js'
import type { Modus } from '../../../src/types/modus.js'
import { Nexus } from '../../../src/ledger/Nexus.js'
import { MemorySignorum } from '../../../src/ledger/MemorySignorum.js'
import { MemoryModorum } from '../../../src/execution/MemoryModorum.js'
import { MemoryActorum } from '../../../src/execution/MemoryActorum.js'
import { hostCutHook } from '../../../src/ledger/hooks/hostCut.js'
import { spellRoyaltyHook } from '../../../src/ledger/hooks/spellRoyalty.js'
import { modelRoyaltyHook } from '../../../src/ledger/hooks/modelRoyalty.js'
import { platformSkimHook } from '../../../src/ledger/hooks/platformSkim.js'

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeActum(overrides: Partial<Actum> = {}): Actum {
  return {
    id: 'actum-test-1',
    modusId: 'runmake.flux-schnell',
    modusVersiono: '1.0.0',
    // Reservation upper-bound. Phase B added a cap in ActumCompletor: the
    // settled impetus is never above this. The default needs to comfortably
    // cover anything any test reports via executionTime; otherwise the cap
    // squashes the spend to 0 and downstream hooks see no impetus to royalty-tax.
    impetus: 100_000n,
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
      // Mirror the real ActumCompletor: settles actum.impetus to the
      // dispatch-stamped finalImpetus when present, else the reported impetus,
      // capped at the reservation. Hooks downstream read `completed.impetus`
      // and would see stale data if we left the reservation untouched.
      const reported = exitus.impetus
      const dispatched = actum.executio?.finalImpetus
      const raw = dispatched ?? reported
      const settled = raw > actum.impetus ? actum.impetus : raw
      return { ...actum, status: 'completus' as const, impetus: settled }
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
  // The webhook normalizes RunPod output items into a typed exitus shape: any
  // single .png URL becomes `{imageUrl}`; videos/audio land under their own keys.
  // (Multi-image runs add imageUrl2, imageUrl3, …)
  assert.deepEqual(completor.completed[0].exitus.exitus, { imageUrl: 'https://example.com/out.png' })
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
    exitus: { imageUrl: 'https://example.com/out.png' },
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

// ── Ledger integration — real Nexus + hooks + MemorySignorum + MemoryModorum ──
//
// These tests use the real Nexus class with real hooks registered, MemorySignorum,
// MemoryModorum, and MemoryActorum. No mocks at this layer — seams live only at
// the completor and flowRouter boundaries (those are tested independently).

const TEST_MODUS: Modus = {
  id: 'runmake.flux-schnell',
  nomen: 'Flux Schnell',
  genus: 'atomicus',
  versio: '1.0.0',
  contentHash: 'test-hash',
  aditus: {},
  exitus: {},
  canonica: true,
  auctor: 'anima-flux-author',
  natum: new Date(),
  mutatum: new Date(),
}

function makeLedgerDeps() {
  const nexus = new Nexus()
  nexus.on('execution_spend', hostCutHook)
  nexus.on('execution_spend', spellRoyaltyHook)
  nexus.on('execution_spend', modelRoyaltyHook)
  nexus.on('royalty_fired', platformSkimHook)
  return {
    nexus,
    signorum: new MemorySignorum(),
    modorum: new MemoryModorum(),
    actorum: new MemoryActorum(),
  }
}

async function seedActum(actorum: MemoryActorum, actum: Actum): Promise<void> {
  const { inceptum: _, ...input } = actum
  await actorum.create(input)
}

// 17. spellRoyalty signum issued to modus auctor on COMPLETED
test('COMPLETED with spell author — spellRoyalty signum issued to auctor', async () => {
  const { nexus, signorum, modorum, actorum } = makeLedgerDeps()
  await modorum.register({ ...TEST_MODUS })
  await seedActum(actorum, makeActum())

  const deps: ExecutionWebhookDeps = {
    actorum, completor: makeCompletor(), nexus, signorum, modorum,
  }
  // 200s → 200n impetus; spellRoyalty = 10% = 20n
  await handleExecutionWebhook(makeReq({ id: 'job-abc-123', status: 'COMPLETED', output: [], executionTime: 200_000 }), deps)

  const signa = await signorum.history({ animaId: 'anima-flux-author' })
  assert.equal(signa.length, 1)
  assert.equal(signa[0].forma, 'reward')
  assert.equal(signa[0].valor, 20n)
  assert.equal(signa[0].auctor, 'nexus:spellRoyalty')
})

// 18. platformSkim signum issued to platform after royalty fires
test('platformSkim signum issued when spellRoyalty produces a signum', async () => {
  const { nexus, signorum, modorum, actorum } = makeLedgerDeps()
  await modorum.register({ ...TEST_MODUS })
  await seedActum(actorum, makeActum())

  const deps: ExecutionWebhookDeps = {
    actorum, completor: makeCompletor(), nexus, signorum, modorum,
  }
  await handleExecutionWebhook(makeReq({ id: 'job-abc-123', status: 'COMPLETED', output: [], executionTime: 200_000 }), deps)

  // platformSkim = 5% of baseValor(200n impetus) = 10n
  const platformId = process.env.PLATFORM_ANIMA_ID ?? 'platform'
  const signa = await signorum.history({ animaId: platformId })
  assert.equal(signa.length, 1)
  assert.equal(signa[0].forma, 'reward')
  assert.equal(signa[0].valor, 10n)
  assert.equal(signa[0].auctor, 'nexus:platformSkim')
})

// 19. No signa when modus has no auctor — royalty_fired also not triggered
test('no signa issued when modus has no auctor', async () => {
  const { nexus, signorum, modorum, actorum } = makeLedgerDeps()
  await modorum.register({ ...TEST_MODUS, auctor: undefined })
  await seedActum(actorum, makeActum())

  const deps: ExecutionWebhookDeps = {
    actorum, completor: makeCompletor(), nexus, signorum, modorum,
  }
  await handleExecutionWebhook(makeReq({ id: 'job-abc-123', status: 'COMPLETED', output: [], executionTime: 200_000 }), deps)

  const authorSigna = await signorum.history({ animaId: 'anima-flux-author' })
  assert.equal(authorSigna.length, 0)
  const platformSigna = await signorum.history({ animaId: process.env.PLATFORM_ANIMA_ID ?? 'platform' })
  assert.equal(platformSigna.length, 0)
})

// 20. No signa issued on FAILED
test('no signa issued on FAILED', async () => {
  const { nexus, signorum, modorum, actorum } = makeLedgerDeps()
  await modorum.register({ ...TEST_MODUS })
  await seedActum(actorum, makeActum())

  const deps: ExecutionWebhookDeps = {
    actorum, completor: makeCompletor(), nexus, signorum, modorum,
  }
  const result = await handleExecutionWebhook(makeReq({ id: 'job-abc-123', status: 'FAILED', error: 'OOM' }), deps)

  assert.equal(result.status, 200)
  const signa = await signorum.history({ animaId: 'anima-flux-author' })
  assert.equal(signa.length, 0)
})

// 21. No signa issued on CANCELLED
test('no signa issued on CANCELLED', async () => {
  const { nexus, signorum, modorum, actorum } = makeLedgerDeps()
  await modorum.register({ ...TEST_MODUS })
  await seedActum(actorum, makeActum())

  const deps: ExecutionWebhookDeps = {
    actorum, completor: makeCompletor(), nexus, signorum, modorum,
  }
  const result = await handleExecutionWebhook(makeReq({ id: 'job-abc-123', status: 'CANCELLED' }), deps)

  assert.equal(result.status, 200)
  const signa = await signorum.history({ animaId: 'anima-flux-author' })
  assert.equal(signa.length, 0)
})

// 22. Missing nexus dep is a no-op (backward compat)
test('missing nexus dep is a no-op — request still succeeds', async () => {
  const actum = makeActum()
  const completor = makeCompletor()
  const deps: ExecutionWebhookDeps = {
    actorum: makeActorum(actum),
    completor,
  }
  const body = { id: 'job-abc-123', status: 'COMPLETED', output: [], executionTime: 1000 }
  const result = await handleExecutionWebhook(makeReq(body), deps)

  assert.equal(result.status, 200)
  assert.equal(result.body.success, true)
  assert.equal(completor.completed.length, 1)
})

// ── Modo session spend ────────────────────────────────────────────────────────

// 23. COMPLETED webhook updates impetusAccrued on the modo for async jobs
test('COMPLETED updates modo impetusAccrued when actum has modoId', async () => {
  const modos = new MemoryModo()
  const modo = await modos.create({ status: 'active', impetusAccrued: 100n, acta: [], idleWarmthSec: 300 })
  const actum = makeActum({ modoId: modo.id })
  const deps: ExecutionWebhookDeps = {
    actorum: makeActorum(actum),
    completor: makeCompletor(),
    modos,
  }

  await handleExecutionWebhook(makeReq({ id: 'job-abc-123', status: 'COMPLETED', output: [], executionTime: 60_000 }), deps)

  const updated = await modos.findById(modo.id)
  // executionTime 60_000ms → impetus = ceil(60_000 / 1000) = 60; 100 + 60 = 160
  assert.equal(updated?.impetusAccrued, 160n)
})

// 24. COMPLETED without modos dep is a no-op — does not throw
test('COMPLETED without modos dep succeeds when actum has modoId', async () => {
  const actum = makeActum({ modoId: 'modo-xyz' })
  const deps: ExecutionWebhookDeps = {
    actorum: makeActorum(actum),
    completor: makeCompletor(),
  }
  const result = await handleExecutionWebhook(makeReq({ id: 'job-abc-123', status: 'COMPLETED', output: [], executionTime: 5000 }), deps)
  assert.equal(result.status, 200)
})

// 25. COMPLETED for actum without modoId leaves modos untouched
test('COMPLETED for actum without modoId does not update any modo', async () => {
  const modos = new MemoryModo()
  const modo = await modos.create({ status: 'active', impetusAccrued: 50n, acta: [], idleWarmthSec: 300 })
  const actum = makeActum()  // no modoId
  const deps: ExecutionWebhookDeps = {
    actorum: makeActorum(actum),
    completor: makeCompletor(),
    modos,
  }

  await handleExecutionWebhook(makeReq({ id: 'job-abc-123', status: 'COMPLETED', output: [], executionTime: 10_000 }), deps)

  const unchanged = await modos.findById(modo.id)
  assert.equal(unchanged?.impetusAccrued, 50n)
})
