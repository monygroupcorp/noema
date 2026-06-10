import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  IMPETUS_USD_RATE, BOOT_AMORTIZE_OVER, WARM_SURCHARGE_IMPETUS, HOST_BONUS_RATE,
  impetusPerSecondFromHourly, impetusForPodMs, computeBootCostImpetus, bootShare,
  tierOf, impetusFor, modoHostFor,
} from '../../../src/ledger/rates.js'
import type { Hospitium } from '../../../src/types/hospitium.js'

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

test('impetusForPodMs bills per-window (rounds once) — far less skew than the coarse per-second rate', () => {
  // 60s on a $0.69/hr pod: 60_000 × 0.69 / 3_600_000 = $0.0115 → ceil(/0.000337) = 35 pts.
  assert.equal(impetusForPodMs(60_000, 0.69), 35n)
  // The OLD coarse path billed impetusPerSecondFromHourly(0.69)=1/s × 60 = 60 pts — a +71% skew.
  assert.equal(impetusPerSecondFromHourly(0.69) * 60n, 60n)
  // Reference $1.2132/hr pod is exact under both.
  assert.equal(impetusForPodMs(3_600_000, 1.2132), 3600n)
})

test('impetusForPodMs is 0 on zero/negative inputs', () => {
  assert.equal(impetusForPodMs(0, 0.69), 0n)
  assert.equal(impetusForPodMs(60_000, 0), 0n)
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

// ─── Phase C pricing decision: tierOf / impetusFor / modoHostFor ─────────────
//
// The per-pod boot accounting (mat(bootCostImpetus)) is gone. Pricing reads
// only the tier; the surcharge is a platform constant. The Materia fixture
// stays out of these tests entirely.

const hosp = (hostKey: Hospitium['hostKey'], adminAnimaIds?: string[]): Hospitium => ({
  id: 'h1', materiaId: 'm1', hostKey, adminAnimaIds, inceptum: new Date(),
})

test('tierOf: owner — identified runner matches identified host', () => {
  assert.equal(tierOf({ animaId: 'a' }, hosp({ animaId: 'a' })), 'owner')
})

test('tierOf: owner — anonymous runner matches anonymous host (same commitment)', () => {
  assert.equal(tierOf({ commitment: 'C1' }, hosp({ commitment: 'C1' })), 'owner')
})

test('tierOf: admin — identified runner in adminAnimaIds', () => {
  assert.equal(tierOf({ animaId: 'b' }, hosp({ animaId: 'a' }, ['b', 'c'])), 'admin')
})

test('tierOf: guest — different identified runner', () => {
  assert.equal(tierOf({ animaId: 'z' }, hosp({ animaId: 'a' }, ['b'])), 'guest')
})

test('tierOf: guest — anonymous runner vs identified host (or any non-match)', () => {
  assert.equal(tierOf({ commitment: 'C1' }, hosp({ animaId: 'a' })), 'guest')
  // commitment runner not in adminAnimaIds — admin requires identified runner.
  assert.equal(tierOf({ commitment: 'C1' }, hosp({ commitment: 'C2' })), 'guest')
})

test('tierOf: guest — defensive fallback when runnerKey or hospitium is missing', () => {
  assert.equal(tierOf(undefined, hosp({ animaId: 'a' })), 'guest')
  assert.equal(tierOf({ animaId: 'a' }, null), 'guest')
  assert.equal(tierOf(undefined, null), 'guest')
})

test('WARM_SURCHARGE_IMPETUS and HOST_BONUS_RATE are the spec defaults', () => {
  assert.equal(WARM_SURCHARGE_IMPETUS, 80n)
  assert.equal(HOST_BONUS_RATE, 80n)
})

test('impetusFor: owner/admin pay base; guest pays base + WARM_SURCHARGE_IMPETUS', () => {
  assert.equal(impetusFor('owner', 100n), 100n)
  assert.equal(impetusFor('admin', 100n), 100n)
  assert.equal(impetusFor('guest', 100n), 100n + WARM_SURCHARGE_IMPETUS)
})

test('modoHostFor: only set for guest tier; passes through both HostKey shapes', () => {
  // identified host
  assert.deepEqual(modoHostFor('guest', hosp({ animaId: 'a' })), { animaId: 'a' })
  // anonymous host — Phase C: commitment-hosts now also flow through (was undefined in Phase B)
  assert.deepEqual(modoHostFor('guest', hosp({ commitment: 'C1' })), { commitment: 'C1' })
  // owner / admin / no Hospitium → undefined
  assert.equal(modoHostFor('owner', hosp({ animaId: 'a' })), undefined)
  assert.equal(modoHostFor('admin', hosp({ animaId: 'a' })), undefined)
  assert.equal(modoHostFor('guest', null), undefined)
})
