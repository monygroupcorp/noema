// =============================================================================
// repairLoraBaseIntellaId.test.ts — noema-197
//
// Guards the pure decision logic behind
// `scripts/migrations/2026_08_repair_lora_base_intella_id.ts`: a record is only
// ever repointed at a target already proven to exist, and only when doing so
// leaves `familia` exactly as it was.
//
// Hermetic: no Mongo. The transform is a pure function of (record, proven
// targets) precisely so this can be tested without a live db.
// =============================================================================

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { decideRepoint, isV2 } from '../../../scripts/migrations/2026_08_repair_lora_base_intella_id.js'

// A resolvable-targets map mirroring what the script builds after proving the flux/sdxl group
// exists in the catalog and the sd15 group does NOT (used to exercise the missing-target branch).
const RESOLVABLE = new Map<string, string>([
  ['intella.flux-base', 'intella.flux-schnell-fp8-scaled'],
  ['intella.sdxl-base', 'intella.sdxl-base-1-0'],
])

describe('isV2', () => {
  test('v2 shape: params.triggerWords is an array', () => {
    assert.equal(isV2({ params: { triggerWords: ['a'] } }), true)
  })
  test('v1 shape: no params, or params without triggerWords', () => {
    assert.equal(isV2({}), false)
    assert.equal(isV2({ params: {} }), false)
  })
})

describe('decideRepoint', () => {
  test('no base pointer at all -> skip-no-record, untouched', () => {
    const decision = decideRepoint({ id: 'a', _id: 'a' }, RESOLVABLE)
    assert.equal(decision.kind, 'skip-no-record')
  })

  test('dangling pointer with a proven target and matching familia -> repoint, v1 shape', () => {
    const decision = decideRepoint(
      { id: 'a', _id: 'a', baseIntellaId: 'intella.flux-base', familia: 'flux' },
      RESOLVABLE,
    )
    assert.equal(decision.kind, 'repoint')
    if (decision.kind !== 'repoint') throw new Error('unreachable')
    assert.equal(decision.field, 'baseIntellaId')
    assert.equal(decision.outcome.to, 'intella.flux-schnell-fp8-scaled')
  })

  test('dangling pointer, v2 shape, writes to the nested field', () => {
    const decision = decideRepoint(
      { id: 'b', _id: 'b', params: { triggerWords: ['x'], baseIntellaId: 'intella.sdxl-base' }, familia: 'sdxl' },
      RESOLVABLE,
    )
    assert.equal(decision.kind, 'repoint')
    if (decision.kind !== 'repoint') throw new Error('unreachable')
    assert.equal(decision.field, 'params.baseIntellaId')
    assert.equal(decision.outcome.to, 'intella.sdxl-base-1-0')
  })

  test('pointer names a group whose target was never proven to exist -> skip-no-target, untouched', () => {
    const decision = decideRepoint(
      { id: 'c', _id: 'c', baseIntellaId: 'intella.sd15-base', familia: 'sd15' },
      RESOLVABLE,
    )
    assert.equal(decision.kind, 'skip-no-target')
  })

  test('repoint would change familia -> skip-familia-conflict, untouched (never silently reclassified)', () => {
    const decision = decideRepoint(
      { id: 'd', _id: 'd', baseIntellaId: 'intella.flux-base', familia: 'sdxl' },
      RESOLVABLE,
    )
    assert.equal(decision.kind, 'skip-familia-conflict')
  })

  test('resolvable target is unknown to FAMILIA_BY_BASE_INTELLA_ID -> unresolvable familia is a conflict, not a pass-through', () => {
    const unmapped = new Map([['intella.flux-base', 'intella.some-unmapped-target']])
    const decision = decideRepoint(
      { id: 'e', _id: 'e', baseIntellaId: 'intella.flux-base', familia: 'flux' },
      unmapped,
    )
    assert.equal(decision.kind, 'skip-familia-conflict')
  })

  test('already-null stored familia matching an unresolvable target does NOT count as a conflict', () => {
    const unmapped = new Map([['intella.flux-base', 'intella.some-unmapped-target']])
    const decision = decideRepoint(
      { id: 'f', _id: 'f', baseIntellaId: 'intella.flux-base', familia: null },
      unmapped,
    )
    // Both sides are null/unresolvable -> equal -> safe to repoint even though the new id isn't
    // in the familia map. This is a deliberate edge the pure equality check has to get right.
    assert.equal(decision.kind, 'repoint')
  })
})
