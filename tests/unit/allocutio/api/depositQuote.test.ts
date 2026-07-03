import { test } from 'node:test'
import assert from 'node:assert/strict'
import { CrystalApi, type CrystalApiDeps } from '../../../../src/allocutio/api/CrystalApi.js'
import { ApiError } from '../../../../src/allocutio/api/errors.js'
import { fixedPricer, nullPricer } from '../../../../src/crystal/AssetPricer.js'

const VAULT = '0x00000001152d633eb2ac3cf91eac9994aeefc021'
const ETH = '0x0000000000000000000000000000000000000000'
const FAVORED = '0x524cab2ec69124574082676e6f654a18df49a048'  // funding override = 1.0
const ONE_MILLI_ETH = (1_000_000_000_000_000n).toString()   // 0.001 ETH

// depositQuote/depositConfig only read `pricer` + `depositAddress`, so a minimal deps cast is safe.
function api(over: Partial<CrystalApiDeps> = {}): CrystalApi {
  return new CrystalApi({ pricer: fixedPricer(3000, 18), depositAddress: VAULT, ...over } as unknown as CrystalApiDeps)
}

test('depositConfig: canonical rate, default funding, address, chains', () => {
  const c = api().depositConfig()
  assert.equal(c.depositAddress, VAULT)
  assert.equal(c.pointsPerUsd, 2967)             // 1 / 0.000337
  assert.equal(c.defaultFundingRatePct, 70)
  assert.deepEqual(c.chains.map(x => x.chainId), [1, 8453])
})

test('depositQuote: 0.001 ETH @ $3000 → 6231 points (gross $3, 0.70 funding)', async () => {
  const q = await api().depositQuote({ chainId: '1', token: ETH, amount: ONE_MILLI_ETH })
  assert.equal(q.grossUsd, '3.000000')
  assert.equal(q.grossUsdMicro, '3000000')
  assert.equal(q.fundingRatePct, 70)
  assert.equal(q.pointsQuoted, '6231')
  assert.equal(q.depositAddress, VAULT)
})

test('depositQuote: a favored asset (override 1.0) quotes the full value, no haircut', async () => {
  const q = await api().depositQuote({ chainId: '1', token: FAVORED, amount: ONE_MILLI_ETH })
  assert.equal(q.fundingRatePct, 100)
  assert.equal(q.pointsQuoted, (3_000_000n / 337n).toString())  // 8902
})

test('depositQuote: unpriceable asset → 422 deposit.price_unavailable', async () => {
  await assert.rejects(
    () => api({ pricer: nullPricer }).depositQuote({ chainId: '1', token: ETH, amount: ONE_MILLI_ETH }),
    (e: unknown) => e instanceof ApiError && e.httpStatus === 422 && e.code === 'deposit.price_unavailable',
  )
})

test('depositQuote: no pricer configured → 503 deposit unavailable', async () => {
  await assert.rejects(
    () => api({ pricer: undefined }).depositQuote({ chainId: '1', token: ETH, amount: ONE_MILLI_ETH }),
    (e: unknown) => e instanceof ApiError && e.httpStatus === 503,
  )
})

test('depositQuote: malformed token / amount → 400', async () => {
  await assert.rejects(
    () => api().depositQuote({ chainId: '1', token: 'not-an-address', amount: ONE_MILLI_ETH }),
    (e: unknown) => e instanceof ApiError && e.httpStatus === 400,
  )
  await assert.rejects(
    () => api().depositQuote({ chainId: '1', token: ETH, amount: 'xyz' }),
    (e: unknown) => e instanceof ApiError && e.httpStatus === 400,
  )
  await assert.rejects(
    () => api().depositQuote({ chainId: '1', token: ETH, amount: '0' }),
    (e: unknown) => e instanceof ApiError && e.httpStatus === 400,
  )
})
