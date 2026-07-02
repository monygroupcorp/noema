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
} = {}) {
  const legati = new MemoryLegatus()
  const modorum = new MemoryModorum()
  await modorum.register({ ...CAMEL_TEMPLATE_MODUS, id: 'agent-ws-camel42' })
  await legati.create({
    agentId: 'camel42', ownerAddress: OWNER, animaId: 'anima-agent', treasuryId: 'camelcabal-1',
    issuerId: 'https://camelcabal.fun', scope: ['generate'], revokeToken: 'rvk',
    ...(opts.withSpell === false ? {} : { workspaceModusId: 'agent-ws-camel42' }),
  })
  const log = new MemoryX402Log()
  const rewards: Array<{ ownerAddress: string; grossImpetus: bigint }> = []
  const deps: X402AgentDeps = {
    legati, modorum, log,
    facilitator: opts.facilitator ?? okFacilitator(),
    config: { ...DEFAULT_X402_CONFIG, payTo: '0xReceiver' },
    enabled: opts.enabled ?? true,
    quoteImpetus: async () => 1000n,
    runSpell: opts.runSpell ?? (async ({ modusId }): Promise<Run> => ({ id: 'run-1', status: 'complete', modusId, exitus: { image: 'https://out/img.png' } })),
    distributeOwnerReward: async (input) => { rewards.push({ ownerAddress: input.ownerAddress, grossImpetus: input.grossImpetus }); return { status: 'credited' } },
    publicBase: 'https://noema.art',
  }
  const server = express()
  server.use('/api/v1/x402', express.json(), createX402AgentRouter(deps))
  return { server, log, rewards }
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

test('happy path: verify → run → settle → 200 with X-PAYMENT-RESPONSE + owner reward', async () => {
  const { server, log, rewards } = await harness()
  const res = await request(server).post('/api/v1/x402/agents/camel42/spell/memeify').set('x-payment', 'paid').send({ inputs: { prompt: 'a cat' } })
  assert.equal(res.status, 200)
  assert.equal(res.body.runId, 'run-1')
  assert.deepEqual(res.body.outputs, { image: 'https://out/img.png' })
  assert.equal(res.body.x402.settled, true)
  assert.equal(res.body.x402.transaction, '0xtx')
  assert.ok(res.headers['x-payment-response'], 'settlement header set')
  // Payment logged as SETTLED; owner rev-share fired with the gross.
  assert.equal((await log.find('sig-123'))?.status, 'SETTLED')
  assert.equal(rewards.length, 1)
  assert.equal(rewards[0].grossImpetus, 1000n)
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

test('unknown agent → 404', async () => {
  const { server } = await harness()
  const res = await request(server).get('/api/v1/x402/agents/ghost/spell/memeify')
  assert.equal(res.status, 404)
  assert.equal(res.body.error.code, 'AGENT_NOT_FOUND')
})
