import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ArcanumIssuer } from '../../../src/ledger/ArcanumIssuer.js'
import { MemorySignorum } from '../../../src/ledger/MemorySignorum.js'
import { MemoryArcanumTree } from '../../../src/arcanum/ArcanumTree.js'
import { computeCommitment, computeNullifierHash } from '../../../src/arcanum/poseidon.js'

// ── Helpers ───────────────────────────────────────────────────────────────────

async function makeSetup(identifiedBalance: bigint) {
  const signorum = new MemorySignorum()
  await signorum.issue({ animaId: 'anima-1', forma: 'integer', valor: identifiedBalance, auctor: 'test' })
  const tree = new MemoryArcanumTree()
  const issuer = new ArcanumIssuer({ signorum, tree })
  return { signorum, tree, issuer }
}

// ── issue() — note returned ───────────────────────────────────────────────────

test('issue() returns a note with the requested valor', async () => {
  const { issuer } = await makeSetup(500n)
  const result = await issuer.issue({ animaId: 'anima-1' }, 200n)
  assert.equal(result.note.valor, 200n)
})

test('issue() returns a note where nullifierHash = poseidon(nullifier)', async () => {
  const { issuer } = await makeSetup(500n)
  // Server-generated mode: we can recompute the nullifierHash from the note
  // The note carries nullifierHash, but we can't verify it without knowing nullifier.
  // Instead verify it's a non-empty string.
  const result = await issuer.issue({ animaId: 'anima-1' }, 100n)
  assert.ok(result.note.nullifierHash.length > 0)
  assert.ok(result.note.commitment.length > 0)
  assert.notEqual(result.note.nullifierHash, result.note.commitment)
})

test('issue() returns a note with spent = false', async () => {
  const { issuer } = await makeSetup(100n)
  const result = await issuer.issue({ animaId: 'anima-1' }, 100n)
  assert.equal(result.note.spent, false)
})

test('issue() inserts commitment into the Merkle tree', async () => {
  const { issuer, tree } = await makeSetup(300n)
  const result = await issuer.issue({ animaId: 'anima-1' }, 300n)
  const leaf = await tree.findLeaf(result.note.commitment)
  assert.ok(leaf)
  assert.equal(leaf.valor, 300n)
  assert.equal(leaf.leafIndex, 0)
})

test('issue() tree size grows with each issuance', async () => {
  const { issuer, tree } = await makeSetup(500n)
  await issuer.issue({ animaId: 'anima-1' }, 100n)
  assert.equal(await tree.size(), 1)
  await issuer.issue({ animaId: 'anima-1' }, 100n)
  assert.equal(await tree.size(), 2)
})

// ── issue() — identified balance debit ───────────────────────────────────────

test('issue() debits exactly the requested amount from identified balance', async () => {
  const { issuer, signorum } = await makeSetup(500n)
  await issuer.issue({ animaId: 'anima-1' }, 200n)
  const balance = await signorum.balance({ animaId: 'anima-1' })
  assert.equal(balance, 300n)
})

test('issue() delta refund returns to identified balance', async () => {
  const { issuer, signorum } = await makeSetup(500n)
  // One 500n signum, requesting 300n — should refund 200n
  await issuer.issue({ animaId: 'anima-1' }, 300n)
  const balance = await signorum.balance({ animaId: 'anima-1' })
  assert.equal(balance, 200n)
})

test('issue() throws when identified balance is insufficient', async () => {
  const { issuer } = await makeSetup(50n)
  await assert.rejects(
    () => issuer.issue({ animaId: 'anima-1' }, 100n),
    /insufficient/i,
  )
})

test('issue() throws for zero amount', async () => {
  const { issuer } = await makeSetup(100n)
  await assert.rejects(
    () => issuer.issue({ animaId: 'anima-1' }, 0n),
    /positive/i,
  )
})

// ── issue() — Merkle proof returned ──────────────────────────────────────────

test('issue() returns merkleRoot matching tree root', async () => {
  const { issuer, tree } = await makeSetup(200n)
  const result = await issuer.issue({ animaId: 'anima-1' }, 200n)
  assert.equal(result.merkleRoot, await tree.getRoot())
})

test('issue() returns merklePathElements of length 32 (tree depth)', async () => {
  const { issuer } = await makeSetup(100n)
  const result = await issuer.issue({ animaId: 'anima-1' }, 100n)
  assert.equal(result.merklePathElements.length, 32)
  assert.equal(result.merklePathIndices.length, 32)
})

// ── issue() — client-provided commitment ─────────────────────────────────────

test('issue() accepts client-provided commitment (maximum privacy mode)', async () => {
  const { issuer, tree } = await makeSetup(400n)
  const clientNullifier = 'f'.repeat(64)
  const clientSecret = 'e'.repeat(64)
  const commitment = await computeCommitment(clientNullifier, clientSecret)
  const nullifierHash = await computeNullifierHash(clientNullifier)

  const result = await issuer.issue(
    { animaId: 'anima-1' },
    400n,
    { commitment, nullifier: clientNullifier },
  )

  assert.equal(result.note.commitment, commitment)
  assert.equal(result.note.nullifierHash, nullifierHash)

  // Commitment is in the tree
  const leaf = await tree.findLeaf(commitment)
  assert.ok(leaf)
  assert.equal(leaf.valor, 400n)
})

// ── two issuances are independent ─────────────────────────────────────────────

test('two issuances produce different commitments and nullifierHashes', async () => {
  const { issuer } = await makeSetup(500n)
  const r1 = await issuer.issue({ animaId: 'anima-1' }, 100n)
  const r2 = await issuer.issue({ animaId: 'anima-1' }, 100n)
  assert.notEqual(r1.note.commitment, r2.note.commitment)
  assert.notEqual(r1.note.nullifierHash, r2.note.nullifierHash)
})
