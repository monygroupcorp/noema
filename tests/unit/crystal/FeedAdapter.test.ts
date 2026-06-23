import { test } from 'node:test'
import assert from 'node:assert/strict'
import { FeedAdapter } from '../../../src/crystal/FeedAdapter.js'

// =============================================================================
// FeedAdapter — the smallest publication adapter. custody 'ours'; mints a
// `feed:<uuid>` post id; retract is a no-op (the spine flips the Editio status).
// =============================================================================

test('FeedAdapter.publish returns a feed:<id> handle and is keyed "feed"', async () => {
  const adapter = new FeedAdapter()
  assert.equal(adapter.key, 'feed')
  const { externalRef } = await adapter.publish(
    { ref: { kind: 'actum', id: 'act-1' }, output: { image: 'https://cdn/x.png' } },
    { visibility: 'feed', custody: 'ours' },
  )
  assert.match(externalRef, /^feed:[0-9a-f-]{36}$/)
})

test('FeedAdapter mints a distinct handle per publish', async () => {
  const adapter = new FeedAdapter()
  const a = await adapter.publish({ ref: { kind: 'actum', id: 'x' } }, { visibility: 'feed', custody: 'ours' })
  const b = await adapter.publish({ ref: { kind: 'actum', id: 'x' } }, { visibility: 'feed', custody: 'ours' })
  assert.notEqual(a.externalRef, b.externalRef)
})

test('FeedAdapter.retract resolves (feed entries are revocable)', async () => {
  const adapter = new FeedAdapter()
  await assert.doesNotReject(() => adapter.retract())
})
