import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildPlatformCard, buildAgentCard } from '../../../src/allocutio/api/agentCard.js'
import type { PlatformCardConfig, AgentCardInput } from '../../../src/allocutio/api/agentCard.js'
import type { Legatus } from '../../../src/types/legatus.js'
import type { Modus } from '../../../src/types/modus.js'
import type { X402Accept, X402Quote } from '../../../src/types/x402.js'

const ERC8004_REGISTRATION_V1 = 'https://eips.ethereum.org/EIPS/eip-8004#registration-v1'

test('buildPlatformCard emits the expected top-level fields and service endpoints', () => {
  const cfg: PlatformCardConfig = {
    name: 'NOEMA',
    description: 'The aggregate profile',
    publicBase: 'https://noema.example/',
  }

  const card = buildPlatformCard(cfg)

  assert.equal(card.type, ERC8004_REGISTRATION_V1)
  assert.equal(card.name, 'NOEMA')
  assert.equal(card.description, 'The aggregate profile')
  assert.equal('image' in card, false)

  assert.deepEqual(card.services, [
    { name: 'web', endpoint: 'https://noema.example', version: '1.0.0' },
    { name: 'MCP', endpoint: 'https://noema.example/api/v1/mcp', version: '2025-06-18' },
  ])

  assert.equal(card.x402Support, true)
  assert.equal(card.active, true)
  assert.deepEqual(card.registrations, [])
  assert.deepEqual(card.supportedTrust, ['reputation'])
  assert.deepEqual(card.capabilities, {
    categories: ['text-to-image', 'image-to-image', 'text-to-video'],
    paymentMethods: ['x402', 'credits'],
  })
})

test('buildPlatformCard includes image when provided and registrations when configured', () => {
  const cfg: PlatformCardConfig = {
    name: 'NOEMA',
    description: 'desc',
    publicBase: 'https://noema.example',
    image: 'https://noema.example/logo.png',
    registration: { agentId: 7, agentRegistry: 'eip155:8453:0xabc' },
    categories: ['custom-category'],
  }

  const card = buildPlatformCard(cfg)

  assert.equal(card.image, 'https://noema.example/logo.png')
  assert.deepEqual(card.registrations, [{ agentId: 7, agentRegistry: 'eip155:8453:0xabc' }])
  assert.deepEqual((card.capabilities as { categories: string[] }).categories, ['custom-category'])
})

function makeLegatus(overrides: Partial<AgentCardInput['legatus']> = {}): AgentCardInput['legatus'] {
  return {
    agentId: 'camel42',
    tokenId: undefined,
    adapter: undefined,
    chainId: undefined,
    ownerAddress: '0x0000000000000000000000000000000000000a',
    ...overrides,
  }
}

function makeModus(overrides: Partial<AgentCardInput['modus']> = {}): AgentCardInput['modus'] {
  return {
    nomen: 'text-to-image',
    aditus: {
      prompt: { type: 'text', required: true },
    } as Modus['aditus'],
    ...overrides,
  }
}

const quote: X402Quote = {
  baseCostUsd: 0.1,
  markupUsd: 0.02,
  totalCostUsd: 0.12,
  totalCostAtomic: '120000',
  currency: 'USDC',
  network: 'eip155:8453',
  payTo: '0x0000000000000000000000000000000000000b',
}

const accept: X402Accept = {
  scheme: 'exact',
  network: 'eip155:8453',
  asset: '0x0000000000000000000000000000000000000c',
  amount: '120000',
  payTo: '0x0000000000000000000000000000000000000b',
  maxTimeoutSeconds: 60,
}

test('buildAgentCard omits registrations when the legatus has no tokenId', () => {
  const input: AgentCardInput = {
    legatus: makeLegatus(),
    modus: makeModus(),
    quote,
    accept,
    publicBase: 'https://noema.example/',
  }

  const card = buildAgentCard(input)

  assert.equal(card.type, ERC8004_REGISTRATION_V1)
  assert.equal(card.name, 'Agent camel42')
  assert.equal(card.description, 'On-chain agent "text-to-image" — pay-per-call via x402.')
  assert.deepEqual(card.registrations, [])
})

test('buildAgentCard includes registrations only when tokenId + adapter are present and valid', () => {
  const input: AgentCardInput = {
    legatus: makeLegatus({ tokenId: '99', adapter: '0xdeadbeef', chainId: 8453 }),
    modus: makeModus(),
    quote,
    accept,
    publicBase: 'https://noema.example',
  }

  const card = buildAgentCard(input)

  assert.deepEqual(card.registrations, [{ agentId: 99, agentRegistry: 'eip155:8453:0xdeadbeef' }])
})

test('buildAgentCard registrations default chainId to 1 when absent', () => {
  const input: AgentCardInput = {
    legatus: makeLegatus({ tokenId: '5', adapter: '0xabc' }),
    modus: makeModus(),
    quote,
    accept,
    publicBase: 'https://noema.example',
  }

  const card = buildAgentCard(input)

  assert.deepEqual(card.registrations, [{ agentId: 5, agentRegistry: 'eip155:1:0xabc' }])
})

test('buildAgentCard omits registrations when tokenId is non-numeric', () => {
  const input: AgentCardInput = {
    legatus: makeLegatus({ tokenId: 'not-a-number', adapter: '0xabc' }),
    modus: makeModus(),
    quote,
    accept,
    publicBase: 'https://noema.example',
  }

  const card = buildAgentCard(input)

  assert.deepEqual(card.registrations, [])
})

test('buildAgentCard emits the x402 endpoint, service, and price block from the code', () => {
  const input: AgentCardInput = {
    legatus: makeLegatus({ agentId: 'camel7' }),
    modus: makeModus({ nomen: 'upscale image' }),
    quote,
    accept,
    publicBase: 'https://noema.example/',
  }

  const card = buildAgentCard(input)
  const expectedEndpoint = 'https://noema.example/api/v1/x402/agents/camel7/spell/upscale%20image'

  assert.deepEqual(card.services, [{ name: 'x402', endpoint: expectedEndpoint, version: '2' }])
  assert.equal(card.x402Support, true)
  assert.equal(card.active, true)
  assert.deepEqual(card.supportedTrust, ['reputation'])

  const capabilities = card.capabilities as {
    paymentMethods: string[]
    x402: {
      endpoint: string
      input: unknown
      price: { amount: string; currency: string; network: string; asset: string; payTo: string }
    }
  }

  assert.deepEqual(capabilities.paymentMethods, ['x402'])
  assert.equal(capabilities.x402.endpoint, expectedEndpoint)
  assert.deepEqual(capabilities.x402.input, {
    type: 'object',
    properties: { prompt: { type: 'string' } },
    required: ['prompt'],
  })
  assert.deepEqual(capabilities.x402.price, {
    amount: accept.amount,
    currency: quote.currency,
    network: accept.network,
    asset: accept.asset,
    payTo: accept.payTo,
  })
})

test('buildAgentCard uses default description when none is given, and honors an explicit one', () => {
  const base: AgentCardInput = {
    legatus: makeLegatus({ agentId: 'camel1' }),
    modus: makeModus({ nomen: 'my-spell' }),
    quote,
    accept,
    publicBase: 'https://noema.example',
  }

  const defaulted = buildAgentCard(base)
  assert.equal(defaulted.description, 'On-chain agent "my-spell" — pay-per-call via x402.')

  const custom = buildAgentCard({ ...base, description: 'Custom description' })
  assert.equal(custom.description, 'Custom description')
})

test('buildAgentCard includes image only when provided', () => {
  const withoutImage: AgentCardInput = {
    legatus: makeLegatus(),
    modus: makeModus(),
    quote,
    accept,
    publicBase: 'https://noema.example',
  }
  assert.equal('image' in buildAgentCard(withoutImage), false)

  const withImage: AgentCardInput = { ...withoutImage, image: 'https://noema.example/agent.png' }
  assert.equal(buildAgentCard(withImage).image, 'https://noema.example/agent.png')
})
