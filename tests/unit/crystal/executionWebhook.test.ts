import { test } from 'node:test'
import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import { handleExecutionWebhook } from '../../../src/api/webhooks/executionWebhook.js'
import type { ExecutionWebhookDeps, WebhookRequest } from '../../../src/api/webhooks/executionWebhook.js'
import type { Actum } from '../../../src/types/actum.js'
import { MemoryModo } from '../../../src/execution/MemoryModo.js'
import type { Actorum, Exitus } from '../../../src/types/cursus.js'
import type { Modus } from '../../../src/types/modus.js'
import { Nexus } from '../../../src/ledger/Nexus.js'
import { MemorySignorum } from '../../../src/ledger/MemorySignorum.js'
import { MemoryModorum } from '../../../src/execution/MemoryModorum.js'
import { MemoryActorum } from '../../../src/execution/MemoryActorum.js'
import { hostCutHook } from '../../../src/ledger/hooks/hostCut.js'
import { spellRoyaltyHook } from '../../../src/ledger/hooks/spellRoyalty.js'
import { modelRoyaltyHook } from '../../../src/ledger/hooks/modelRoyalty.js'
import { platformSkimHook } from '../../../src/ledger/hooks/platformSkim.js'
import { makeTrainingFinalizer, urlLoraReader, makeTrainingExitusResolver } from '../../../src/crystal/trainingFinalizer.js'
import type { Modorum } from '../../../src/types/modus.js'
import type { Intella } from '../../../src/types/intelligendi.js'
import type { ActumIndex } from '../../../src/types/actumIndex.js'
import { impetusFor } from '../../../src/ledger/rates.js'
import type { HospitiumStore } from '../../../src/types/hospitium.js'
import type { AuctorKey } from '../../../src/flow/types.js'

function makeModorum(modus: Modus): Modorum {
  return {
    async find() { return modus },
    async register() {},
    async list() { return [modus] },
    async update() { return modus },
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeActum(overrides: Partial<Actum> = {}): Actum {
  return {
    id: 'actum-test-1',
    modusId: 'flux-schnell',
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

type TestAuctorKey = { animaId: string } | { commitment: string } | { bursaToken: string }

interface CompletorMock {
  completed: Array<{ actumId: string; exitus: Exitus; auctor?: TestAuctorKey }>
  failed: Array<{ actumId: string; error: string }>
  complete(actum: Actum, exitus: Exitus, auctor?: TestAuctorKey): Promise<Actum>
  fail(actum: Actum, error: string): Promise<Actum>
}

function makeCompletor(): CompletorMock {
  const mock: CompletorMock = {
    completed: [],
    failed: [],
    async complete(actum, exitus, auctor) {
      mock.completed.push({ actumId: actum.id, exitus, auctor })
      // Mirror the real ActumCompletor (post-167): settle on the MEASURED cost —
      // the cursor's reported impetus is the base, the guest warm surcharge
      // applies when the dispatch stamp carries a guest tier, and the total caps
      // at the reservation. Write executio.baseImpetus/finalImpetus back onto the
      // actum, same as the real completor, so hook payloads downstream read the
      // real basis instead of whatever the fixture happened to stamp at dispatch.
      const tier = actum.executio?.pricingTier
      const baseImpetus = exitus.impetus
      const finalImpetus = tier ? impetusFor(tier, baseImpetus) : baseImpetus
      const settled = finalImpetus > actum.impetus ? actum.impetus : finalImpetus
      return {
        ...actum,
        status: 'completus' as const,
        impetus: settled,
        executio: { ...(actum.executio ?? {}), baseImpetus, finalImpetus: settled },
      }
    },
    async fail(actum, error) {
      mock.failed.push({ actumId: actum.id, error })
      return { ...actum, status: 'fractus' as const }
    },
  }
  return mock
}

function makeActorum(actum: Actum | null): Actorum {
  return {
    async create(a: Omit<Actum, 'inceptum'>) { return { ...a, inceptum: new Date() } as Actum },
    async update(_id: string, _patch: Partial<Actum>) { return actum! },
    async findById(_id: string) { return actum },
    async findByExternusJobId(_jobId: string) { return actum },
    async findExpired() { return [] as Actum[] },
    async findByCallbackNonce() { throw new Error('findByCallbackNonce is not exercised by this suite') },
    async findByNullifier() { throw new Error('findByNullifier is not exercised by this suite') },
    async findInFlight() { throw new Error('findInFlight is not exercised by this suite') },
    async findByCompositum() { throw new Error('findByCompositum is not exercised by this suite') },
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
  // The webhook projects RunPod outputs into the flow's DECLARED exitus schema
  // (projectExitus). No modorum here → falls back to the bare media-type name, so a
  // .png lands under `image`. (Schema-keyed cases are covered in projectExitus.test.)
  assert.deepEqual(completor.completed[0].exitus.exitus, { image: 'https://example.com/out.png' })
})

// 1b. A training completion runs finality (host LoRA + register Intella) instead of projectExitus.
test('COMPLETED training payload runs finality and bills real pod-seconds', async () => {
  const actum = makeActum({ modusId: 'modus.aitoolkit-training', aditus: { steps: 600, triggerWord: 'milady', familia: 'flux', ownerAnimaId: 'anima-3' } })
  const completor = makeCompletor()
  const upserts: Intella[] = []
  const puts: string[] = []
  const finalize = makeTrainingFinalizer({
    reader: urlLoraReader({ async fetch(url) { return Buffer.from(`b:${url}`) } }),
    store: { async put(key) { puts.push(key); return `https://cdn/${key}` } },
    intellae: { async upsert(i) { upserts.push(i) } },
    newId: () => 'lora-w',
  })
  const deps: ExecutionWebhookDeps = {
    actorum: makeActorum(actum),
    completor,
    modorum: makeModorum({ id: 'modus.aitoolkit-training', ministerium: 'aitoolkit' } as unknown as Modus),
    resolveExitus: makeTrainingExitusResolver(finalize),
  }
  const body = { id: 'job-abc-123', status: 'COMPLETED', output: [{ url: 'https://pod/outputs/run/milady.safetensors' }], executionTime: 900_000 }
  const result = await handleExecutionWebhook(makeReq(body), deps)

  assert.equal(result.status, 200)
  assert.equal(puts.length, 1)                                           // re-hosted in our bucket
  assert.equal(upserts.length, 1)
  assert.equal(upserts[0].familia, 'flux')                              // registered + /make-resolvable
  const ex = completor.completed[0].exitus.exitus as Record<string, unknown>
  assert.equal(ex.trained, true)
  assert.equal(ex.steps, 600)
  assert.equal(ex.loraId, 'lora-w')
  assert.equal(ex.loraUrl, 'https://cdn/models/lora-w/milady.safetensors')
  assert.equal(ex.commercialUse, 'unknown')                            // no baseModel → license unverified
  assert.equal(completor.completed[0].exitus.impetus, 900n)            // pod-seconds = executionTime/1000
})

// 1c. A non-training completion still uses projectExitus (resolver returns null, no finality fires).
test('COMPLETED non-training payload still uses projectExitus', async () => {
  const actum = makeActum()
  const completor = makeCompletor()
  let finalizeCalls = 0
  const deps: ExecutionWebhookDeps = {
    actorum: makeActorum(actum),
    completor,
    modorum: makeModorum({ id: 'flux-schnell', ministerium: 'runpod' } as unknown as Modus),
    resolveExitus: makeTrainingExitusResolver(async () => { finalizeCalls++; return {} }),
  }
  const body = { id: 'job-abc-123', status: 'COMPLETED', output: [{ url: 'https://example.com/out.png' }], executionTime: 5000 }
  await handleExecutionWebhook(makeReq(body), deps)

  assert.equal(finalizeCalls, 0)
  assert.deepEqual(completor.completed[0].exitus.exitus, { image: 'https://example.com/out.png' })
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
    ): Promise<AuctorKey | null> {
      calls.push({ actumId, result })
      // No identity is resolved by this double — the same value the earlier
      // implementation produced, now stated in the type the dep declares.
      return null
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
    exitus: { image: 'https://example.com/out.png' },
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
  id: 'flux-schnell',
  nomen: 'Flux Schnell',
  genus: 'atomicus',
  versio: '1.0.0',
  contentHash: 'test-hash',
  aditus: {},
  exitus: {},
  canonica: true,
  auctor: { animaId: 'anima-flux-author' },   // auctor is the {animaId}|{commitment} owner union
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

// 18a. hostCutHook (post-167): a guest-tier completion taxes the MEASURED cost,
// not the surcharged/capped settle total and not the reservation the actum locked.
test('guest completion — hostCutHook taxes the measured cost, not the reservation', async () => {
  const { nexus, signorum, modorum, actorum } = makeLedgerDeps()
  await modorum.register({ ...TEST_MODUS, auctor: undefined })   // isolate hostCut from spellRoyalty
  await seedActum(actorum, makeActum({
    impetus: 1800n,                        // reservation — well above the measured run
    executio: { pricingTier: 'guest' },
    materiamId: 'materia-1',
  }))

  const hospitia: Pick<HospitiumStore, 'findByMateriaId'> = {
    async findByMateriaId(id) {
      return id === 'materia-1'
        ? { id: 'hosp-1', materiaId: 'materia-1', hostKey: { animaId: 'host-anima' }, inceptum: new Date() }
        : null
    },
  }

  const deps = {
    actorum, completor: makeCompletor(), nexus, signorum, modorum, hospitia,
  } as unknown as ExecutionWebhookDeps
  // 200s measured pod-time → baseImpetus 200n; hostCut = 20% of that measured
  // base (40n), not of the guest-surcharged settle total (280n) or the 1800n
  // reservation.
  await handleExecutionWebhook(makeReq({ id: 'job-abc-123', status: 'COMPLETED', output: [], executionTime: 200_000 }), deps)

  const signa = await signorum.history({ animaId: 'host-anima' })
  assert.equal(signa.length, 1)
  assert.equal(signa[0].forma, 'reward')
  assert.equal(signa[0].valor, 40n)
  assert.equal(signa[0].auctor, 'nexus:hostCut')
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

// 19a. Model royalty: a gen that used a PUBLISHED model pays its owner (roadmap #1)
test('COMPLETED — model royalty routed to the used model\'s published owner', async () => {
  const { nexus, signorum, modorum, actorum } = makeLedgerDeps()
  await modorum.register({ ...TEST_MODUS, auctor: undefined })   // isolate the model-royalty signum
  await seedActum(actorum, makeActum({ deploymentHash: 'sha256:dep-1' }))

  // The deployment bundle records that this gen used 'lora-1'; that model has a
  // published Editio with no explicit split → its publisher earns the 5% pool.
  const deployments = {
    async find(h: string) {
      return h === 'sha256:dep-1' ? { hash: h, spec: { models: [{ id: 'lora-1', role: 'lora' }] }, natum: new Date() } : null
    },
  }
  const editiones = {
    async listByArtifact(ref: { kind: string; id: string }) {
      if (ref.kind === 'intella' && ref.id === 'lora-1') {
        const now = new Date()
        return [{ id: 'e-1', artifactRef: { kind: 'intella', id: 'lora-1' }, destination: 'huggingface', visibility: 'unlisted', custody: 'ours', by: { animaId: 'lora-author' }, status: 'published', natum: now, mutatum: now }]
      }
      return []
    },
  }

  const deps = {
    actorum, completor: makeCompletor(), nexus, signorum, modorum,
    deployments, editiones,
  } as unknown as ExecutionWebhookDeps
  // 200s → 200n impetus; model royalty = 5% = 10n to the sole payee.
  await handleExecutionWebhook(makeReq({ id: 'job-abc-123', status: 'COMPLETED', output: [], executionTime: 200_000 }), deps)

  const signa = await signorum.history({ animaId: 'lora-author' })
  assert.equal(signa.length, 1)
  assert.equal(signa[0].forma, 'reward')
  assert.equal(signa[0].valor, 10n)
  assert.equal(signa[0].auctor, 'nexus:modelRoyalty')
})

// 19b. Inventory merge: comfyrunner's modelsInstalled report set-unions into Materia.installedModels
test('COMPLETED with modelsInstalled report — Materia.installedModels gets set-union merged', async () => {
  const { actorum } = makeLedgerDeps()
  // Pre-existing model on the studio + a brand-new one in this run's report.
  const materia = { id: 'mat-7', externusId: 'pod-7', installedModels: ['intella.base'] }
  const updates: Array<{ id: string; patch: Record<string, unknown> }> = []
  const materiae = {
    async findById(id: string) { return id === materia.id ? materia : null },
    async update(id: string, patch: Record<string, unknown>) { updates.push({ id, patch }); return { ...materia, ...patch } },
    // unused by the webhook merge path
    async create() { throw new Error('not used') },
    async findWarm() { return null },
    async findActive() { return [] },
    async reapIdle() { return [] },
  }

  await seedActum(actorum, makeActum({
    materiamId: materia.id,
    executio: { modelsInstalled: ['intella.base', 'intella.milady'] },
  } as Partial<Actum> & { executio?: { modelsInstalled?: string[] } }))

  await handleExecutionWebhook(
    makeReq({ id: 'job-abc-123', status: 'COMPLETED', output: [], executionTime: 1000 }),
    { actorum, completor: makeCompletor(), materiae: materiae as never },
  )

  assert.equal(updates.length, 1, 'merge update fired')
  const merged = updates[0].patch.installedModels as string[]
  assert.deepEqual(merged.sort(), ['intella.base', 'intella.milady'].sort(), 'set-union with existing')
})

test('COMPLETED with NO modelsInstalled report — Materia untouched', async () => {
  const { actorum } = makeLedgerDeps()
  const updates: Array<{ id: string; patch: Record<string, unknown> }> = []
  const materiae = {
    async findById() { return { id: 'mat-x', externusId: 'p', installedModels: ['intella.base'] } },
    async update(id: string, patch: Record<string, unknown>) { updates.push({ id, patch }); return null as never },
    async create() { throw new Error('not used') },
    async findWarm() { return null },
    async findActive() { return [] },
    async reapIdle() { return [] },
  }
  await seedActum(actorum, makeActum({ materiamId: 'mat-x' }))
  await handleExecutionWebhook(
    makeReq({ id: 'job-abc-123', status: 'COMPLETED', output: [], executionTime: 1000 }),
    { actorum, completor: makeCompletor(), materiae: materiae as never },
  )
  assert.equal(updates.length, 0, 'no update when nothing to merge')
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
//
// The webhook does NOT write session spend. `Modo.impetusAccrued` holds the amount
// the LEDGER SETTLED, which only exists once `completor.complete` has settled the
// run — so the accrual lives there, on both rails, and this webhook's own
// pre-settlement figure never reaches the session counter. The parity itself is
// covered end-to-end (ordinary / surcharged / capped, async rail and sync rail) in
// tests/unit/execution/sessionSpendParity.test.ts.

// 23. A completion carries no session write of its own — the completor owns it.
test('COMPLETED writes no session spend from the webhook\'s own figure', async () => {
  const modos = new MemoryModo()
  const modo = await modos.create({ status: 'active', impetusAccrued: 100n, acta: [], idleWarmthSec: 300 })
  const actum = makeActum({ modoId: modo.id })
  const completor = makeCompletor()
  const deps: ExecutionWebhookDeps = { actorum: makeActorum(actum), completor }

  const result = await handleExecutionWebhook(
    makeReq({ id: 'job-abc-123', status: 'COMPLETED', output: [], executionTime: 60_000 }), deps)

  assert.equal(result.status, 200)
  assert.equal(completor.completed.length, 1, 'the run was handed to the completor')
  // This completor double settles nothing, so a session counter the webhook does
  // not touch stays exactly where it was.
  assert.equal((await modos.findById(modo.id))?.impetusAccrued, 100n)
})

// ── ActumIndex identity fallback (noema-044) ──────────────────────────────────
//
// Direct-fired runs (e.g. `POST /v1/runs`) never create a FlowContext, so
// flowRouter has nothing to resolve. These tests cover the fallback to
// deps.actumIndex.findByActumId when flowRouter is absent or yields no identity.

function makeActumIndexStub(entry: ActumIndex | null) {
  const calls: string[] = []
  return {
    calls,
    async record() {},
    async findFor() { return [] },
    async remove() {},
    async findByActumId(actumId: string) {
      calls.push(actumId)
      return entry
    },
  }
}

// 26. No flowRouter, actumIndex has an animaId entry → completor.complete gets that auctor
test('actumIndex fallback resolves animaId identity when flowRouter is absent', async () => {
  const actum = makeActum()
  const completor = makeCompletor()
  const actumIndex = makeActumIndexStub({
    actumId: 'actum-test-1',
    modusId: 'flux-schnell',
    createdAt: new Date(),
    animaId: 'anima-42',
  })
  const deps: ExecutionWebhookDeps = {
    actorum: makeActorum(actum),
    completor,
    actumIndex,
  }
  const body = { id: 'job-abc-123', status: 'COMPLETED', output: [], executionTime: 1000 }
  const result = await handleExecutionWebhook(makeReq(body), deps)

  assert.equal(result.status, 200)
  assert.deepEqual(actumIndex.calls, ['actum-test-1'])
  assert.deepEqual(completor.completed[0].auctor, { animaId: 'anima-42' })
})

// 27. No flowRouter, actumIndex has a commitment entry → completor.complete gets that auctor
test('actumIndex fallback resolves commitment identity when flowRouter is absent', async () => {
  const actum = makeActum()
  const completor = makeCompletor()
  const actumIndex = makeActumIndexStub({
    actumId: 'actum-test-1',
    modusId: 'flux-schnell',
    createdAt: new Date(),
    commitment: 'commit-abc',
  })
  const deps: ExecutionWebhookDeps = {
    actorum: makeActorum(actum),
    completor,
    actumIndex,
  }
  const body = { id: 'job-abc-123', status: 'COMPLETED', output: [], executionTime: 1000 }
  const result = await handleExecutionWebhook(makeReq(body), deps)

  assert.equal(result.status, 200)
  assert.deepEqual(completor.completed[0].auctor, { commitment: 'commit-abc' })
})

// 28. No flowRouter, no actumIndex entry anywhere → no throw, auctor stays undefined (unindexed)
test('actumIndex fallback with no entry leaves the run unindexed without throwing', async () => {
  const actum = makeActum()
  const completor = makeCompletor()
  const actumIndex = makeActumIndexStub(null)
  const deps: ExecutionWebhookDeps = {
    actorum: makeActorum(actum),
    completor,
    actumIndex,
  }
  const body = { id: 'job-abc-123', status: 'COMPLETED', output: [], executionTime: 1000 }
  const result = await handleExecutionWebhook(makeReq(body), deps)

  assert.equal(result.status, 200)
  assert.deepEqual(actumIndex.calls, ['actum-test-1'])
  assert.equal(completor.completed[0].auctor, undefined)
})

// 29. flowRouter identity present wins — actumIndex fallback is not consulted
test('flowRouter identity takes precedence over actumIndex fallback', async () => {
  const actum = makeActum()
  const completor = makeCompletor()
  const flowRouter = {
    async handleActumComplete() { return { animaId: 'anima-from-flow' } },
  }
  const actumIndex = makeActumIndexStub({
    actumId: 'actum-test-1',
    modusId: 'flux-schnell',
    createdAt: new Date(),
    animaId: 'anima-from-index',
  })
  const deps: ExecutionWebhookDeps = {
    actorum: makeActorum(actum),
    completor,
    flowRouter,
    actumIndex,
  }
  const body = { id: 'job-abc-123', status: 'COMPLETED', output: [], executionTime: 1000 }
  const result = await handleExecutionWebhook(makeReq(body), deps)

  assert.equal(result.status, 200)
  assert.deepEqual(completor.completed[0].auctor, { animaId: 'anima-from-flow' })
  assert.equal(actumIndex.calls.length, 0)
})

// ── Callback admission (per-job nonce) ────────────────────────────────────────
//
// The nonce travels only in the callback URL handed to the pod at dispatch, so presenting it is
// what admits the write. These pin that a refusal happens BEFORE any effect: no completion, no
// ledger signa, no session impetus accrual.

// 42. A callback presenting no nonce for a run that HAS one is refused with no side effects.
test('nonce-less callback for a run that carries a nonce writes nothing', async () => {
  const { nexus, signorum, modorum, actorum } = makeLedgerDeps()
  await modorum.register({ ...TEST_MODUS })
  const modos = new MemoryModo()
  const modo = await modos.create({ status: 'active', impetusAccrued: 100n, acta: [], idleWarmthSec: 300 })
  await seedActum(actorum, makeActum({ callbackNonce: 'nonce-A', modoId: modo.id }))

  const completor = makeCompletor()
  const deps: ExecutionWebhookDeps = { actorum, completor, nexus, signorum, modorum }

  const result = await handleExecutionWebhook(
    makeReq({ id: 'job-abc-123', status: 'COMPLETED', output: [], executionTime: 200_000 }),
    deps,
  )

  assert.equal(result.status, 404)
  assert.equal(completor.completed.length, 0)
  assert.equal((await signorum.history({ animaId: 'anima-flux-author' })).length, 0, 'no ledger signa on a refused callback')
  assert.equal((await modos.findById(modo.id))?.impetusAccrued, 100n, 'no impetus accrual on a refused callback')
  assert.equal((await actorum.findById('actum-test-1'))?.status, 'nascens')
})

// 43. A nonce belonging to another run, presented with this run's job id, is refused likewise.
test('a nonce from a different run writes nothing', async () => {
  const { nexus, signorum, modorum, actorum } = makeLedgerDeps()
  await modorum.register({ ...TEST_MODUS })
  const modos = new MemoryModo()
  const modo = await modos.create({ status: 'active', impetusAccrued: 100n, acta: [], idleWarmthSec: 300 })
  await seedActum(actorum, makeActum({ callbackNonce: 'nonce-A', modoId: modo.id }))
  await seedActum(actorum, makeActum({ id: 'actum-test-2', externusJobId: 'job-other', callbackNonce: 'nonce-B' }))

  const completor = makeCompletor()
  const deps: ExecutionWebhookDeps = { actorum, completor, nexus, signorum, modorum }

  const result = await handleExecutionWebhook(
    makeReq({ id: 'job-abc-123', status: 'COMPLETED', output: [], executionTime: 200_000 }, { nonce: 'nonce-B' }),
    deps,
  )

  assert.equal(result.status, 404)
  assert.equal(completor.completed.length, 0)
  assert.equal((await signorum.history({ animaId: 'anima-flux-author' })).length, 0)
  assert.equal((await modos.findById(modo.id))?.impetusAccrued, 100n)
})

// 44. The matching nonce completes the run exactly as before — the check adds admission only.
test('the run\'s own nonce completes it and settles the ledger as before', async () => {
  const { nexus, signorum, modorum, actorum } = makeLedgerDeps()
  await modorum.register({ ...TEST_MODUS })
  await seedActum(actorum, makeActum({ callbackNonce: 'nonce-A' }))

  const completor = makeCompletor()
  const deps: ExecutionWebhookDeps = { actorum, completor, nexus, signorum, modorum }

  const result = await handleExecutionWebhook(
    makeReq({ id: 'job-abc-123', status: 'COMPLETED', output: [], executionTime: 200_000 }, { nonce: 'nonce-A' }),
    deps,
  )

  assert.equal(result.status, 200)
  assert.equal(completor.completed.length, 1)
  assert.equal(completor.completed[0].exitus.impetus, 200n)
  assert.equal((await signorum.history({ animaId: 'anima-flux-author' })).length, 1, 'a valid completion still writes its royalty signum')
})

// 45. A nonce nobody holds resolves to nothing → refused.
test('an unknown nonce is refused', async () => {
  const { actorum } = makeLedgerDeps()
  await seedActum(actorum, makeActum({ callbackNonce: 'nonce-A' }))
  const completor = makeCompletor()

  const result = await handleExecutionWebhook(
    makeReq({ id: 'job-abc-123', status: 'COMPLETED', output: [], executionTime: 1000 }, { nonce: 'guessed' }),
    { actorum, completor },
  )

  assert.equal(result.status, 404)
  assert.equal(completor.completed.length, 0)
})

// 46. Migration: a run dispatched before the nonce existed still completes on the nonce-less route.
test('a run carrying no nonce still completes without one', async () => {
  const { actorum } = makeLedgerDeps()
  await seedActum(actorum, makeActum())   // no callbackNonce
  const completor = makeCompletor()

  const result = await handleExecutionWebhook(
    makeReq({ id: 'job-abc-123', status: 'COMPLETED', output: [], executionTime: 1000 }),
    { actorum, completor },
  )

  assert.equal(result.status, 200)
  assert.equal(completor.completed.length, 1)
})

// 47. Store round-trip: the nonce persists and is findable by it. Without this, a store whose
//     patch pick-list omits the field would silently drop it — and a nonce-less actum is treated
//     as pre-migration, so the loss would fail OPEN and be invisible.
test('callbackNonce survives a round-trip through the actum store', async () => {
  const actorum = new MemoryActorum()
  await seedActum(actorum, makeActum({ callbackNonce: undefined }))

  await actorum.update('actum-test-1', { externusJobId: 'job-abc-123', callbackNonce: 'nonce-A', status: 'agens' })

  assert.equal((await actorum.findById('actum-test-1'))?.callbackNonce, 'nonce-A')
  assert.equal((await actorum.findByCallbackNonce('nonce-A'))?.id, 'actum-test-1')
  assert.equal(await actorum.findByCallbackNonce('nonce-B'), null)
})
