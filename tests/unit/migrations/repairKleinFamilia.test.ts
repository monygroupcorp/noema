// =============================================================================
// repairKleinFamilia.test.ts — noema-201
//
// Guards the pure decision logic behind
// `scripts/migrations/2026_08_repair_klein_familia.ts`: a stale `familia`
// value is only ever repointed once the target familia has been proven to
// exist, and only the named stale value is ever touched.
//
// Hermetic: no Mongo. The transform is a pure function of (record, whether the
// target was proven) precisely so this can be tested without a live db.
// =============================================================================

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { decideRepair, STALE_FAMILIA, TARGET_FAMILIA } from '../../../scripts/migrations/2026_08_repair_klein_familia.js'

describe('decideRepair', () => {
  test('stale familia, target proven -> repair', () => {
    const decision = decideRepair({ id: 'a', _id: 'a', genus: 'lora', familia: STALE_FAMILIA }, true)
    assert.equal(decision.kind, 'repair')
    if (decision.kind !== 'repair') throw new Error('unreachable')
    assert.equal(decision.outcome.from, STALE_FAMILIA)
    assert.equal(decision.outcome.to, TARGET_FAMILIA)
  })

  test('stale familia, target NOT proven -> skip-no-target, nothing written', () => {
    const decision = decideRepair({ id: 'b', _id: 'b', genus: 'lora', familia: STALE_FAMILIA }, false)
    assert.equal(decision.kind, 'skip-no-target')
  })

  test('familia already the target value -> skip-not-stale, untouched', () => {
    const decision = decideRepair({ id: 'c', _id: 'c', genus: 'lora', familia: TARGET_FAMILIA }, true)
    assert.equal(decision.kind, 'skip-not-stale')
  })

  test('unrelated familia -> skip-not-stale, untouched (no generalising beyond the named value)', () => {
    const decision = decideRepair({ id: 'd', _id: 'd', genus: 'lora', familia: 'sdxl' }, true)
    assert.equal(decision.kind, 'skip-not-stale')
  })

  test('no familia at all -> skip-not-stale, untouched', () => {
    const decision = decideRepair({ id: 'e', _id: 'e', genus: 'lora' }, true)
    assert.equal(decision.kind, 'skip-not-stale')
  })

  test('second run over an already-repaired record is a no-op', () => {
    const first = decideRepair({ id: 'f', _id: 'f', genus: 'lora', familia: STALE_FAMILIA }, true)
    assert.equal(first.kind, 'repair')
    // After the write, the record carries TARGET_FAMILIA — re-running sees skip-not-stale.
    const second = decideRepair({ id: 'f', _id: 'f', genus: 'lora', familia: TARGET_FAMILIA }, true)
    assert.equal(second.kind, 'skip-not-stale')
  })
})
