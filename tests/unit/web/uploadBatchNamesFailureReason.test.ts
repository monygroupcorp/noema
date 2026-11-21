import { test } from 'node:test'
import assert from 'node:assert/strict'
import { runBatch } from '../../../src/platforms/web/app/src/lib/upload.js'

// A caller naming a rejected file needs a reason beside it ("file.gif (unsupported
// contentType...)"), not just the fact that it failed. runBatch used to swallow the thrown
// error entirely (`catch { done[i] = { ok: false } }`), so there was nothing to name.

test('a failed item carries its rejection reason, in the same order as failedIndexes', async () => {
  const items = ['a', 'b', 'c']
  const batch = await runBatch(items, async (item) => {
    if (item === 'b') throw new Error('unsupported contentType image/gif')
    return item.toUpperCase()
  })
  assert.deepEqual(batch.ok.sort(), ['A', 'C'])
  assert.deepEqual(batch.failedIndexes, [1])
  assert.deepEqual(batch.failureReasons, ['unsupported contentType image/gif'])
})

test('a non-Error throw still produces a readable reason', async () => {
  const batch = await runBatch(['x'], async () => { throw 'plain string failure' })
  assert.deepEqual(batch.failureReasons, ['plain string failure'])
})
