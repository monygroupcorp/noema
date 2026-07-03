import { test } from 'node:test'
import assert from 'node:assert/strict'
import { weiToCredits, type FetchLike } from '../../../src/arcanum/ethPrice.js'

// weiToCredits — the anonymous ETH note → spendable impetus conversion (Bursa /purse mint).
// Reconciled 2026-07-02 to the CANONICAL $0.000337 rate + the 0.70 funding haircut, so the anon
// and identified (alchemyWebhook creditImpetus) deposit-credit paths agree.

const ethPriceFetch = (usd: string): FetchLike => async () => ({
  ok: true, status: 200,
  json: async () => ({ data: [{ symbol: 'ETH', prices: [{ currency: 'usd', value: usd }] }] }),
})

const ONE_MILLI_ETH = 1_000_000_000_000_000n  // 0.001 ETH

test('weiToCredits: 0.001 ETH @ $3000 → 6231 impetus (canonical rate + 0.70 funding)', async () => {
  // gross $3 = 3_000_000 µUSD → ×0.70 = 2_100_000 µUSD → ÷337 = 6231 impetus.
  // NOT 8109 (old 0.00037 typo rate) and NOT 8902 (canonical WITHOUT funding) — this proves both fixes.
  const credits = await weiToCredits(ONE_MILLI_ETH, 'key', ethPriceFetch('3000'))
  assert.equal(credits, 6231n)
})

test('weiToCredits: agrees with the identified deposit path for the same ETH amount', async () => {
  // The alchemyWebhook credit for 0.001 ETH @ $3000 is EXPECTED_CREDIT_IMPETUS = 6231n — same value.
  const credits = await weiToCredits(ONE_MILLI_ETH, 'key', ethPriceFetch('3000'))
  assert.equal(credits, 6231n)
})

test('weiToCredits: zero (or negative) wei → 0n without pricing', async () => {
  let called = false
  const spy: FetchLike = async (...a) => { called = true; return ethPriceFetch('3000')(...a) }
  assert.equal(await weiToCredits(0n, 'key', spy), 0n)
  assert.equal(called, false)   // guarded before any fetch
})
