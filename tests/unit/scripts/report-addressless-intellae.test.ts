import { test } from 'node:test'
import assert from 'node:assert/strict'
import { isAddressless } from '../../../scripts/report-addressless-intellae.js'

test('isAddressless: no sources field at all is addressless', () => {
  assert.equal(isAddressless({}), true)
})

test('isAddressless: an empty sources list is addressless', () => {
  assert.equal(isAddressless({ sources: [] }), true)
})

test('isAddressless: sources[0] with no uri field is addressless', () => {
  assert.equal(isAddressless({ sources: [{}] }), true)
})

test('isAddressless: sources[0].uri is null is addressless', () => {
  assert.equal(isAddressless({ sources: [{ uri: null }] }), true)
})

test('isAddressless: sources[0].uri is an empty string is addressless', () => {
  assert.equal(isAddressless({ sources: [{ uri: '' }] }), true)
})

test('isAddressless: a non-empty sources[0].uri is NOT addressless', () => {
  assert.equal(isAddressless({ sources: [{ uri: 'https://example.com/w.safetensors' }] }), false)
})

// The regression this guards: the prior Mongo query `{'sources.0.uri': {$in: [null, '']}}`
// matched far more than element 0 on the production registry (314 of 338 records flagged,
// true count 24 — R2, 2026-11-16). A record whose FIRST source is addressed, with a second,
// unaddressed source behind it, is not addressless — only sources[0] is read, exactly as the
// Compiler reads it when it refuses MODEL_UNFETCHABLE.
test('isAddressless: a second, addressless source does not make an addressed record addressless', () => {
  assert.equal(
    isAddressless({ sources: [{ uri: 'https://example.com/w.safetensors' }, { uri: '' }] }),
    false,
  )
})
