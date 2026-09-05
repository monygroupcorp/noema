import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readZkeyChain, extendsChain } from '../../../src/arcanum/zkeyChain.js'
import { fakeZkey } from './fakeZkey.js'

const ROOT = [{ seed: 'alpha', name: 'alice' }]
const chainOf = (...args: Parameters<typeof fakeZkey>) => readZkeyChain(fakeZkey(...args))

test('readZkeyChain recovers the contribution list', () => {
  const c = chainOf([{ seed: 'a' }, { seed: 'b' }, { seed: 'c' }])
  assert.equal(c.links.length, 3)
  assert.equal(c.csHash.length, 64)
  assert.notDeepEqual(c.links[0], c.links[1])
})

test('readZkeyChain reads an empty chain (the ceremony root)', () => {
  assert.equal(chainOf([]).links.length, 0)
})

test('a key with one more contribution extends the head', () => {
  const head = chainOf(ROOT)
  const next = chainOf([...ROOT, { seed: 'beta', name: 'bob' }])
  assert.deepEqual(extendsChain(head, next), { ok: true })
})

// The attack the `x-based-on` header cannot stop on its own: fork off an earlier point,
// drop every contribution collected since, and claim to have built on the head. snarkjs
// verifies such a key happily — it is a valid chain, just not THIS chain.
test('a key that forks off an earlier point is refused, however it labels itself', () => {
  const head = chainOf([...ROOT, { seed: 'beta' }, { seed: 'gamma' }])
  const rollback = chainOf([{ seed: 'evil' }])
  const v = extendsChain(head, rollback)
  assert.equal(v.ok, false)
  assert.match(v.reason!, /expected 4 contributions, this key has 1/)
})

test('a fork of the right LENGTH but the wrong history is refused', () => {
  const head = chainOf([...ROOT, { seed: 'beta' }])
  const forked = chainOf([{ seed: 'evil' }, { seed: 'evil-2' }, { seed: 'evil-3' }])
  const v = extendsChain(head, forked)
  assert.equal(v.ok, false)
  assert.match(v.reason!, /contribution 1 does not match/)
})

test('a key that adds two contributions at once is refused', () => {
  const head = chainOf(ROOT)
  const two = chainOf([...ROOT, { seed: 'beta' }, { seed: 'gamma' }])
  assert.equal(extendsChain(head, two).ok, false)
})

test('re-uploading the head itself is refused (no contribution in it)', () => {
  const head = chainOf(ROOT)
  assert.equal(extendsChain(head, chainOf(ROOT)).ok, false)
})

test('a key for a different circuit is refused', () => {
  const head = chainOf(ROOT)
  const other = chainOf([...ROOT, { seed: 'beta' }], { csHash: 'some-other-circuit' })
  const v = extendsChain(head, other)
  assert.equal(v.ok, false)
  assert.match(v.reason!, /different circuit/)
})

// Display names are cosmetic and snarkjs truncates them on rewrite; comparing them would
// reject an honest contributor whose toolchain renders the earlier names differently.
test('an existing contribution renamed on rewrite still extends the head', () => {
  const head = chainOf([{ seed: 'alpha', name: 'alice' }])
  const next = chainOf([{ seed: 'alpha', name: 'alice-with-a-much-longer-handle' }, { seed: 'beta' }])
  assert.deepEqual(extendsChain(head, next), { ok: true })
})

test('readZkeyChain refuses bytes that are not a zkey', () => {
  assert.throws(() => readZkeyChain(Buffer.from('CONTRIB-1')), /not a zkey file/)
})

test('readZkeyChain refuses a truncated zkey', () => {
  const full = fakeZkey([{ seed: 'a' }, { seed: 'b' }])
  assert.throws(() => readZkeyChain(full.subarray(0, full.length - 40)), /truncated|does not match/)
})
