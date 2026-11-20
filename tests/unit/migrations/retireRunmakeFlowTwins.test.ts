// =============================================================================
// retireRunmakeFlowTwins.test.ts — noema/flow-registry-twin-ids
//
// Guards the pure decision logic behind
// `scripts/migrations/2026_11_retire_runmake_flow_twins.ts`: a `runmake.*`
// flow registration is only ever retired when its name-group also holds a
// non-`runmake.`-prefixed twin to favour, and only the named legacy prefix is
// ever touched.
//
// Hermetic: no Mongo. The transform is a pure function of (doc, its
// nomen-group) precisely so this can be tested without a live db.
// =============================================================================

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { decideRetirement, LEGACY_PREFIX } from '../../../scripts/migrations/2026_11_retire_runmake_flow_twins.js'

describe('decideRetirement', () => {
  test('runmake twin with a modern twin present -> retire, favouring the modern id', () => {
    const legacy = { id: 'runmake.flux-schnell', nomen: 'FLUX Schnell', versio: '1.0.0' }
    const modern = { id: 'flux-schnell', nomen: 'FLUX Schnell', versio: '1.0.0', descriptio: 'text to image' }
    const decision = decideRetirement(legacy, [legacy, modern])
    assert.equal(decision.kind, 'retire')
    if (decision.kind !== 'retire') throw new Error('unreachable')
    assert.equal(decision.outcome.id, 'runmake.flux-schnell')
    assert.equal(decision.outcome.favoring, 'flux-schnell')
  })

  test('runmake id with no modern twin in its group -> skip-no-modern-twin, nothing written', () => {
    const lone = { id: 'runmake.caption', nomen: 'Caption', versio: '1.0.0' }
    const decision = decideRetirement(lone, [lone])
    assert.equal(decision.kind, 'skip-no-modern-twin')
  })

  test('non-runmake id -> skip-not-runmake, untouched even when it shares a name with a twin', () => {
    const modern = { id: 'flux-schnell', nomen: 'FLUX Schnell', versio: '1.0.0' }
    const legacy = { id: 'runmake.flux-schnell', nomen: 'FLUX Schnell', versio: '1.0.0' }
    const decision = decideRetirement(modern, [modern, legacy])
    assert.equal(decision.kind, 'skip-not-runmake')
  })

  test('two runmake twins of the same modern flow -> both retire, favouring the one modern twin', () => {
    const modern = { id: 'flux-schnell', nomen: 'FLUX Schnell', versio: '1.0.0', descriptio: 'text to image' }
    const legacyA = { id: 'runmake.flux-schnell', nomen: 'FLUX Schnell', versio: '1.0.0' }
    const legacyB = { id: 'runmake.flux-schnell-old', nomen: 'FLUX Schnell', versio: '1.0.0' }
    const group = [modern, legacyA, legacyB]
    for (const legacy of [legacyA, legacyB]) {
      const decision = decideRetirement(legacy, group)
      assert.equal(decision.kind, 'retire')
      if (decision.kind !== 'retire') throw new Error('unreachable')
      assert.equal(decision.outcome.favoring, 'flux-schnell')
    }
  })

  test('among two modern twins, the newer version is favoured', () => {
    const legacy = { id: 'runmake.flux-schnell', nomen: 'FLUX Schnell', versio: '1.0.0' }
    const old = { id: 'flux-schnell', nomen: 'FLUX Schnell', versio: '1.0.0' }
    const newer = { id: 'flux-schnell-v2', nomen: 'FLUX Schnell', versio: '1.2.0' }
    const decision = decideRetirement(legacy, [legacy, old, newer])
    assert.equal(decision.kind, 'retire')
    if (decision.kind !== 'retire') throw new Error('unreachable')
    assert.equal(decision.outcome.favoring, 'flux-schnell-v2')
  })

  test('among two modern twins on equal version, the one with a descriptio is favoured', () => {
    const legacy = { id: 'runmake.caption', nomen: 'Caption', versio: '1.0.0' }
    const bare = { id: 'caption-a', nomen: 'Caption', versio: '1.0.0' }
    const described = { id: 'caption-b', nomen: 'Caption', versio: '1.0.0', descriptio: 'describes an image' }
    const decision = decideRetirement(legacy, [legacy, bare, described])
    assert.equal(decision.kind, 'retire')
    if (decision.kind !== 'retire') throw new Error('unreachable')
    assert.equal(decision.outcome.favoring, 'caption-b')
  })

  test('second run over an already-retired twin is a no-op at the query level', () => {
    // The migration selects only canonica:true docs; the pure decision core itself does not
    // read `canonica` (the caller already filtered), so this just documents that re-deciding
    // the same (now-excluded) doc is harmless and still resolves the same way.
    const legacy = { id: 'runmake.flux-schnell', nomen: 'FLUX Schnell', versio: '1.0.0' }
    const modern = { id: 'flux-schnell', nomen: 'FLUX Schnell', versio: '1.0.0' }
    assert.equal(decideRetirement(legacy, [legacy, modern]).kind, 'retire')
  })

  test('LEGACY_PREFIX is the exact dotted prefix, not a bare substring match', () => {
    const notLegacy = { id: 'my-runmake-thing', nomen: 'Something', versio: '1.0.0' }
    const modern = { id: 'something-else', nomen: 'Something', versio: '1.0.0' }
    assert.equal(decideRetirement(notLegacy, [notLegacy, modern]).kind, 'skip-not-runmake')
    assert.equal(LEGACY_PREFIX, 'runmake.')
  })
})
