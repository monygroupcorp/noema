// =============================================================================
// disableMarketDomina.test.ts — market-domina-still-listed
//
// Guards the pure decision logic behind
// `scripts/migrations/2026_11_disable_market_domina.ts`: the script only ever
// disables the one named record, refuses if the id resolves to something
// else, and is idempotent against a record already disabled.
//
// Hermetic: no Mongo. `decide` is a pure function of the record read back.
// =============================================================================

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { decide, TARGET_ID, TARGET_NOMEN } from '../../../scripts/migrations/2026_11_disable_market_domina.js'

describe('decide', () => {
  test('no record at all -> refuse, nothing to disable', () => {
    const decision = decide(null)
    assert.equal(decision.kind, 'refuse')
  })

  test('the named record, not yet disabled -> disable', () => {
    const decision = decide({ id: TARGET_ID, nomen: TARGET_NOMEN })
    assert.equal(decision.kind, 'disable')
  })

  test('the named record, already disabled -> already-disabled, idempotent no-op', () => {
    const decision = decide({ id: TARGET_ID, nomen: TARGET_NOMEN, disabled: true })
    assert.equal(decision.kind, 'already-disabled')
  })

  test('a record whose nomen does not match -> refuse (stale or reused id, never guessed)', () => {
    const decision = decide({ id: TARGET_ID, nomen: 'Some Other Model' })
    assert.equal(decision.kind, 'refuse')
  })
})
