// =============================================================================
// legacyLoraTriage.test.ts — noema-186
//
// Guards the pure decision logic behind
// `scripts/migrations/2026_08_triage_legacy_lora_content_rating.ts`: the pinned
// set is exactly 59 ids with no duplicates, and the per-record decision only
// ever touches a pinned id, never downgrades an adult rating, and never sweeps
// a canonical (seed-owned) record.
//
// Hermetic: no Mongo. That is the whole point of the split.
// =============================================================================

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { PINNED_APPROVED_IDS, decideTriage } from '../../../scripts/migrations/2026_08_triage_legacy_lora_content_rating.js'

describe('PINNED_APPROVED_IDS', () => {
  test('has exactly 59 ids', () => {
    assert.equal(Object.keys(PINNED_APPROVED_IDS).length, 59)
  })

  test('no duplicate ids (object keys already guarantee this, but pin the count explicitly)', () => {
    const ids = Object.keys(PINNED_APPROVED_IDS)
    assert.equal(new Set(ids).size, ids.length)
  })
})

describe('decideTriage', () => {
  const [somePinnedId] = Object.keys(PINNED_APPROVED_IDS)

  test('untriaged -> update', () => {
    const decision = decideTriage(somePinnedId, { contentRating: 'untriaged' })
    assert.deepEqual(decision, { action: 'update' })
  })

  test('unrated (field absent) -> update, same as untriaged', () => {
    const decision = decideTriage(somePinnedId, {})
    assert.deepEqual(decision, { action: 'update' })
  })

  test('already sfw -> no-op, not an update', () => {
    const decision = decideTriage(somePinnedId, { contentRating: 'sfw' })
    assert.equal(decision.action, 'noop-already-sfw')
    assert.notEqual(decision.action, 'update')
  })

  test('suggestive -> skip, never returns update', () => {
    const decision = decideTriage(somePinnedId, { contentRating: 'suggestive' })
    assert.equal(decision.action, 'skip-adult-rated')
    assert.notEqual(decision.action, 'update')
  })

  test('explicit -> skip, never returns update', () => {
    const decision = decideTriage(somePinnedId, { contentRating: 'explicit' })
    assert.equal(decision.action, 'skip-adult-rated')
    assert.notEqual(decision.action, 'update')
  })

  test('canonical -> skip regardless of rating', () => {
    const untriaged = decideTriage(somePinnedId, { contentRating: 'untriaged', canonica: true })
    assert.equal(untriaged.action, 'skip-canonical')

    const sfw = decideTriage(somePinnedId, { contentRating: 'sfw', canonica: true })
    assert.equal(sfw.action, 'skip-canonical')

    const suggestive = decideTriage(somePinnedId, { contentRating: 'suggestive', canonica: true })
    assert.equal(suggestive.action, 'skip-canonical')
  })

  test('an id not in the pinned set is never touched, whatever its rating', () => {
    const notPinned = 'deadbeefdeadbeefdeadbeef'
    assert.equal(notPinned in PINNED_APPROVED_IDS, false, 'fixture id must not collide with the pinned set')

    assert.deepEqual(decideTriage(notPinned, { contentRating: 'untriaged' }), { action: 'skip-not-pinned' })
    assert.deepEqual(decideTriage(notPinned, { contentRating: 'sfw' }), { action: 'skip-not-pinned' })
    assert.deepEqual(decideTriage(notPinned, {}), { action: 'skip-not-pinned' })
  })
})
