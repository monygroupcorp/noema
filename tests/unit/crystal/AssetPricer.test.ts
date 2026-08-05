import { test } from 'node:test'
import assert from 'node:assert/strict'
import { AlchemyPricer, fixedPricer, nullPricer } from '../../../src/crystal/AssetPricer.js'
import type { FetchLike } from '../../../src/arcanum/ethPrice.js'

const NATIVE_ETH = '0x0000000000000000000000000000000000000000'
const USDC = '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48'

// A fake fetch that routes by URL: Alchemy by-symbol (ETH), by-address (ERC-20 price), RPC (metadata).
function fakeFetch(routes: { ethPrice?: string; erc20Price?: string | null; decimals?: number | null }): FetchLike {
  return async (url: string) => {
    const ok = (body: unknown) => ({ ok: true, status: 200, json: async () => body })
    if (url.includes('by-symbol')) {
      return ok({ data: [{ symbol: 'ETH', prices: [{ currency: 'usd', value: routes.ethPrice ?? '3000' }] }] })
    }
    if (url.includes('by-address')) {
      const prices = routes.erc20Price == null ? [] : [{ currency: 'usd', value: routes.erc20Price }]
      return ok({ data: [{ address: USDC, prices }] })
    }
    // alchemy_getTokenMetadata (RPC endpoint)
    return ok({ result: { decimals: routes.decimals ?? 6 } })
  }
}

test('AlchemyPricer: native ETH → micro-USD at 18 decimals', async () => {
  const p = new AlchemyPricer('key', fakeFetch({ ethPrice: '3000' }))
  // 0.001 ETH (1e15 wei) × $3000 = $3 = 3_000_000 micro-USD
  assert.equal(await p.usdFmv('1', NATIVE_ETH, 1_000_000_000_000_000n), 3_000_000n)
})

test('AlchemyPricer: ERC-20 uses by-address price + metadata decimals', async () => {
  const p = new AlchemyPricer('key', fakeFetch({ erc20Price: '1', decimals: 6 }))
  // 5 USDC (6 decimals → 5_000_000 base units) × $1 = $5 = 5_000_000 micro-USD
  assert.equal(await p.usdFmv('1', USDC, 5_000_000n), 5_000_000n)
})

test('AlchemyPricer: unpriceable ERC-20 (no price) → null, never a silent zero', async () => {
  const p = new AlchemyPricer('key', fakeFetch({ erc20Price: null, decimals: 6 }))
  assert.equal(await p.usdFmv('1', USDC, 5_000_000n), null)
})

test('AlchemyPricer: unsupported chain → null', async () => {
  const p = new AlchemyPricer('key', fakeFetch({ erc20Price: '1', decimals: 6 }))
  assert.equal(await p.usdFmv('999', USDC, 5_000_000n), null)
})

test('AlchemyPricer: a fetch failure resolves to null (does not throw)', async () => {
  const throwing: FetchLike = async () => { throw new Error('network down') }
  const p = new AlchemyPricer('key', throwing)
  assert.equal(await p.usdFmv('1', USDC, 5_000_000n), null)
})

test('fixedPricer + nullPricer helpers behave as documented', async () => {
  assert.equal(await fixedPricer(3000, 18).usdFmv('1', NATIVE_ETH, 1_000_000_000_000_000n), 3_000_000n)
  assert.equal(await nullPricer.usdFmv('1', NATIVE_ETH, 1n), null)
})
