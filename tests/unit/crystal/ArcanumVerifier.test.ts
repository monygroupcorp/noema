import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ArcanumVerifier } from '../../../src/arcanum/ArcanumVerifier.js'
import { MemoryArcanumTree } from '../../../src/arcanum/ArcanumTree.js'
import type { ArcanumSpendProof } from '../../../src/arcanum/types.js'
import { computeCommitment, computeNullifierHash } from '../../../src/arcanum/poseidon.js'

// ── Helpers ───────────────────────────────────────────────────────────────────

const NULLIFIER = 'a'.repeat(64)
const SECRET = 'b'.repeat(64)
const VALOR = 200n

async function makeTreeWithNote() {
  const tree = new MemoryArcanumTree()
  const commitment = await computeCommitment(NULLIFIER, SECRET)
  await tree.insert(commitment, VALOR)
  return tree
}

async function makeValidProof(tree: MemoryArcanumTree): Promise<ArcanumSpendProof> {
  const root = await tree.getRoot()
  const nullifierHash = await computeNullifierHash(NULLIFIER)
  return {
    proof: { pi_a: [], pi_b: [], pi_c: [] },
    publicSignals: {
      root,
      nullifierHash,
      valor: VALOR.toString(),
      recipient: '12345',
    },
  }
}

function makeVerifier(tree: MemoryArcanumTree, verifyResult: boolean | Error = true) {
  return new ArcanumVerifier({
    tree,
    verify: async () => {
      if (verifyResult instanceof Error) throw verifyResult
      return verifyResult
    },
  })
}

// ── verify() — happy path ─────────────────────────────────────────────────────

test('verify() returns nullifierHash and valor for a valid proof', async () => {
  const tree = await makeTreeWithNote()
  const verifier = makeVerifier(tree, true)
  const proof = await makeValidProof(tree)

  const result = await verifier.verify(proof)

  assert.equal(result.nullifierHash, proof.publicSignals.nullifierHash)
  assert.equal(result.valor, VALOR)
})

// ── verify() — rejection cases ────────────────────────────────────────────────

test('verify() throws on invalid proof (verifier returns false)', async () => {
  const tree = await makeTreeWithNote()
  const verifier = makeVerifier(tree, false)
  const proof = await makeValidProof(tree)

  await assert.rejects(() => verifier.verify(proof), /proof invalid/i)
})

test('verify() throws on stale root', async () => {
  const tree = await makeTreeWithNote()
  const verifier = makeVerifier(tree, true)
  const proof = await makeValidProof(tree)

  // Insert another leaf to advance the root
  const c2 = await computeCommitment('c'.repeat(64), 'd'.repeat(64))
  await tree.insert(c2, 50n)

  await assert.rejects(() => verifier.verify(proof), /stale root/i)
})

test('verify() throws on double-spend', async () => {
  const tree = await makeTreeWithNote()
  const verifier = makeVerifier(tree, true)
  const proof = await makeValidProof(tree)

  const { nullifierHash } = await verifier.verify(proof)
  await verifier.markSpent(nullifierHash)

  await assert.rejects(() => verifier.verify(proof), /double-spend/i)
})

test('verify() throws on zero valor', async () => {
  const tree = await makeTreeWithNote()
  const verifier = makeVerifier(tree, true)
  const proof = await makeValidProof(tree)
  const zeroProof: ArcanumSpendProof = {
    ...proof,
    publicSignals: { ...proof.publicSignals, valor: '0' },
  }

  await assert.rejects(() => verifier.verify(zeroProof), /valor must be positive/i)
})

// ── markSpent / isSpent ───────────────────────────────────────────────────────

test('isSpent returns false before markSpent', async () => {
  const tree = await makeTreeWithNote()
  const verifier = makeVerifier(tree, true)
  assert.equal(await verifier.isSpent('some-hash'), false)
})

test('isSpent returns true after markSpent', async () => {
  const tree = await makeTreeWithNote()
  const verifier = makeVerifier(tree, true)
  await verifier.markSpent('some-hash')
  assert.equal(await verifier.isSpent('some-hash'), true)
})
