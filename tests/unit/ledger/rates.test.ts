import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  IMPETUS_USD_RATE, BOOT_AMORTIZE_OVER,
  impetusPerSecondFromHourly, computeBootCostImpetus, bootShare,
  tierOf, impetusFor, modoHostFor,
} from '../../../src/ledger/rates.js'
import type { Materia } from '../../../src/types/materia.js'
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

// ─── Phase B pricing decision: tierOf / impetusFor / modoHostFor ─────────────

const mat = (bootCostImpetus = 0n): Materia => ({
  id: 'm1', genus: 'runpod', externusId: 'p1', gpu: 'RTX 4090', vramGb: 24, ramGb: 32,
  impetusPerSecond: 0n, status: 'idle', bootCostImpetus,
}) as Materia

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

test('impetusFor: owner/admin pay base; guest pays base + bootShare', () => {
  const m = mat(239n)   // → bootShare 48
  assert.equal(impetusFor('owner', m, 100n), 100n)
  assert.equal(impetusFor('admin', m, 100n), 100n)
  assert.equal(impetusFor('guest', m, 100n), 148n)
})

test('impetusFor: guest with no bootCost falls back to base (legacy pods, fully recovered)', () => {
  assert.equal(impetusFor('guest', mat(0n), 100n), 100n)
})

test('modoHostFor: only set for guest tier + identified host (Phase B scope)', () => {
  assert.deepEqual(modoHostFor('guest', hosp({ animaId: 'a' })), { animaId: 'a' })
  assert.equal(modoHostFor('owner', hosp({ animaId: 'a' })), undefined)
  assert.equal(modoHostFor('admin', hosp({ animaId: 'a' })), undefined)
  // Anonymous host: Phase B leaves it unset — Phase C extends the spend payload.
  assert.equal(modoHostFor('guest', hosp({ commitment: 'C1' })), undefined)
  assert.equal(modoHostFor('guest', null), undefined)
})
