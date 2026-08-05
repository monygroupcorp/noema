/**
 * Arcanum client/server PARITY — the hermetic guard on the browser prover port.
 *
 * lib/arcanum.ts (browser) must produce byte-for-byte identical field elements to the
 * server prover it mirrors. A single divergent decimal string makes a real Groth16 proof
 * verify `false` and burns the user's note. This test direct-imports BOTH implementations
 * and asserts identical outputs on FIXED constant vectors — deterministic, no circuit
 * artifacts, no network. (groth16.fullProve itself needs the wasm/zkey artifacts and is
 * NOT hermetically testable; it is covered by the Captain's live staging pass.)
 *
 * The two implementations that must agree:
 *   poseidon / computeCommitment / computeNullifierHash / computeLeaf — both wrap the same
 *     circomlibjs buildPoseidon, so a mismatch means one side changed the call shape.
 *   computeRecipient — GENUINELY different code paths (Node createHash('sha256') + Buffer
 *     vs Web Crypto subtle.digest + TextEncoder). This assertion is the real one: it proves
 *     the UTF-8 encoding, the 31-byte truncation, and the BigInt parse match exactly.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

// Server (the canonical implementations).
import {
  computeCommitment as srvCommitment,
  computeNullifierHash as srvNullifierHash,
  computeLeaf as srvLeaf,
} from '../../../src/arcanum/poseidon.js'
import { computeRecipient as srvRecipient } from '../../../src/arcanum/prover.js'

// Browser port under test.
import {
  computeCommitment as webCommitment,
  computeNullifierHash as webNullifierHash,
  computeLeaf as webLeaf,
  computeRecipient as webRecipient,
} from '../../../src/platforms/web/app/src/lib/arcanum.js'

// ── Fixed hex vectors (64 chars = 32 bytes), incl. a leading-zero-byte case ─────
const NUL_A = '11'.repeat(32)
const SEC_A = '22'.repeat(32)
const NUL_B = '00'.repeat(30) + 'abcd' // leading zero bytes → exercises BigInt('0x'+…) normalization
const SEC_B = 'deadbeef'.repeat(8)

const isDecimal = (s: string) => typeof s === 'string' && s.length > 0 && /^[0-9]+$/.test(s)

test('parity: computeCommitment (poseidon2) — identical decimal strings', async () => {
  for (const [nul, sec] of [[NUL_A, SEC_A], [NUL_B, SEC_B]] as const) {
    const s = await srvCommitment(nul, sec)
    const w = await webCommitment(nul, sec)
    assert.ok(isDecimal(s), `server commitment is a decimal string: ${s}`)
    assert.equal(w, s, `commitment mismatch for nullifier=${nul}`)
  }
})

test('parity: computeNullifierHash (poseidon1) — identical decimal strings', async () => {
  for (const nul of [NUL_A, NUL_B]) {
    const s = await srvNullifierHash(nul)
    const w = await webNullifierHash(nul)
    assert.ok(isDecimal(s))
    assert.equal(w, s, `nullifierHash mismatch for ${nul}`)
  }
})

test('parity: computeLeaf (poseidon(commitment, valor)) — identical', async () => {
  const commitment = await srvCommitment(NUL_A, SEC_A)
  for (const valor of [1n, 500n, 123456789012345678901234567890n]) {
    const s = await srvLeaf(commitment, valor)
    const w = await webLeaf(commitment, valor)
    assert.ok(isDecimal(s))
    assert.equal(w, s, `leaf mismatch for valor=${valor}`)
  }
})

test('parity: computeRecipient (sha256, 31-byte truncation) — Node vs Web Crypto agree', async () => {
  const vectors: Array<{ modusId: string; aditus: Record<string, unknown> }> = [
    { modusId: 'mod-test', aditus: { prompt: 'a test prompt' } },
    { modusId: 'flux-schnell', aditus: {} },                       // empty aditus
    { modusId: 'm', aditus: { b: 2, a: 1, c: 'x' } },              // key-sort must match
    { modusId: 'unicode', aditus: { prompt: 'café ☕ 日本語' } },   // multi-byte UTF-8
    { modusId: '', aditus: { nested: { z: 1, a: [3, 2, 1] }, flag: true } },
  ]
  for (const { modusId, aditus } of vectors) {
    const s = srvRecipient(modusId, aditus)
    const w = await webRecipient(modusId, aditus)
    assert.ok(isDecimal(s), `server recipient is decimal: ${s}`)
    assert.equal(w, s, `recipient mismatch for modusId=${modusId} aditus=${JSON.stringify(aditus)}`)
  }
})
