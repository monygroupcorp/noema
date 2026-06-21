import { test } from 'node:test'
import assert from 'node:assert/strict'
import { BucketAdapter, primaryMediaUrl, mediaTypeFor } from '../../../src/crystal/BucketAdapter.js'
import type { MediaFetcher } from '../../../src/crystal/MediaFetcher.js'
import type { ObjectStore } from '../../../src/crystal/R2Uploader.js'
import type { Editio } from '../../../src/types/editio.js'

// =============================================================================
// BucketAdapter — re-hosts an artifact's media to R2 (custody ours); retract
// deletes the hosted bytes. Injected fetcher + object store → no network.
// =============================================================================

function fakes() {
  const fetched: string[] = []
  const fetcher: MediaFetcher = { async fetch(url) { fetched.push(url); return Buffer.from(`bytes:${url}`) } }
  const puts: Array<{ key: string; contentType: string }> = []
  const dels: string[] = []
  const store: ObjectStore = {
    async put(key, _bytes, contentType) { puts.push({ key, contentType }); return `https://cdn.example/${key}` },
    async del(key) { dels.push(key) },
  }
  return { fetcher, store, fetched, puts, dels }
}

test('primaryMediaUrl: pulls the first media URL from common exitus shapes', () => {
  assert.equal(primaryMediaUrl({ image: 'https://x/a.png' }), 'https://x/a.png')
  assert.equal(primaryMediaUrl({ video: 'https://x/a.mp4' }), 'https://x/a.mp4')
  assert.equal(primaryMediaUrl({ images: ['https://x/a.png', 'https://x/b.png'] }), 'https://x/a.png')
  assert.equal(primaryMediaUrl({ media: [{ url: 'https://x/c.webp' }] }), 'https://x/c.webp')
  assert.equal(primaryMediaUrl({ textContent: 'no media here' }), undefined)
  assert.equal(primaryMediaUrl(undefined), undefined)
})

test('mediaTypeFor: maps extensions to content types (querystrings stripped)', () => {
  assert.deepEqual(mediaTypeFor('https://x/a.png'), { contentType: 'image/png', ext: 'png' })
  assert.deepEqual(mediaTypeFor('https://x/a.mp4?sig=abc'), { contentType: 'video/mp4', ext: 'mp4' })
  assert.deepEqual(mediaTypeFor('https://x/blob'), { contentType: 'application/octet-stream', ext: 'bin' })
})

test('publish: fetches the artifact media and hosts it under a stable editioId key', async () => {
  const { fetcher, store, fetched, puts } = fakes()
  const adapter = new BucketAdapter({ fetcher, store })
  assert.equal(adapter.key, 'r2')

  const { externalRef } = await adapter.publish(
    { ref: { kind: 'actum', id: 'act-1' }, output: { image: 'https://pod/out.png' }, editioId: 'ed-9' },
    { visibility: 'unlisted', custody: 'ours' },
  )

  assert.deepEqual(fetched, ['https://pod/out.png'])
  assert.equal(puts.length, 1)
  assert.equal(puts[0].key, 'editiones/ed-9.png', 'keyed by the publication id, not a random uuid')
  assert.equal(puts[0].contentType, 'image/png')
  assert.equal(externalRef, 'https://cdn.example/editiones/ed-9.png')
})

test('publish: throws when the artifact has no resolvable media', async () => {
  const { fetcher, store } = fakes()
  const adapter = new BucketAdapter({ fetcher, store })
  await assert.rejects(
    () => adapter.publish({ ref: { kind: 'actum', id: 'a' }, output: { textContent: 'words' }, editioId: 'ed-1' }, { visibility: 'unlisted', custody: 'ours' }),
    /no resolvable media/,
  )
})

test('retract: deletes the exact hosted object key recovered from the URL', async () => {
  const { fetcher, store, dels } = fakes()
  const adapter = new BucketAdapter({ fetcher, store })
  const editio = { externalRef: 'https://cdn.example/editiones/ed-9.png' } as Editio
  await adapter.retract(editio)
  assert.deepEqual(dels, ['editiones/ed-9.png'])
})

test('retract: a no-externalRef editio is a safe no-op', async () => {
  const { fetcher, store, dels } = fakes()
  const adapter = new BucketAdapter({ fetcher, store })
  await adapter.retract({} as Editio)
  assert.equal(dels.length, 0)
})
