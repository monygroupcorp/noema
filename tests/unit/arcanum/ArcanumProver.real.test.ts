/**
 * Real Groth16 proof generation + verification.
 *
 * Uses the actual arcanum.wasm + arcanum_final.zkey produced by the dev ceremony.
 * SLOW (~10-30s for fullProve). Only runs when the circuit artifacts exist.
 *
 * This is the smoking-gun test that the full cryptographic path works:
 *   generateNote → insert → getProof → generateSpendProof → ArcanumVerifier.verify
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import path from 'node:path'
// File locations (relative to repo root, resolved from __dirname)
const ARTIFACTS = path.join(process.cwd(), 'src/arcanum/circuit/artifacts')
const WASM_PATH = path.join(ARTIFACTS, 'arcanum.wasm')
const ZKEY_PATH = path.join(ARTIFACTS, 'arcanum_final.zkey')
const VKEY_PATH = path.join(ARTIFACTS, 'verification_key.json')

const HAVE_ARTIFACTS = existsSync(WASM_PATH) && existsSync(ZKEY_PATH) && existsSync(VKEY_PATH)

if (!HAVE_ARTIFACTS) {
  console.log('Skipping real Groth16 tests — circuit artifacts not found.')
  console.log('Run: ./scripts/arcanum-trusted-setup.sh')
  process.exit(0)
}

import { MemoryArcanumTree } from '../../../src/arcanum/ArcanumTree.js'
import { ArcanumVerifier, makeSnarkjsVerifier } from '../../../src/arcanum/ArcanumVerifier.js'
import { generateNote, generateSpendProof, computeRecipient } from '../../../src/arcanum/prover.js'
import { computeCommitment } from '../../../src/arcanum/poseidon.js'
import verificationKey from '../../../src/arcanum/circuit/artifacts/verification_key.json' assert { type: 'json' }

test('real Groth16: generateSpendProof produces a proof that ArcanumVerifier accepts', { timeout: 60_000 }, async () => {
  // 1. Generate a fresh note client-side
  const note = generateNote(500n)

  // 2. Compute commitment from the note's nullifier + secret and insert into tree
  const commitment = await computeCommitment(note.nullifier, note.secret)
  const tree = new MemoryArcanumTree()
  const { leafIndex } = await tree.insert(commitment, note.valor)
  note.leafIndex = leafIndex

  // 3. Fetch Merkle proof (32-level path)
  const merkleProof = await tree.getProof(note.leafIndex)

  // 4. Compute the recipient (bind proof to a specific modusId + aditus)
  const modusId = 'mod-test'
  const aditus   = { prompt: 'a test prompt' }
  const recipient = computeRecipient(modusId, aditus)

  // 5. Generate the real Groth16 proof (calls snarkjs.groth16.fullProve with wasm+zkey)
  const spendProof = await generateSpendProof(note, merkleProof, recipient, {
    wasmPath: WASM_PATH,
    zkeyPath: ZKEY_PATH,
  })

  assert.ok(spendProof.proof, 'proof object returned')
  assert.equal(spendProof.publicSignals.root, merkleProof.root, 'root matches tree')
  assert.equal(spendProof.publicSignals.valor, note.valor.toString(), 'valor matches note')
  assert.equal(spendProof.publicSignals.recipient, recipient, 'recipient matches')

  // 6. Verify with the real snarkjs verifier backed by the ceremony verification key
  const verifier = new ArcanumVerifier({
    tree,
    verify: makeSnarkjsVerifier(verificationKey),
  })

  const result = await verifier.verify(spendProof)
  assert.equal(result.nullifierHash, spendProof.publicSignals.nullifierHash)
  assert.equal(result.valor, note.valor)
})

test('real Groth16: tampered proof fails verification', { timeout: 60_000 }, async () => {
  const note = generateNote(200n)
  const commitment = await computeCommitment(note.nullifier, note.secret)
  const tree = new MemoryArcanumTree()
  const insert2 = await tree.insert(commitment, note.valor)
  note.leafIndex = insert2.leafIndex
  const merkleProof = await tree.getProof(note.leafIndex)
  const recipient = computeRecipient('mod-test', {})

  const spendProof = await generateSpendProof(note, merkleProof, recipient, {
    wasmPath: WASM_PATH,
    zkeyPath: ZKEY_PATH,
  })

  // Tamper: flip a bit in the proof
  const tampered = JSON.parse(JSON.stringify(spendProof))
  const piA = tampered.proof.pi_a as string[]
  piA[0] = (BigInt(piA[0]) + 1n).toString()

  const verifier = new ArcanumVerifier({
    tree,
    verify: makeSnarkjsVerifier(verificationKey),
  })

  await assert.rejects(
    () => verifier.verify(tampered),
    /Groth16 verification failed/i,
  )
})
