import { test } from 'node:test'
import assert from 'node:assert/strict'
import { internalSecretMatches } from '../../../src/lib/internalSecret.js'

test('matches when header equals the configured secret', () => {
  assert.equal(internalSecretMatches('supersecret', 'supersecret'), true)
})

test('rejects a wrong header value', () => {
  assert.equal(internalSecretMatches('supersecret', 'wrong'), false)
})

test('rejects when no secret is configured, even with a header supplied', () => {
  assert.equal(internalSecretMatches(undefined, 'anything'), false)
})

test('rejects when no header is supplied', () => {
  assert.equal(internalSecretMatches('supersecret', undefined), false)
})

test('rejects a non-string header (e.g. a repeated header parsed as string[])', () => {
  assert.equal(internalSecretMatches('supersecret', ['supersecret']), false)
})

test('rejects a header value of different length (no throw from a mismatched Buffer size)', () => {
  assert.equal(internalSecretMatches('supersecret', 'short'), false)
  assert.equal(internalSecretMatches('supersecret', 'a-much-longer-value-than-the-secret'), false)
})
