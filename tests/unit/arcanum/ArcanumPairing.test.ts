/**
 * Fast pairing/integrity check: the tracked arcanum_final.zkey and
 * verification_key.json MUST describe the same circuit. A mismatched pair
 * verifies false silently at spend time (the "silent killer" — see noema-039).
 *
 * This is the hermetic proxy for cryptographic coherence: it re-derives the
 * verification key straight from the zkey header (snarkjs.zKey.exportVerificationKey,
 * <1s — no witness generation, no full prove) and asserts it matches the tracked
 * JSON byte-for-byte. The full generateSpendProof → ArcanumVerifier.verify round
 * trip (tests/unit/arcanum/ArcanumProver.real.test.ts) proves the same coherence
 * end-to-end but takes minutes (full Groth16 fullProve) — too slow for the
 * hermetic gate, so it stays in the non-gated suite.
 */

import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import * as snarkjs from 'snarkjs'
import verificationKey from '../../../src/arcanum/circuit/artifacts/verification_key.json' assert { type: 'json' }

// snarkjs/ffjavascript spins up a curve worker-thread pool (bn128) inside
// exportVerificationKey and never exposes a handle to terminate it — the
// process is left with dangling threads and never exits on its own (a known
// snarkjs footgun; their own CLI works around it the same way). Each test
// file runs in its own isolated process under node:test, so forcing exit
// here is safe and does not affect other hermetic test files.
after(() => {
  process.exit(0)
})

const ARTIFACTS = path.join(process.cwd(), 'src/arcanum/circuit/artifacts')
const ZKEY_PATH = path.join(ARTIFACTS, 'arcanum_final.zkey')

test('tracked verification_key.json is derived from the tracked arcanum_final.zkey (pairing integrity)', async () => {
  assert.ok(existsSync(ZKEY_PATH), 'arcanum_final.zkey must be tracked in src/arcanum/circuit/artifacts/')

  const derived = await snarkjs.zKey.exportVerificationKey(ZKEY_PATH)

  assert.deepEqual(
    JSON.parse(JSON.stringify(derived)),
    JSON.parse(JSON.stringify(verificationKey)),
    'verification_key.json is stale relative to arcanum_final.zkey — re-run: ' +
      'npx snarkjs zkey export verificationkey src/arcanum/circuit/artifacts/arcanum_final.zkey ' +
      'src/arcanum/circuit/artifacts/verification_key.json',
  )
})
