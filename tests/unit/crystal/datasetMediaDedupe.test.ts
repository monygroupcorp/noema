import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { dedupeByUrl } from '../../../src/allocutio/api/CrystalApi.js'

// A media item's identity is its stored url. The uuid beside it is minted fresh on every
// ingest, so before this two mints of one url produced two items nothing could tell apart.
describe('dedupeByUrl — the same image does not land twice', () => {
  it('keeps one item per url', () => {
    const out = dedupeByUrl([
      { id: 'a', url: 'https://x/1.png' },
      { id: 'b', url: 'https://x/2.png' },
      { id: 'c', url: 'https://x/1.png' },
    ])
    assert.deepEqual(out.map((m) => m.id), ['a', 'b'])
  })

  it('keeps the FIRST occurrence, so the earliest addedAt and contributor survive', () => {
    const out = dedupeByUrl([
      { id: 'first', url: 'u', addedBy: 'alice' },
      { id: 'second', url: 'u', addedBy: 'bob' },
    ])
    assert.equal(out.length, 1)
    assert.equal(out[0].addedBy, 'alice')
  })

  it('dedupes the durable private marker the same way it dedupes an http url', () => {
    const marker = 'noema-private://run/abc/out.png'
    const out = dedupeByUrl([{ id: 'a', url: marker }, { id: 'b', url: marker }])
    assert.equal(out.length, 1)
  })

  it('leaves a list with no repeats exactly as it found it', () => {
    const items = [{ id: 'a', url: '1' }, { id: 'b', url: '2' }, { id: 'c', url: '3' }]
    assert.deepEqual(dedupeByUrl(items), items)
  })

  it('is empty for an empty list rather than throwing', () => {
    assert.deepEqual(dedupeByUrl([]), [])
  })
})
