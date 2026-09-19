// The logic around the pairing check — everything that does not need snarkjs to answer.
//
// A setup's two halves reach a running server by different roads. The proving key follows
// the ceremony transcript out of custody; the verification key is a JSON file baked into
// the image. Nothing made them agree, and the build-time check on the tracked pair
// (ArcanumPairing.test.ts) cannot see the pair a finalized ceremony puts in force.
//
// What matters as much as spotting a mismatch is not inventing one: 'unknown' has to stay
// distinct from 'mismatch', because a mismatch takes the site's `ready` flag down and a
// bad file handle or an absent key is no reason to do that.
//
// The real-snarkjs half is verifierPairingReal.test.ts, which has to live in its own
// process for reasons written down there.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createVerifierPairing, sameVerificationKey } from '../../../src/arcanum/verifierPairing.js'
import type { ServedProvingKey } from '../../../src/arcanum/ProvingKeySource.js'

const VKEY = { protocol: 'groth16', vk_alpha_1: ['1', '2', '1'] }
const REPO_KEY: ServedProvingKey = { origin: 'repo', hash: 'a'.repeat(64), path: '/nonexistent.zkey' }

test('serving no key is unknown, not a verdict about two keys', async () => {
  const none: ServedProvingKey = { origin: 'none', hash: null, reason: 'nothing to serve' }
  assert.equal(await createVerifierPairing(VKEY)(none), 'unknown')
})

test('holding no verification key is unknown, not a mismatch', async () => {
  // A server with no verification_key.json verifies nothing at all and says so elsewhere.
  // Calling that a pairing mismatch would blame the ceremony for an unrelated gap.
  assert.equal(await createVerifierPairing(undefined)(REPO_KEY), 'unknown')
})

test('a proving key that cannot be read is unknown, not a mismatch', async () => {
  // A broken read says nothing about the two keys, and calling it a mismatch would take a
  // working site's `ready` down over a bad file.
  const bad: ServedProvingKey = { origin: 'ceremony', hash: 'b'.repeat(64), bytes: Buffer.from('not a zkey') }
  assert.equal(await createVerifierPairing(VKEY)(bad), 'unknown')
  assert.equal(await createVerifierPairing(VKEY)(REPO_KEY), 'unknown')
})

test('sameVerificationKey compares values, not field order or number shape', () => {
  // snarkjs hands back numbers and bigints from the exporter where the tracked file has
  // strings, and object key order is not stable across the two. Neither is a mismatch.
  assert.equal(sameVerificationKey({ a: 1, b: '2' }, { b: '2', a: '1' }), true)
  assert.equal(sameVerificationKey({ a: [1, 2] }, { a: ['1', '3'] }), false)
  assert.equal(sameVerificationKey(null, { a: 1 }), false)
  assert.equal(sameVerificationKey({ a: 1 }, undefined), false)
})
