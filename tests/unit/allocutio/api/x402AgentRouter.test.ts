// End-to-end (express) test of the x402 pay-per-call capability surface: discover,
// the 402 flow, verify → run → settle, replay protection, owner rev-share, and the
// no-settle-on-failure rule.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import express from 'express'
import request from 'supertest'
import { createX402AgentRouter, type X402AgentDeps } from '../../../../src/allocutio/api/x402AgentRouter.js'
import { MemoryLegatus } from '../../../../src/crystal/MemoryLegatus.js'
import { MemoryModorum } from '../../../../src/execution/MemoryModorum.js'
import { MemoryX402Log } from '../../../../src/crystal/MemoryX402Log.js'
import { DEFAULT_X402_CONFIG } from '../../../../src/crystal/x402Pricing.js'
import { CAMEL_TEMPLATE_MODUS } from '../../../../src/crystal/seeds/camel.js'
import type { Run } from '../../../../src/allocutio/api/types.js'
import type { X402Facilitator } from '../../../../src/types/x402.js'

const OWNER = '0x' + 'a'.repeat(40)

function okFacilitator(over: Partial<X402Facilitator> = {}): X402Facilitator {
  return {
    async verify() { return { valid: true, payer: OWNER, amount: '404400', signatureHash: 'sig-123' } },
    async settle() { return { success: true, transaction: '0xtx' } },
    ...over,
  }
}

async function harness(opts: {
  facilitator?: X402Facilitator
  runSpell?: X402AgentDeps['runSpell']
  enabled?: boolean
  withSpell?: boolean
  modi?: Array<{ id: string; nomen: string; auctor?: { animaId: string } }>
  hub?: X402AgentDeps['hub']
  getRun?: X402AgentDeps['getRun']
  rateLimiters?: X402AgentDeps['rateLimiters']
} = {}) {
  const legati = new MemoryLegatus()
  const modorum = new MemoryModorum()
  await modorum.register({ ...CAMEL_TEMPLATE_MODUS, id: 'agent-ws-camel42' })
  for (const m of opts.modi ?? []) await modorum.register({ ...CAMEL_TEMPLATE_MODUS, id: m.id, nomen: m.nomen, ...(m.auctor ? { auctor: m.auctor } : {}) })
  await legati.create({
    agentId: 'camel42', ownerAddress: OWNER, animaId: 'anima-agent', treasuryId: 'camelcabal-1',
    issuerId: 'https://camelcabal.fun', scope: ['generate'], revokeToken: 'rvk',
    ...(opts.withSpell === false ? {} : { workspaceModusId: 'agent-ws-camel42' }),
  })
  const log = new MemoryX402Log()
  const cuts: Array<{ payoutAddress: string; priceAtomic: string; serveImpetus: bigint; sourceRef: string; network: string }> = []
  const deps: X402AgentDeps = {
    legati, modorum, log,
    facilitator: opts.facilitator ?? okFacilitator(),
    config: { ...DEFAULT_X402_CONFIG, payTo: '0xReceiver' },
    enabled: opts.enabled ?? true,
    quoteImpetus: async () => 1000n,
    runSpell: opts.runSpell ?? (async ({ modusId }): Promise<Run> => ({ id: 'run-1', status: 'complete', modusId, exitus: { image: 'https://out/img.png' } })),
    accrueAgentCut: async (input) => { cuts.push(input); return { status: 'accrued' } },
    ...(opts.hub ? { hub: opts.hub } : {}),
    ...(opts.getRun ? { getRun: opts.getRun } : {}),
    ...(opts.rateLimiters ? { rateLimiters: opts.rateLimiters } : {}),
    publicBase: 'https://noema.art',
  }
  const server = express()
  server.use('/api/v1/x402', express.json(), createX402AgentRouter(deps))
  return { server, log, cuts }
}

test('discover: schema + quote + accepts, no payment needed', async () => {
  const { server } = await harness()
  const res = await request(server).get('/api/v1/x402/agents/camel42/spell/memeify')
  assert.equal(res.status, 200)
  assert.equal(res.body.agentId, 'camel42')
  assert.ok(res.body.inputSchema.properties.prompt, 'spell input schema surfaced')
  assert.equal(res.body.quote.currency, 'USDC')
  assert.equal(res.body.accepts[0].scheme, 'exact')
})

test('POST without X-PAYMENT → 402 with PaymentRequirements', async () => {
  const { server } = await harness()
  const res = await request(server).post('/api/v1/x402/agents/camel42/spell/memeify').send({ inputs: { prompt: 'hi' } })
  assert.equal(res.status, 402)
  assert.equal(res.body.error, 'PAYMENT_REQUIRED')
  assert.equal(res.body.paymentRequired.x402Version, 2)
  assert.equal(res.body.paymentRequired.accepts[0].payTo, '0xReceiver')
})

test('invalid payment → 402 PAYMENT_INVALID', async () => {
  const { server } = await harness({ facilitator: okFacilitator({ async verify() { return { valid: false, error: 'bad sig' } } }) })
  const res = await request(server).post('/api/v1/x402/agents/camel42/spell/memeify').set('x-payment', 'x').send({ inputs: {} })
  assert.equal(res.status, 402)
  assert.equal(res.body.error, 'PAYMENT_INVALID')
})

test('happy path: verify → run → settle → 200 with X-PAYMENT-RESPONSE + agent cut accrued', async () => {
  const { server, log, cuts } = await harness()
  const res = await request(server).post('/api/v1/x402/agents/camel42/spell/memeify').set('x-payment', 'paid').send({ inputs: { prompt: 'a cat' } })
  assert.equal(res.status, 200)
  assert.equal(res.body.runId, 'run-1')
  assert.deepEqual(res.body.outputs, { image: 'https://out/img.png' })
  assert.equal(res.body.x402.settled, true)
  assert.equal(res.body.x402.transaction, '0xtx')
  assert.ok(res.headers['x-payment-response'], 'settlement header set')
  // Payment logged SETTLED; the agent cut accrual fired with the paid price + serve cost.
  assert.equal((await log.find('sig-123'))?.status, 'SETTLED')
  assert.equal(cuts.length, 1)
  assert.equal(cuts[0].payoutAddress, OWNER)          // no payoutPolicy → owner address
  assert.equal(cuts[0].priceAtomic, '404400')         // the amount actually paid (verify.amount)
  assert.equal(cuts[0].serveImpetus, 1000n)           // our cost basis, for the margin split
  assert.equal(cuts[0].sourceRef, 'sig-123')          // the settlement's replay/idempotency key
})

test('replay: the same signatureHash is refused with 409, run not repeated', async () => {
  let runs = 0
  const { server } = await harness({ runSpell: async ({ modusId }): Promise<Run> => { runs++; return { id: `run-${runs}`, status: 'complete', modusId } } })
  const first = await request(server).post('/api/v1/x402/agents/camel42/spell/memeify').set('x-payment', 'paid').send({ inputs: {} })
  const second = await request(server).post('/api/v1/x402/agents/camel42/spell/memeify').set('x-payment', 'paid').send({ inputs: {} })
  assert.equal(first.status, 200)
  assert.equal(second.status, 409)
  assert.equal(second.body.error.code, 'PAYMENT_REPLAY')
  assert.equal(runs, 1, 'the spell ran exactly once')
})

test('run failure does NOT settle (payer keeps USDC) → 502', async () => {
  let settled = false
  const facilitator = okFacilitator({ async settle() { settled = true; return { success: true, transaction: '0xtx' } } })
  const { server, log } = await harness({
    facilitator,
    runSpell: async ({ modusId }): Promise<Run> => ({ id: 'run-x', status: 'failed', modusId, failure: { code: 'oom', message: 'out of memory' } }),
  })
  const res = await request(server).post('/api/v1/x402/agents/camel42/spell/memeify').set('x-payment', 'paid').send({ inputs: {} })
  assert.equal(res.status, 502)
  assert.equal(res.body.error.code, 'EXECUTION_FAILED')
  assert.equal(settled, false, 'settlement NOT attempted on a failed run')
  assert.equal((await log.find('sig-123'))?.status, 'FAILED')
})

test('feature-flagged off → 404', async () => {
  const { server } = await harness({ enabled: false })
  const get = await request(server).get('/api/v1/x402/agents/camel42/spell/memeify')
  const post = await request(server).post('/api/v1/x402/agents/camel42/spell/memeify').set('x-payment', 'paid').send({ inputs: {} })
  assert.equal(get.status, 404)
  assert.equal(post.status, 404)
})

// A hub whose recentFor replays a pre-seeded event tape — so awaitTerminal resolves
// deterministically (no test timing races), while still exercising the relay + terminal path.
function tapeHub(runId: string, events: Array<Record<string, unknown>>): NonNullable<X402AgentDeps['hub']> {
  return { subscribe: () => () => {}, recentFor: (id) => (id === runId ? events as any : []) }
}
const pendingRun = (id = 'run-async'): Run => ({ id, status: 'pending', modusId: 'agent-ws-camel42' })

test('async run + Accept: text/event-stream → streams Progressus phases then a result event', async () => {
  const events = [
    { runId: 'run-async', kind: 'progress', terminal: false, progressus: { phase: 'downloading', target: 'model', progress: { done: 2, total: 5, unit: 'items' } } },
    { runId: 'run-async', kind: 'progress', terminal: false, progressus: { phase: 'executing', progress: { done: 18, total: 30, unit: 'steps' } } },
    { runId: 'run-async', kind: 'complete', terminal: true, status: 'complete' },
  ]
  const { server, log } = await harness({
    runSpell: async () => pendingRun(),
    hub: tapeHub('run-async', events),
    getRun: async (id) => ({ id, status: 'complete', modusId: 'm', exitus: { image: 'https://out/final.png' } }),
  })
  const res = await request(server).post('/api/v1/x402/agents/camel42/spell/memeify')
    .set('x-payment', 'paid').set('accept', 'text/event-stream').send({ inputs: {} })
  assert.equal(res.status, 200)
  assert.match(res.headers['content-type'], /text\/event-stream/)
  assert.match(res.text, /"kind":"progress"[^]*"phase":"downloading"/)   // real phase streamed
  assert.match(res.text, /"phase":"executing"[^]*"done":18/)             // step progress streamed
  assert.match(res.text, /"kind":"result"[^]*final\.png/)                // final outputs streamed
  assert.equal((await log.find('sig-123'))?.status, 'SETTLED')           // settled on completion
})

test('async run WITHOUT SSE → long-polls to completion, returns JSON with the exitus', async () => {
  const { server } = await harness({
    runSpell: async () => pendingRun(),
    hub: tapeHub('run-async', [{ runId: 'run-async', kind: 'complete', terminal: true, status: 'complete' }]),
    getRun: async (id) => ({ id, status: 'complete', modusId: 'm', exitus: { image: 'https://out/j.png' } }),
  })
  const res = await request(server).post('/api/v1/x402/agents/camel42/spell/memeify').set('x-payment', 'paid').send({ inputs: {} })
  assert.equal(res.status, 200)
  assert.deepEqual(res.body.outputs, { image: 'https://out/j.png' })     // awaited real completion
})

test('async run that FAILS → no settle (SSE failed event)', async () => {
  let settled = false
  const { server } = await harness({
    facilitator: okFacilitator({ async settle() { settled = true; return { success: true, transaction: '0xtx' } } }),
    runSpell: async () => pendingRun(),
    hub: tapeHub('run-async', [{ runId: 'run-async', kind: 'failed', terminal: true, status: 'failed' }]),
    getRun: async (id) => ({ id, status: 'failed', modusId: 'm', failure: { code: 'oom', message: 'out of memory' } }),
  })
  const res = await request(server).post('/api/v1/x402/agents/camel42/spell/memeify')
    .set('x-payment', 'paid').set('accept', 'text/event-stream').send({ inputs: {} })
  assert.match(res.text, /"kind":"failed"/)
  assert.equal(settled, false)
})

test('run a SELECTED modus (picker): body.modusId owned by the agent → runs it', async () => {
  const ran: string[] = []
  const { server } = await harness({
    modi: [{ id: 'owned', nomen: 'extra', auctor: { animaId: 'anima-agent' } }],
    runSpell: async ({ modusId }): Promise<Run> => { ran.push(modusId); return { id: 'r', status: 'complete', modusId, exitus: {} } },
  })
  const res = await request(server).post('/api/v1/x402/agents/camel42/spell/extra').set('x-payment', 'paid').send({ inputs: {}, modusId: 'owned' })
  assert.equal(res.status, 200)
  assert.deepEqual(ran, ['owned'])                      // it ran the SELECTED modus, not the workspace one
})

test('run a modus NOT owned by the agent → 403 NOT_AGENT_MODUS (no run, no settle)', async () => {
  let ran = false
  const { server } = await harness({
    modi: [{ id: 'foreign', nomen: 'other', auctor: { animaId: 'someone-else' } }],
    runSpell: async ({ modusId }): Promise<Run> => { ran = true; return { id: 'r', status: 'complete', modusId } },
  })
  const res = await request(server).post('/api/v1/x402/agents/camel42/spell/other').set('x-payment', 'paid').send({ inputs: {}, modusId: 'foreign' })
  assert.equal(res.status, 403)
  assert.equal(res.body.error.code, 'NOT_AGENT_MODUS')
  assert.equal(ran, false)
})

test('unknown agent → 404', async () => {
  const { server } = await harness()
  const res = await request(server).get('/api/v1/x402/agents/ghost/spell/memeify')
  assert.equal(res.status, 404)
  assert.equal(res.body.error.code, 'AGENT_NOT_FOUND')
})

// ── request-body/query validation (hardening) ──────────────────────────────────

test('GET discover with a valid modusId query → 200', async () => {
  const { server } = await harness({ modi: [{ id: 'owned', nomen: 'extra', auctor: { animaId: 'anima-agent' } }] })
  const res = await request(server).get('/api/v1/x402/agents/camel42/spell/extra').query({ modusId: 'owned' })
  assert.equal(res.status, 200)
  assert.equal(res.body.agentId, 'camel42')
})

test('GET discover with a non-string modusId query → 400 input.malformed', async () => {
  const { server } = await harness()
  const res = await request(server).get('/api/v1/x402/agents/camel42/spell/memeify?modusId[]=a&modusId[]=b')
  assert.equal(res.status, 400)
  assert.equal(res.body.error.code, 'input.malformed')
})

test('POST run with inputs as an array → 400 input.malformed', async () => {
  const { server } = await harness()
  const res = await request(server).post('/api/v1/x402/agents/camel42/spell/memeify').send({ inputs: ['a', 'b'] })
  assert.equal(res.status, 400)
  assert.equal(res.body.error.code, 'input.malformed')
})

test('POST run with inputs as a string → 400 input.malformed', async () => {
  const { server } = await harness()
  const res = await request(server).post('/api/v1/x402/agents/camel42/spell/memeify').send({ inputs: 'not-an-object' })
  assert.equal(res.status, 400)
  assert.equal(res.body.error.code, 'input.malformed')
})

test('POST run with a valid object inputs → unaffected (still 402 without payment)', async () => {
  const { server } = await harness()
  const res = await request(server).post('/api/v1/x402/agents/camel42/spell/memeify').send({ inputs: { prompt: 'a cat' } })
  assert.equal(res.status, 402)
  assert.equal(res.body.error, 'PAYMENT_REQUIRED')
})

test('POST run with a non-string modusId body → 400 input.malformed', async () => {
  const { server } = await harness()
  const res = await request(server).post('/api/v1/x402/agents/camel42/spell/memeify').send({ inputs: {}, modusId: 123 })
  assert.equal(res.status, 400)
  assert.equal(res.body.error.code, 'input.malformed')
})

test('rate limiter dep: mounted for GET discover, NOT for POST run', async () => {
  let getHits = 0
  let postHits = 0
  const countingGet: express.RequestHandler = (_req, _res, next) => { getHits++; next() }
  const { server } = await harness({ rateLimiters: { quote: countingGet } })
  await request(server).get('/api/v1/x402/agents/camel42/spell/memeify')
  await request(server).post('/api/v1/x402/agents/camel42/spell/memeify').send({ inputs: {} })
  assert.equal(getHits, 1, 'the injected limiter ran for the GET discover route')
  assert.equal(postHits, 0, 'the injected limiter is never mounted on the POST run route')
})
