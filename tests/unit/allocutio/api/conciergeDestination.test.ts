import { test } from 'node:test'
import assert from 'node:assert/strict'

import { validateDestination, CONCIERGE_ROUTES } from '../../../../src/allocutio/api/ConciergeAgent.js'

test('accepts a listed static route', () => {
  const d = validateDestination({ path: '/datasets', label: 'Open datasets' })
  assert.deepEqual(d, { path: '/datasets', label: 'Open datasets' })
})

test('accepts a listed parameterized route with a concrete id', () => {
  const d = validateDestination({ path: '/datasets/abc123/derive', label: 'Set up derive' })
  assert.deepEqual(d, { path: '/datasets/abc123/derive', label: 'Set up derive' })
})

// NON-VACUITY #1: an external URL must be rejected.
test('rejects an external URL', () => {
  assert.equal(validateDestination({ path: 'https://evil.example', label: 'go' }), undefined)
})

// NON-VACUITY #2: a path not on the allowlist must be rejected.
test('rejects an unlisted route', () => {
  assert.equal(validateDestination({ path: '/no-such-screen', label: 'go' }), undefined)
})

test('rejects a parameterized route with an empty id segment', () => {
  assert.equal(validateDestination({ path: '/datasets//derive', label: 'go' }), undefined)
})

test('rejects a path carrying a query string', () => {
  assert.equal(validateDestination({ path: '/datasets?x=1', label: 'go' }), undefined)
})

test('rejects a path carrying a hash fragment', () => {
  assert.equal(validateDestination({ path: '/datasets#top', label: 'go' }), undefined)
})

test('rejects a path with a scheme (javascript:)', () => {
  assert.equal(validateDestination({ path: 'javascript:alert(1)', label: 'go' }), undefined)
})

test('rejects a path not starting with /', () => {
  assert.equal(validateDestination({ path: 'datasets', label: 'go' }), undefined)
})

test('rejects a missing or empty label', () => {
  assert.equal(validateDestination({ path: '/datasets', label: '' }), undefined)
  assert.equal(validateDestination({ path: '/datasets' }), undefined)
})

test('rejects malformed input shapes without throwing', () => {
  assert.equal(validateDestination(undefined), undefined)
  assert.equal(validateDestination(null), undefined)
  assert.equal(validateDestination('not-an-object'), undefined)
  assert.equal(validateDestination(42), undefined)
})

test('rejects auth/identity routes explicitly excluded from the allowlist', () => {
  for (const bad of ['/onboard', '/keyring', '/ceremony', '/admin', '/vault']) {
    assert.equal(validateDestination({ path: bad, label: 'go' }), undefined, `${bad} must be rejected`)
    assert.ok(!CONCIERGE_ROUTES.includes(bad), `${bad} must not be in CONCIERGE_ROUTES`)
  }
})
