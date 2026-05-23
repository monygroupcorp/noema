import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  IMPETUS_USD_RATE, BOOT_AMORTIZE_OVER,
  impetusPerSecondFromHourly, computeBootCostImpetus, bootShare,
} from '../../../src/ledger/rates.js'

test('IMPETUS_USD_RATE matches the documented unit (1pt = $0.000337)', () => {
  assert.equal(IMPETUS_USD_RATE, 0.000337)
})

test('impetusPerSecondFromHourly: $1.2132/hr → 1 pt/s (the platform reference)', () => {
  // At the reference rate, one impetus point IS one second of pod-time.
  assert.equal(impetusPerSecondFromHourly(1.2132), 1n)
})

test('computeBootCostImpetus: 7m on a $0.69/hr pod → known impetus value', () => {
  // 420_000 ms × 0.69 / 3_600_000 = $0.0805 → ceil(0.0805 / 0.000337) = 239 pts.
  const got = computeBootCostImpetus(7 * 60_000, 0.69)
  assert.equal(got, 239n)
})

test('computeBootCostImpetus is 0 on zero/negative inputs', () => {
  assert.equal(computeBootCostImpetus(0, 0.69), 0n)
  assert.equal(computeBootCostImpetus(-1, 0.69), 0n)
  assert.equal(computeBootCostImpetus(60_000, 0), 0n)
})

test('bootShare: ceil-divides bootCost by BOOT_AMORTIZE_OVER until recovered', () => {
  // 239 pts amortized over 5 → ceil(239/5) = 48 pts/guest until host is whole.
  assert.equal(bootShare(239n, 0n), 48n)
  assert.equal(bootShare(239n, 47n), 48n, 'still charging while host not whole')
  assert.equal(bootShare(239n, 240n), 0n, 'host recovered → surcharge stops')
  assert.equal(bootShare(0n, 0n), 0n)
})

test('BOOT_AMORTIZE_OVER is the spec default (5)', () => {
  assert.equal(BOOT_AMORTIZE_OVER, 5n)
})
