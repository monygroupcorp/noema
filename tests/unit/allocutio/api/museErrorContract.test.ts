// =============================================================================
// museErrorContract — the muse-session surface's inline error codes are all
// declared in the `/v1` contract.
// =============================================================================
//
// `CrystalApi`'s muse-session route family (`_mutateMuseSession` and its
// helpers) constructs a small population of `ApiError` codes inline rather
// than in the `Errors` taxonomy. This asserts each is declared in
// `API_CONTRACT.errorCodes` with the httpStatus (and retryable flag) the
// raise site actually uses — so a code the surface raises can never silently
// go undeclared.
//
// Hermetic: reads the contract only. No network, no DB.
// =============================================================================

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { API_CONTRACT } from '../../../../src/allocutio/api/apiContract.js'

test('conflict.muse_session is declared with the status and retryable flag the raise site uses', () => {
  // Raised in CrystalApi#_saveMuseSession once the bounded retry budget for a
  // concurrently-written session is exhausted: 409, retryable (the stored
  // session is intact; the same call succeeds once contention clears).
  const entry = API_CONTRACT.errorCodes.find((e) => e.code === 'conflict.muse_session')
  assert.ok(entry, 'conflict.muse_session must be declared in API_CONTRACT.errorCodes')
  assert.equal(entry?.httpStatus, 409)
  assert.equal(entry?.retryable, true)
})
