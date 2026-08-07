// Hermetic (express) test of the ERC-8004 platform agent card (ADR-0011 §5).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import express from 'express'
import request from 'supertest'
import { createAgentCardRouter, type AgentCardRouterDeps } from '../../../../src/allocutio/api/agentCardRouter.js'
import { MemoryLegatus } from '../../../../src/crystal/MemoryLegatus.js'
import { MemoryModorum } from '../../../../src/execution/MemoryModorum.js'
import { DEFAULT_X402_CONFIG } from '../../../../src/crystal/x402Pricing.js'

async function harness() {
  const deps: AgentCardRouterDeps = {
    legati: new MemoryLegatus(),
    modorum: new MemoryModorum(),
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
