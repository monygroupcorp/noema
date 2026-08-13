// =============================================================================
// publishKleinCollection.test.ts — noema-201
//
// Guards the pure decision logic behind
// `scripts/migrations/2026_08_publish_klein_collection.ts`: matching is exact
// on `nomen` else a normalized substring on `dest`/`sources[].uri`, the access
// shape written is the record's own (v1 flat vs v2 nested) never guessed or
// normalized, an unmatched name is reported not guessed, and a record already
// public+canonica is left alone.
//
// Hermetic: no Mongo. Both `matchesName` and `decidePublish` are pure
// functions of a synthetic doc precisely so this can be tested without a
// live db.
// =============================================================================

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { decidePublish, matchesName, normalizeSlug, isV2 } from '../../../scripts/migrations/2026_08_publish_klein_collection.js'

describe('normalizeSlug', () => {
  test('treats - and _ as equivalent', () => {
    assert.equal(normalizeSlug('foo-bar_baz'), normalizeSlug('foo_bar-baz'))
  })
})

describe('matchesName', () => {
  test('exact nomen match', () => {
    assert.equal(matchesName('pepeflux-klein', { _id: '1', nomen: 'pepeflux-klein' }), true)
  })
  test('nomen match across - / _ variants', () => {
    assert.equal(matchesName('pepeflux-klein', { _id: '1', nomen: 'pepeflux_klein' }), true)
  })
  test('falls back to dest substring when nomen does not match', () => {
    assert.equal(
      matchesName('pepeflux-klein', { _id: '1', nomen: 'unrelated', dest: 'loras/pepeflux_klein.safetensors' }),
      true,
    )
  })
  test('falls back to sources[].uri substring', () => {
    assert.equal(
      matchesName('pepeflux-klein', {
        _id: '1', nomen: 'unrelated', sources: [{ uri: 'https://host/models/pepeflux-klein/file.safetensors' }],
      }),
      true,
    )
  })
  test('no match anywhere -> false', () => {
    assert.equal(matchesName('pepeflux-klein', { _id: '1', nomen: 'other-model', dest: 'loras/other.safetensors' }), false)
  })
})

describe('isV2', () => {
  test('v2 shape: params.triggerWords is an array', () => {
    assert.equal(isV2({ _id: '1', params: { triggerWords: ['x'] } }), true)
  })
  test('v1 shape: no params, or params without triggerWords', () => {
    assert.equal(isV2({ _id: '1' }), false)
    assert.equal(isV2({ _id: '1', params: {} }), false)
  })
})

describe('decidePublish', () => {
  test('v1 (flat) private record -> publish, flat access field', () => {
    const decision = decidePublish({ _id: '1', nomen: 'x', access: 'private', canonica: false })
    assert.equal(decision.kind, 'publish')
    if (decision.kind !== 'publish') throw new Error('unreachable')
    assert.equal(decision.write.accessField, 'access')
    assert.equal(decision.write.accessValue, 'public')
  })

  test('v2 (nested) private record -> publish, nested access.kind field', () => {
    const decision = decidePublish({
      _id: '2', nomen: 'x', params: { triggerWords: ['x'] }, access: { kind: 'private' }, canonica: false,
    })
    assert.equal(decision.kind, 'publish')
    if (decision.kind !== 'publish') throw new Error('unreachable')
    assert.equal(decision.write.accessField, 'access.kind')
    assert.equal(decision.write.accessValue, 'public')
  })

  test('already public + canonica, v1 shape -> already-done, no write', () => {
    const decision = decidePublish({ _id: '3', nomen: 'x', access: 'public', canonica: true })
    assert.equal(decision.kind, 'already-done')
  })

  test('already public + canonica, v2 shape -> already-done, no write', () => {
    const decision = decidePublish({
      _id: '4', nomen: 'x', params: { triggerWords: ['x'] }, access: { kind: 'public' }, canonica: true,
    })
    assert.equal(decision.kind, 'already-done')
  })

  test('public access but canonica still false -> publish (both flags required)', () => {
    const decision = decidePublish({ _id: '5', nomen: 'x', access: 'public', canonica: false })
    assert.equal(decision.kind, 'publish')
  })

  test('no access field at all, v2 shape -> publish, nested shape from record schema version', () => {
    const decision = decidePublish({ _id: '6', nomen: 'x', params: { triggerWords: ['x'] } })
    assert.equal(decision.kind, 'publish')
    if (decision.kind !== 'publish') throw new Error('unreachable')
    assert.equal(decision.write.accessField, 'access.kind')
  })
})
