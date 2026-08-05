// Hermetic (express) test of the ERC-8004 agent cards (ADR-0011 §7/§8, Phase 2).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import express from 'express'
import request from 'supertest'
import { createAgentCardRouter, type AgentCardRouterDeps } from '../../../../src/allocutio/api/agentCardRouter.js'
import { MemoryLegatus } from '../../../../src/crystal/MemoryLegatus.js'
import { MemoryModorum } from '../../../../src/execution/MemoryModorum.js'
import { CAMEL_TEMPLATE_MODUS } from '../../../../src/crystal/seeds/camel.js'
import { DEFAULT_X402_CONFIG } from '../../../../src/crystal/x402Pricing.js'

const OWNER = '0x' + 'a'.repeat(40)
const ADAPTER = '0x' + 'b'.repeat(40)

async function harness(opts: { withSpell?: boolean } = {}) {
  const legati = new MemoryLegatus()
  const modorum = new MemoryModorum()
  await modorum.register({ ...CAMEL_TEMPLATE_MODUS, id: 'agent-ws-camel42', nomen: 'memeify' })
  await legati.create({
    agentId: 'camel42', tokenId: '42', adapter: ADAPTER, chainId: 8453,
    ownerAddress: OWNER, animaId: 'anima-agent', treasuryId: 'camelcabal-1',
    issuerId: 'https://camelcabal.fun', scope: ['generate'], revokeToken: 'rvk',
    ...(opts.withSpell === false ? {} : { workspaceModusId: 'agent-ws-camel42' }),
  })
  const deps: AgentCardRouterDeps = {
    legati, modorum,
    quoteImpetus: async () => 1000n,
    x402Config: { ...DEFAULT_X402_CONFIG, payTo: '0xReceiver' },
    publicBase: 'https://noema.art',
    platform: { name: 'NOEMA', description: 'infra', publicBase: 'https://noema.art' },
  }
  const app = express()
  app.use(createAgentCardRouter(deps))
  return app
}

test('platform card: ERC-8004 registration-v1 shape + x402 support', async () => {
  const res = await request(await harness()).get('/.well-known/agent-card.json')
  assert.equal(res.status, 200)
  assert.equal(res.body.type, 'https://eips.ethereum.org/EIPS/eip-8004#registration-v1')
  assert.equal(res.body.name, 'NOEMA')
  assert.equal(res.body.x402Support, true)
  assert.ok(res.body.services.some((s: { name: string }) => s.name === 'MCP'))
})

test('per-agent card: advertises the x402 endpoint, price, input schema + on-chain registration', async () => {
  const res = await request(await harness()).get('/api/v1/agents/camel42/card')
  assert.equal(res.status, 200)
  assert.equal(res.body.type, 'https://eips.ethereum.org/EIPS/eip-8004#registration-v1')
  assert.equal(res.body.x402Support, true)
  // the x402 service endpoint points at the agent's spell route
  assert.equal(res.body.services[0].name, 'x402')
  assert.equal(res.body.services[0].endpoint, 'https://noema.art/api/v1/x402/agents/camel42/spell/memeify')
  // the capability block carries the callable contract
  const x = res.body.capabilities.x402
  assert.ok(x.input.properties.prompt, 'input JSON schema from the modus aditus')
  assert.equal(x.price.currency, 'USDC')
  assert.equal(x.price.payTo, '0xReceiver')
  assert.ok(x.price.amount)
  // on-chain registration: tokenId @ the adapter registry
  assert.deepEqual(res.body.registrations, [{ agentId: 42, agentRegistry: `eip155:8453:${ADAPTER}` }])
})

test('per-agent card: unknown agent → 404', async () => {
  const res = await request(await harness()).get('/api/v1/agents/nope/card')
  assert.equal(res.status, 404)
  assert.equal(res.body.error.code, 'AGENT_NOT_FOUND')
})

test('per-agent card: agent with no callable modus → 404 NO_CAPABILITY', async () => {
  const res = await request(await harness({ withSpell: false })).get('/api/v1/agents/camel42/card')
  assert.equal(res.status, 404)
  assert.equal(res.body.error.code, 'NO_CAPABILITY')
})
