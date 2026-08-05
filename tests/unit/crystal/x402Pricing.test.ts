import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildQuote, buildPaymentRequirements, usdToAtomic, DEFAULT_X402_CONFIG, type X402Config } from '../../../src/crystal/x402Pricing.js'

const CFG: X402Config = { ...DEFAULT_X402_CONFIG, payTo: '0xReceiver' }

test('usdToAtomic rounds up to 6-decimal USDC atomic units', () => {
  assert.equal(usdToAtomic(0.4044), '404400')
  assert.equal(usdToAtomic(0.0000001), '1', 'rounds up, never under-charges')
  assert.equal(usdToAtomic(1), '1000000')
})

test('buildQuote converts impetus → USD and applies the 20% markup', () => {
  const q = buildQuote(1000n, CFG) // 1000 impetus * $0.000337 = $0.337 base
  assert.ok(Math.abs(q.baseCostUsd - 0.337) < 1e-9)
  assert.ok(Math.abs(q.markupUsd - 0.0674) < 1e-9)   // 20% of base
  assert.ok(Math.abs(q.totalCostUsd - 0.4044) < 1e-9)
  // ceil (never under-charge); the extra atomic unit is float accumulation (0.40440000000000004).
  assert.equal(q.totalCostAtomic, '404401')
  assert.equal(q.currency, 'USDC')
  assert.equal(q.payTo, '0xReceiver')
  assert.equal(q.network, 'eip155:8453')
})

test('buildPaymentRequirements produces a valid x402v2 accepts array', () => {
  const q = buildQuote(1000n, CFG)
  const pr = buildPaymentRequirements(q, CFG, { url: 'https://noema.art/api/v1/x402/agents/camel42/spell/x', description: 'Test' })
  assert.equal(pr.x402Version, 2)
  assert.equal(pr.resource.mimeType, 'application/json')
  assert.equal(pr.accepts.length, 1)
  const a = pr.accepts[0]
  assert.equal(a.scheme, 'exact')
  assert.equal(a.amount, q.totalCostAtomic)
  assert.equal(a.payTo, '0xReceiver')
  assert.equal(a.asset, DEFAULT_X402_CONFIG.asset)
  assert.equal(a.extra?.name, 'USD Coin')
})
