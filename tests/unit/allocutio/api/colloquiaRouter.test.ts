// Hermetic (express + supertest) test of the concierge HTTP surface + per-turn metering
// (noema-095, MONEY CODE). No live Mongo, no real OpenRouter — the DictumStore/ColloquiumStore,
// the Signorum/Bursa ledgers, the CrystalApi handler backend, and the noema-093 `runToolChat`
// seam are all in-memory fakes. The six `verify` cases live here (globbed by test:hermetic):
//   1. ownerKey authz (no cross-owner colloquium access)
//   2. per-turn EXACT-cost settle == chatImpetus(sum tokenUsage) at 3n/1k
//   3. idempotent dicta retry (same turnKey → no re-run, no double-charge)
//   4. reject-before-run on insufficient balance (no Dictum, no provider call, no debit)
//   5. Dictum.signaIds stamped with the settle's produced signa id(s)
//   6. security: the agent can never be induced to emit a spend tool through this path
// plus the bursaToken FLAT-CAP rail (locked ruling).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import express from 'express'
import request, { type Response } from 'supertest'

import {
  createColloquiaRouter,
  DEFAULT_CONCIERGE_TURN_CAP_IMPETUS as CAP,
  type ColloquiaRouterDeps,
} from '../../../../src/allocutio/api/colloquiaRouter.js'
import { READ_ONLY_TOOL_NAMES as READ_ONLY_TOOLS } from '../../../../src/allocutio/api/ConciergeAgent.js'
import { chatImpetus } from '../../../../src/crystal/apiProviders.js'
import type { AuctorKey } from '../../../../src/flow/types.js'
import type { Colloquium, Dictum } from '../../../../src/types/colloquium.js'
import type { CrystalApi } from '../../../../src/allocutio/api/CrystalApi.js'
import type {
  OpenRouterChatResult,
  OpenRouterToolChatOpts,
  OpenRouterToolClientDeps,
  OpenRouterToolSpec,
  OpenRouterToolCall,
} from '../../../../src/allocutio/api/OpenRouterToolClient.js'

// ── fakes ────────────────────────────────────────────────────────────────────

function fakeColloquia() {
  const store = new Map<string, Colloquium>()
  let n = 0
  return {
    store,
    async create(input: Omit<Colloquium, 'id' | 'natum' | 'mutatum'>): Promise<Colloquium> {
      const now = new Date()
      const c: Colloquium = { ...input, id: `c-${++n}`, natum: now, mutatum: now }
      store.set(c.id, c)
      return c
    },
    async find(id: string): Promise<Colloquium | null> {
      return store.get(id) ?? null
    },
  }
}

// Duplicate-key error shaped like Mongo's E11000 (the router duck-types on `.code === 11000`).
class FakeDupKeyError extends Error {
  code = 11000
  constructor() {
    super('E11000 duplicate key error: turnkey_agent_charge_gate')
  }
}

function fakeDicta() {
  const store: Dictum[] = []
  let n = 0
  return {
    store,
    async create(input: Omit<Dictum, 'id' | 'natum'>): Promise<Dictum> {
      // Enforce the production unique partial index `turnkey_agent_charge_gate`: at most ONE agent
      // Dictum per (colloquiumId, turnKey). This is the atomic per-turn charge gate — a concurrent
      // second agent insert for the same turn throws E11000 (see the concurrency test below).
      if (
        input.genus === 'agent' &&
        input.turnKey !== undefined &&
        store.some((d) => d.genus === 'agent' && d.colloquiumId === input.colloquiumId && d.turnKey === input.turnKey)
      ) {
        throw new FakeDupKeyError()
      }
      const d: Dictum = { ...input, id: `d-${++n}`, natum: new Date() }
      store.push(d)
      return d
    },
    async update(id: string, patch: Partial<Pick<Dictum, 'actumId' | 'signaIds'>>): Promise<Dictum> {
      const d = store.find((x) => x.id === id)
      if (!d) throw new Error(`Dictum not found: ${id}`)
      Object.assign(d, patch)
      return d
    },
    async listByColloquium(cid: string): Promise<Dictum[]> {
      return store.filter((d) => d.colloquiumId === cid)
    },
    async findByTurnKey(cid: string, turnKey: string): Promise<Dictum[]> {
      return store.filter((d) => d.colloquiumId === cid && d.turnKey === turnKey)
    },
  }
}

// Tracks a running balance; reserve locks the cap, settle refunds the unused delta (so the NET
// debit equals the settled actual), release restores a live lock. Mirrors MemorySignorum semantics.
function fakeSignorum(bal: { v: bigint }) {
  const locks: Array<{ ref: string; ids: string[]; amount: bigint; active: boolean }> = []
  let n = 0
  return {
    locks,
    async balance(): Promise<bigint> {
      return bal.v
    },
    async reserve(_by: unknown, amount: bigint, ref: string) {
      if (bal.v < amount) return { ok: false as const, available: bal.v }
      bal.v -= amount
      const ids = [`sig-${++n}`]
      locks.push({ ref, ids, amount, active: true })
      return { ok: true as const, signaIds: ids, locked: amount }
    },
    async settle(_ids: string[], actual: bigint, ref: string): Promise<void> {
      const l = locks.find((x) => x.ref === ref && x.active)
      if (!l) throw new Error(`no live lock for ${ref}`)
      if (actual > l.amount) throw new Error('overcharge')
      l.active = false
      if (actual < l.amount) bal.v += l.amount - actual
    },
    async release(ids: string[]): Promise<void> {
      const l = locks.find((x) => x.active && x.ids.some((i) => ids.includes(i)))
      if (l) {
        l.active = false
        bal.v += l.amount
      }
    },
  }
}

function fakeBursarium(creditsRef: { v: bigint }, token = 'bt-1') {
  return {
    token,
    debits: [] as bigint[],
    async findByToken(t: string) {
      return t === token ? { id: token, credits: creditsRef.v, createdAt: new Date() } : null
    },
    async debit(t: string, amount: bigint) {
      if (t !== token) throw new Error('unknown purse')
      if (creditsRef.v < amount) throw new Error('insufficient purse')
      creditsRef.v -= amount
      this.debits.push(amount)
      return { id: token, credits: creditsRef.v, createdAt: new Date() }
    },
  }
}

// CrystalApi slice the router + agent touch. invokeFlow/createRun THROW — a concierge turn must
// never reach a spend method (invariant (4)). getRun is owner-scoped in prod; here it's unused
// unless a test sends priorRunId.
function fakeApi(opts: { spicyMode?: boolean; onSpend?: () => void } = {}): CrystalApi {
  const spend = (name: string) => {
    opts.onSpend?.()
    throw new Error(`concierge turn must never call ${name}`)
  }
  return {
    async getMe() {
      return { bindings: [], generatio: { spicyMode: opts.spicyMode ?? false }, secrets: {}, secretsAvailable: false, admin: false }
    },
    async getRun() {
      throw new Error('getRun not stubbed for this test')
    },
    async listFlows() {
      return []
    },
    async describeFlow() {
      return {}
    },
    async listModels() {
      return []
    },
    async quote() {
      return { impetus: '0', recipient: 'platform' }
    },
    async invokeFlow() {
      return spend('invokeFlow')
    },
    async createRun() {
      return spend('createRun')
    },
    async collect() {
      return spend('collect')
    },
    async provisionStudio() {
      return spend('provisionStudio')
    },
  } as unknown as CrystalApi
}

// The noema-093 seam. Records every `tools[]` it is handed (for the spend-tool assertion) and
// replays a scripted sequence of results; the last drives runConcierge's `finalize`.
function fakeRunToolChat(script: OpenRouterChatResult[], captured: { tools: OpenRouterToolSpec[][] }) {
  let i = 0
  return async (_deps: OpenRouterToolClientDeps, opts: OpenRouterToolChatOpts): Promise<OpenRouterChatResult> => {
    captured.tools.push(opts.tools ?? [])
    const r = script[Math.min(i, script.length - 1)]
    i++
    return r
  }
}

function reply(totalTokens: number, content = 'Sure — tell me a bit more about what you want to make.'): OpenRouterChatResult {
  return { content, finishReason: 'stop', tokenUsage: { totalTokens } }
}

function toolCall(name: string): OpenRouterToolCall {
  return { id: `tc-${name}`, name, arguments: '{}' }
}

interface HarnessOpts {
  auctor?: AuctorKey
  balance?: bigint
  bursaCredits?: bigint
  script?: OpenRouterChatResult[]
  spicyMode?: boolean
  onSpend?: () => void
}

function harness(opts: HarnessOpts = {}) {
  const colloquia = fakeColloquia()
  const dicta = fakeDicta()
  const bal = { v: opts.balance ?? 100_000n }
  const signorum = fakeSignorum(bal)
  const bursaCredits = { v: opts.bursaCredits ?? 100_000n }
  const bursarium = fakeBursarium(bursaCredits)
  const captured = { tools: [] as OpenRouterToolSpec[][] }
  const runToolChat = fakeRunToolChat(opts.script ?? [reply(2000)], captured)

  const deps: ColloquiaRouterDeps = {
    identity: { resolve: async () => opts.auctor ?? { animaId: 'A' } },
    colloquia: colloquia as unknown as ColloquiaRouterDeps['colloquia'],
    dicta: dicta as unknown as ColloquiaRouterDeps['dicta'],
    signorum: signorum as unknown as ColloquiaRouterDeps['signorum'],
    bursarium: bursarium as unknown as ColloquiaRouterDeps['bursarium'],
    api: fakeApi({ spicyMode: opts.spicyMode ?? false, ...(opts.onSpend ? { onSpend: opts.onSpend } : {}) }),
    agent: { runToolChat, toolClient: { http: {} as never, apiKey: 'k' } },
  }
  const app = express()
  app.use('/v1/colloquia', express.json(), createColloquiaRouter(deps))
  return { app, colloquia, dicta, signorum, bal, bursaCredits, bursarium, captured }
}

async function createThread(app: express.Express, headers: Record<string, string> = {}): Promise<string> {
  const res = await request(app).post('/v1/colloquia').set(headers).send({})
  assert.equal(res.status, 200)
  return res.body.colloquium.id as string
}

// ── 1. ownerKey authz — no cross-owner colloquium access ──────────────────────

test('cross-owner dicta POST is rejected — owner B cannot post to owner A’s colloquium', async () => {
  // Owner A (bursaToken bt-A) creates a thread.
  const h = harness({ auctor: { bursaToken: 'bt-A' } })
  const idA = await createThread(h.app, { 'x-bursa-token': 'bt-A' })

  // Owner B (a DIFFERENT bursaToken) tries to post a dictum to A's colloquium → 404 (no leak).
  const res = await request(h.app)
    .post(`/v1/colloquia/${idA}/dicta`)
    .set({ 'x-bursa-token': 'bt-B' })
    .send({ turnKey: 't1', message: 'hello' })
  assert.equal(res.status, 404)
  // No agent ran, nothing was charged.
  assert.equal(h.captured.tools.length, 0)
  assert.equal(h.dicta.store.length, 0)
})

// ── 2 + 5. per-turn EXACT-cost settle + signaIds stamped ──────────────────────

test('per-turn settle debits EXACTLY chatImpetus(sum tokenUsage) and stamps the agent Dictum signaIds', async () => {
  const tokens = 2000 // chatImpetus(2000, 3n) = ceil(2000*3/1000) = 6
  const expected = chatImpetus(tokens, 3n)
  assert.equal(expected, 6n)

  const h = harness({ auctor: { animaId: 'A' }, balance: 100_000n, script: [reply(tokens)] })
  const id = await createThread(h.app)
  const before = h.bal.v

  const res = await request(h.app).post(`/v1/colloquia/${id}/dicta`).send({ turnKey: 't1', message: 'make me a cat' })
  assert.equal(res.status, 200)

  // Debited EXACTLY the metered actual (cap reserved, delta refunded) — not the 200 cap.
  assert.equal(before - h.bal.v, expected)
  assert.equal(res.body.charged, expected.toString())

  // The agent Dictum carries the settle's signa id(s) (invariant/case 5).
  const agent = h.dicta.store.find((d) => d.genus === 'agent')
  assert.ok(agent)
  assert.deepEqual(agent.signaIds, ['sig-1'])
  assert.equal(res.body.dictum.signaIds.length, 1)

  // Both turns persisted, tagged with the turn key.
  assert.equal(h.dicta.store.filter((d) => d.turnKey === 't1').length, 2)
  assert.ok(h.dicta.store.some((d) => d.genus === 'user' && d.corpus === 'make me a cat'))
})

// ── 3. idempotent retry — same turnKey never re-runs or double-charges ─────────

test('retrying a dicta POST with the same turnKey is a no-op — no re-run, no double-charge', async () => {
  const h = harness({ auctor: { animaId: 'A' }, script: [reply(2000)] })
  const id = await createThread(h.app)

  const first = await request(h.app).post(`/v1/colloquia/${id}/dicta`).send({ turnKey: 'dup', message: 'hi' })
  assert.equal(first.status, 200)
  const balAfterFirst = h.bal.v
  const agentCountAfterFirst = h.dicta.store.filter((d) => d.genus === 'agent').length
  const toolCallsAfterFirst = h.captured.tools.length

  const second = await request(h.app).post(`/v1/colloquia/${id}/dicta`).send({ turnKey: 'dup', message: 'hi' })
  assert.equal(second.status, 200)
  assert.equal(second.body.idempotentReplay, true)
  // Same persisted turn returned, verbatim.
  assert.equal(second.body.dictum.id, first.body.dictum.id)
  // No second charge, no second agent Dictum, no second agent run.
  assert.equal(h.bal.v, balAfterFirst)
  assert.equal(h.dicta.store.filter((d) => d.genus === 'agent').length, agentCountAfterFirst)
  assert.equal(h.captured.tools.length, toolCallsAfterFirst)
})

// ── 3b. CONCURRENCY — the TOCTOU charge gate (review blocker) ─────────────────
// Two concurrent POSTs with the SAME turnKey (a client-timeout retry racing the still-in-flight
// original — a normal operating condition for a multi-second agent turn) must charge the caller
// EXACTLY ONCE. The unique partial index on (colloquiumId, turnKey) over AGENT dicta is the atomic
// charge gate: both may run the read-only agent, but only one persists the agent Dictum and settles;
// the other loses on E11000 and returns the winner's turn without a second reserve→settle.

test('two concurrent POSTs with the SAME turnKey charge the caller exactly once (no double-charge)', async () => {
  const colloquia = fakeColloquia()
  const dicta = fakeDicta()
  const bal = { v: 100_000n }
  const signorum = fakeSignorum(bal)
  const bursarium = fakeBursarium({ v: 100_000n })
  const tokens = 2000
  const expected = chatImpetus(tokens, 3n) // 6n

  // A gate the agent LLM awaits so both requests are held in their in-flight window simultaneously;
  // `bothInFlight` resolves once BOTH have reserved + entered the agent, guaranteeing a true race.
  let releaseLLM!: () => void
  const llmGate = new Promise<void>((r) => { releaseLLM = r })
  let entered = 0
  let markBothInFlight!: () => void
  const bothInFlight = new Promise<void>((r) => { markBothInFlight = r })
  const runToolChat = async (
    _deps: OpenRouterToolClientDeps,
    opts: OpenRouterToolChatOpts,
  ): Promise<OpenRouterChatResult> => {
    void opts
    if (++entered === 2) markBothInFlight()
    await llmGate
    return reply(tokens)
  }

  const deps: ColloquiaRouterDeps = {
    identity: { resolve: async () => ({ animaId: 'A' }) },
    colloquia: colloquia as unknown as ColloquiaRouterDeps['colloquia'],
    dicta: dicta as unknown as ColloquiaRouterDeps['dicta'],
    signorum: signorum as unknown as ColloquiaRouterDeps['signorum'],
    bursarium: bursarium as unknown as ColloquiaRouterDeps['bursarium'],
    api: fakeApi(),
    agent: {
      runToolChat: runToolChat as unknown as ColloquiaRouterDeps['agent']['runToolChat'],
      toolClient: { http: {} as never, apiKey: 'k' },
    },
  }
  const app = express()
  app.use('/v1/colloquia', express.json(), createColloquiaRouter(deps))

  const id = await createThread(app)
  const before = bal.v

  // Fire both turns with the SAME turnKey; the `.then` forces supertest to dispatch immediately
  // (it starts the request lazily otherwise) so both are in flight before we await the barrier.
  const p1 = request(app).post(`/v1/colloquia/${id}/dicta`).send({ turnKey: 'race', message: 'hi' }).then((r: Response) => r)
  const p2 = request(app).post(`/v1/colloquia/${id}/dicta`).send({ turnKey: 'race', message: 'hi' }).then((r: Response) => r)
  await bothInFlight
  releaseLLM()
  const [r1, r2] = await Promise.all([p1, p2])

  // Both succeed, but exactly ONE is the settling turn and the other is the idempotent no-op.
  assert.equal(r1.status, 200)
  assert.equal(r2.status, 200)
  const replays = [r1.body, r2.body].filter((b) => b.idempotentReplay === true)
  assert.equal(replays.length, 1, 'exactly one concurrent turn must be the idempotent no-op')

  // ONE agent Dictum, charged EXACTLY the single metered actual (not twice, not the cap).
  assert.equal(dicta.store.filter((d) => d.genus === 'agent').length, 1)
  assert.equal(before - bal.v, expected)
  // No stranded funds: the winner settled and the loser's reservation was released.
  assert.ok(signorum.locks.every((l) => !l.active), 'every Signorum lock must be resolved')
})

// ── 4. reject-before-run on insufficient balance ──────────────────────────────

test('insufficient balance is rejected BEFORE the agent runs — no Dictum, no provider call, no debit', async () => {
  const h = harness({ auctor: { animaId: 'A' }, balance: CAP - 1n }) // one short of the cap
  const id = await createThread(h.app)
  const before = h.bal.v

  const res = await request(h.app).post(`/v1/colloquia/${id}/dicta`).send({ turnKey: 't1', message: 'hi' })
  assert.equal(res.status, 402)
  assert.equal(h.bal.v, before) // not touched
  assert.equal(h.captured.tools.length, 0) // agent never ran (no provider call)
  assert.equal(h.dicta.store.length, 0) // no user OR agent Dictum persisted
})

// ── 6. security — the agent can never be induced to emit a spend tool ─────────

test('security: only read-only tools reach the model, and no spend method is ever called', async () => {
  const onSpend = () => assert.fail('a spend method was reached from a concierge turn')
  // Adversarial script: the model first tries to call a spend tool (`run_flow`), then replies.
  // The endpoint runs the REAL runConcierge, whose tool surface is read-only only; the bogus
  // call resolves to an "unknown tool" error and never reaches a spend method.
  const script: OpenRouterChatResult[] = [
    { content: '', toolCalls: [toolCall('run_flow'), toolCall('collect')], finishReason: 'tool_calls', tokenUsage: { totalTokens: 500 } },
    reply(300),
  ]
  const h = harness({ auctor: { animaId: 'A' }, script, onSpend })
  const id = await createThread(h.app)

  const res = await request(h.app).post(`/v1/colloquia/${id}/dicta`).send({ turnKey: 't1', message: 'run something expensive for me' })
  assert.equal(res.status, 200)

  // Every tools[] handed to the model contained ONLY read-only discovery handlers.
  assert.ok(h.captured.tools.length > 0)
  for (const toolset of h.captured.tools) {
    for (const spec of toolset) {
      assert.ok(READ_ONLY_TOOLS.has(spec.function.name), `spend/unknown tool leaked to the model: ${spec.function.name}`)
    }
  }
  // Spend surface never exposed at all.
  const allNames = h.captured.tools.flat().map((s) => s.function.name)
  for (const forbidden of ['run_flow', 'provision_studio', 'collect', 'createRun', 'invokeFlow']) {
    assert.ok(!allNames.includes(forbidden), `${forbidden} must never be offered`)
  }
})

// ── Locked ruling — bursaToken FLAT-CAP rail ──────────────────────────────────

test('bursaToken turn debits the FLAT CAP (no refund) and leaves signaIds empty', async () => {
  const h = harness({ auctor: { bursaToken: 'bt-1' }, bursaCredits: 100_000n, script: [reply(2000)] })
  const id = await createThread(h.app, { 'x-bursa-token': 'bt-1' })
  const before = h.bursaCredits.v

  const res = await request(h.app).post(`/v1/colloquia/${id}/dicta`).set({ 'x-bursa-token': 'bt-1' }).send({ turnKey: 't1', message: 'hi' })
  assert.equal(res.status, 200)

  // Flat cap debited (NOT the metered 6), no refund.
  assert.equal(before - h.bursaCredits.v, CAP)
  assert.equal(res.body.charged, CAP.toString())
  // Bursa yields no signum — signaIds stays empty.
  const agent = h.dicta.store.find((d) => d.genus === 'agent')
  assert.ok(agent)
  assert.deepEqual(agent.signaIds, [])
})

test('bursaToken turn is rejected before running when the purse cannot cover the cap', async () => {
  const h = harness({ auctor: { bursaToken: 'bt-1' }, bursaCredits: CAP - 1n })
  const id = await createThread(h.app, { 'x-bursa-token': 'bt-1' })
  const before = h.bursaCredits.v

  const res = await request(h.app).post(`/v1/colloquia/${id}/dicta`).set({ 'x-bursa-token': 'bt-1' }).send({ turnKey: 't1', message: 'hi' })
  assert.equal(res.status, 402)
  assert.equal(h.bursaCredits.v, before) // no debit
  assert.equal(h.captured.tools.length, 0) // agent never ran
  assert.equal(h.dicta.store.length, 0) // nothing persisted
})

// ── input hygiene ─────────────────────────────────────────────────────────────

test('a dicta POST without a turnKey is rejected (idempotency key is required)', async () => {
  const h = harness({ auctor: { animaId: 'A' } })
  const id = await createThread(h.app)
  const res = await request(h.app).post(`/v1/colloquia/${id}/dicta`).send({ message: 'hi' })
  assert.equal(res.status, 400)
  assert.equal(h.dicta.store.length, 0)
})
