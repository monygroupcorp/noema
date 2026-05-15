import { test } from 'node:test'
import assert from 'node:assert/strict'
import { MemoryArcanumTree } from '../../../src/arcanum/ArcanumTree.js'
import { computeCommitment, computeLeaf } from '../../../src/arcanum/poseidon.js'

// ── insert + getRoot ──────────────────────────────────────────────────────────

test('insert returns leafIndex 0 for first leaf', async () => {
  const tree = new MemoryArcanumTree()
  const commitment = await computeCommitment('a'.repeat(64), 'b'.repeat(64))
  const { leafIndex } = await tree.insert(commitment, 100n)
  assert.equal(leafIndex, 0)
})

test('insert increments leafIndex for subsequent leaves', async () => {
  const tree = new MemoryArcanumTree()
  const c1 = await computeCommitment('a'.repeat(64), 'b'.repeat(64))
  const c2 = await computeCommitment('c'.repeat(64), 'd'.repeat(64))
  const r1 = await tree.insert(c1, 50n)
  const r2 = await tree.insert(c2, 200n)
  assert.equal(r1.leafIndex, 0)
  assert.equal(r2.leafIndex, 1)
})

test('root changes after each insertion', async () => {
  const tree = new MemoryArcanumTree()
  const root0 = await tree.getRoot()
  const c1 = await computeCommitment('a'.repeat(64), 'b'.repeat(64))
  await tree.insert(c1, 100n)
  const root1 = await tree.getRoot()
  const c2 = await computeCommitment('c'.repeat(64), 'd'.repeat(64))
  await tree.insert(c2, 200n)
  const root2 = await tree.getRoot()
  assert.notEqual(root0, root1)
  assert.notEqual(root1, root2)
})

test('size() reflects number of leaves inserted', async () => {
  const tree = new MemoryArcanumTree()
  assert.equal(await tree.size(), 0)
  const c = await computeCommitment('a'.repeat(64), 'b'.repeat(64))
  await tree.insert(c, 100n)
  assert.equal(await tree.size(), 1)
  const c2 = await computeCommitment('c'.repeat(64), 'd'.repeat(64))
  await tree.insert(c2, 100n)
  assert.equal(await tree.size(), 2)
})

// ── getProof ──────────────────────────────────────────────────────────────────

test('getProof returns root matching current tree root', async () => {
  const tree = new MemoryArcanumTree()
  const c = await computeCommitment('a'.repeat(64), 'b'.repeat(64))
  const { leafIndex } = await tree.insert(c, 100n)
  const proof = await tree.getProof(leafIndex)
  assert.equal(proof.root, await tree.getRoot())
})

test('getProof pathElements has length equal to tree depth (32)', async () => {
  const tree = new MemoryArcanumTree()
  const c = await computeCommitment('a'.repeat(64), 'b'.repeat(64))
  const { leafIndex } = await tree.insert(c, 100n)
  const proof = await tree.getProof(leafIndex)
  assert.equal(proof.pathElements.length, 32)  // TREE_DEPTH — never changes
  assert.equal(proof.pathIndices.length, 32)
})

test('getProof pathIndices are all 0 for first leaf (left-most path through tree)', async () => {
  const tree = new MemoryArcanumTree()
  const c = await computeCommitment('a'.repeat(64), 'b'.repeat(64))
  const { leafIndex } = await tree.insert(c, 100n)
  const proof = await tree.getProof(leafIndex)
  // First leaf is at index 0 — all path indices are 0 (we're always the left child)
  assert.ok(proof.pathIndices.every(i => i === 0))
  assert.equal(proof.pathIndices.length, 32)
})

test('getProof for second leaf has pathIndices[0] = 1', async () => {
  const tree = new MemoryArcanumTree()
  const c1 = await computeCommitment('a'.repeat(64), 'b'.repeat(64))
  const c2 = await computeCommitment('c'.repeat(64), 'd'.repeat(64))
  await tree.insert(c1, 50n)
  const { leafIndex } = await tree.insert(c2, 50n)
  const proof = await tree.getProof(leafIndex)
  assert.equal(proof.pathIndices[0], 1)
})

test('getProof throws for out-of-range index', async () => {
  const tree = new MemoryArcanumTree()
  await assert.rejects(() => tree.getProof(0), /out of range/)
})

// ── findLeaf ──────────────────────────────────────────────────────────────────

test('findLeaf returns leaf record by commitment', async () => {
  const tree = new MemoryArcanumTree()
  const commitment = await computeCommitment('a'.repeat(64), 'b'.repeat(64))
  await tree.insert(commitment, 300n)
  const leaf = await tree.findLeaf(commitment)
  assert.ok(leaf)
  assert.equal(leaf.commitment, commitment)
  assert.equal(leaf.valor, 300n)
  assert.equal(leaf.leafIndex, 0)
})

test('findLeaf returns null for unknown commitment', async () => {
  const tree = new MemoryArcanumTree()
  const result = await tree.findLeaf('0'.repeat(64))
  assert.equal(result, null)
})

test('leaf stored in tree matches poseidon(commitment, valor)', async () => {
  const tree = new MemoryArcanumTree()
  const commitment = await computeCommitment('a'.repeat(64), 'b'.repeat(64))
  const valor = 500n
  await tree.insert(commitment, valor)
  const record = await tree.findLeaf(commitment)
  const expectedLeaf = await computeLeaf(commitment, valor)
  assert.equal(record!.leaf, expectedLeaf)
})
