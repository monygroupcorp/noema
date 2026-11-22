// A finalized ceremony is sealed on purpose — finalize() is one-way, and the one
// existing trigger for open() (CEREMONY_OPEN at boot) refuses past 'announced' so a
// stray redeploy can never reopen a live or finished ceremony by accident. Good for the
// ceremony that already ran; a problem for the one that has to run next; a ceremony with
// a finished round and no way to start a second has nowhere for a real contributor to
// land.
//
// reopen() is that second door, opened on purpose and only once a round is finalized.
// This pins what it has to do: archive the finished round rather than erase it, reset
// the chain so round two is a fresh sequence of contributions (not round one's tail),
// and let round one's contributors land a contribution again — because landing one in
// round two is the point, not a bug round one's gate should still be enforcing.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { MemoryCeremoniaStore } from '../../../src/arcanum/CeremoniaStore.js'

test('reopen refuses on an announced or open ceremony — there is no finished round to archive', async () => {
  const store = new MemoryCeremoniaStore()
  assert.equal(await store.reopen('aa'.repeat(32)), false, 'announced: nothing to reopen')

  await store.open('bb'.repeat(32))
  assert.equal(await store.reopen('cc'.repeat(32)), false, 'open: round one is not finished yet')
  const status = await store.status()
  assert.equal(status.phase, 'open')
  assert.equal(status.rootHash, 'bb'.repeat(32), 'the refusal changed nothing')
})

test('reopen on a finalized ceremony starts a clean second round and archives the first', async () => {
  const store = new MemoryCeremoniaStore()
  const root1 = 'aa'.repeat(32)
  await store.open(root1)
  const ok1 = await store.appendContribution(
    { index: 1, name: 'alice', outputHash: 'bb'.repeat(32) }, root1, 'alice-key',
  )
  assert.equal(ok1, true)
  await store.finalize('cc'.repeat(32))

  const root2 = 'dd'.repeat(32)
  const did = await store.reopen(root2, 5)
  assert.equal(did, true, 'a finalized ceremony reopens')

  const status = await store.status()
  assert.equal(status.phase, 'open')
  assert.equal(status.rootHash, root2, 'the new round builds on the new root')
  assert.deepEqual(status.chain, [], 'round two starts with an empty chain, not round one\'s tail')
  assert.equal(status.finalHash, null)
  assert.equal(status.openSlots, 5)

  const history = await store.history()
  assert.equal(history.length, 1, 'round one is archived, not dropped')
  assert.equal(history[0].rootHash, root1)
  assert.equal(history[0].finalHash, 'cc'.repeat(32))
  assert.equal(history[0].chain.length, 1)
  assert.equal(history[0].chain[0].name, 'alice')
})

test('a contributor who already landed one in round one can land another in round two', async () => {
  const store = new MemoryCeremoniaStore()
  const root1 = 'aa'.repeat(32)
  await store.open(root1)
  await store.appendContribution({ index: 1, name: 'alice', outputHash: 'bb'.repeat(32) }, root1, 'alice-key')
  assert.equal(await store.hasContributed('alice-key'), true)
  await store.finalize('cc'.repeat(32))

  const root2 = 'dd'.repeat(32)
  await store.reopen(root2)
  assert.equal(await store.hasContributed('alice-key'), false,
    'round two is a fresh chain — round one\'s one-per-ceremony gate does not carry over')

  const ok = await store.appendContribution({ index: 1, name: 'alice', outputHash: 'ee'.repeat(32) }, root2, 'alice-key')
  assert.equal(ok, true, 'alice can contribute to round two')
})

test('reopen refuses a second time until the round it would archive is read back', async () => {
  const store = new MemoryCeremoniaStore()
  await store.open('aa'.repeat(32))
  await store.finalize('cc'.repeat(32))
  await store.reopen('dd'.repeat(32))

  // Round two is 'open', not 'finalized' — a second reopen() call right now would just
  // hit the same "no finished round to archive" refusal the open/announced test above
  // pins, which is what keeps a double-call from losing round one's history entry.
  assert.equal(await store.reopen('ee'.repeat(32)), false)
  assert.equal((await store.history()).length, 1, 'still exactly one archived round')
})
