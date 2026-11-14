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

/** A minimal, REAL safetensors buffer: an 8-byte LE header-length prefix + a one-tensor JSON
 *  header — passes `isValidSafetensorsHeader`, unlike the placeholder `bytes:<url>` the other
 *  fakes use (fine for media, not for anything `_hostModel` now verifies). */
function minimalSafetensorsBytes(): Buffer {
  const header = Buffer.from(JSON.stringify({ t: { dtype: 'F32', shape: [1], data_offsets: [0, 4] } }))
  const len = Buffer.alloc(8)
  len.writeBigUInt64LE(BigInt(header.length))
  return Buffer.concat([len, header, Buffer.alloc(4)])
}

function fakes() {
  const fetched: string[] = []
  const fetcher: MediaFetcher = {
    async fetch(url) {
      fetched.push(url)
      return /\.safetensors(\?|#|$)/i.test(url) ? minimalSafetensorsBytes() : Buffer.from(`bytes:${url}`)
    },
  }
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

// ── Model weights (training finality — our-custody copy) ─────────────────────

test('publish: an intella hosts its primary weight file under the model prefix', async () => {
  const { fetcher, store, fetched, puts } = fakes()
  const adapter = new BucketAdapter({ fetcher, store })
  const { externalRef } = await adapter.publish(
    {
      ref: { kind: 'intella', id: 'lora-7' }, editioId: 'ed-7',
      output: { slug: 'my-lora', sources: [{ provenance: 'huggingface', uri: 'https://hf/repo/resolve/main/my-lora.safetensors' }] },
    },
    { visibility: 'private', custody: 'ours' },
  )
  assert.deepEqual(fetched, ['https://hf/repo/resolve/main/my-lora.safetensors'], 'fetched the weight bytes')
  assert.equal(puts[0].key, 'models/ed-7/my-lora.safetensors', 'keyed under models/<editioId>/<filename>')
  assert.equal(puts[0].contentType, 'application/octet-stream')
  assert.equal(externalRef, 'https://cdn.example/models/ed-7/my-lora.safetensors')
})

test('publish: a civitai-origin weight carries our CIVITAI_API_TOKEN as a Bearer header', async () => {
  const puts: Array<{ key: string }> = []
  const seen: Array<{ url: string; headers: Record<string, string> }> = []
  const realFetch = globalThis.fetch
  globalThis.fetch = (async (url: string, init?: RequestInit) => {
    seen.push({ url, headers: Object.fromEntries(new Headers(init?.headers).entries()) })
    const header = Buffer.from(JSON.stringify({ t: { dtype: 'F32', shape: [1], data_offsets: [0, 4] } }))
    const len = Buffer.alloc(8)
    len.writeBigUInt64LE(BigInt(header.length))
    return new Response(Buffer.concat([len, header, Buffer.alloc(4)]), { status: 200 })
  }) as typeof fetch
  try {
    const store: ObjectStore = {
      async put(key) { puts.push({ key }); return `https://cdn.example/${key}` },
      async del() {},
    }
    const adapter = new BucketAdapter({ fetcher: { async fetch() { throw new Error('unused') } }, store, civitaiToken: 'tok-abc' })
    const { externalRef } = await adapter.publish(
      {
        ref: { kind: 'intella', id: 'lora-civ' }, editioId: 'ed-civ',
        output: { slug: 'civ-lora', sources: [{ provenance: 'civitai', uri: 'https://civitai.com/api/download/models/552898' }] },
      },
      { visibility: 'private', custody: 'ours' },
    )
    assert.equal(seen.length, 1)
    assert.equal(seen[0].headers.authorization, 'Bearer tok-abc')
    assert.equal(puts[0].key, 'models/ed-civ/552898')
    assert.equal(externalRef, 'https://cdn.example/models/ed-civ/552898')
  } finally {
    globalThis.fetch = realFetch
  }
})

test('publish: a civitai 401 with no CIVITAI_API_TOKEN configured refuses with a clear error, never silent', async () => {
  const realFetch = globalThis.fetch
  globalThis.fetch = (async () => new Response(null, { status: 401 })) as typeof fetch
  try {
    const { store } = fakes()
    const adapter = new BucketAdapter({ fetcher: { async fetch() { throw new Error('unused') } }, store })
    await assert.rejects(
      () => adapter.publish(
        {
          ref: { kind: 'intella', id: 'lora-civ' }, editioId: 'ed-civ2',
          output: { slug: 'civ-lora', sources: [{ provenance: 'civitai', uri: 'https://civitai.com/api/download/models/1' }] },
        },
        { visibility: 'private', custody: 'ours' },
      ),
      /no CIVITAI_API_TOKEN is configured/,
    )
  } finally {
    globalThis.fetch = realFetch
  }
})

test('publish: a non-safetensors response (e.g. an HTML error page) is refused before upload', async () => {
  const puts: Array<{ key: string }> = []
  const store: ObjectStore = {
    async put(key) { puts.push({ key }); return `https://cdn.example/${key}` },
    async del() {},
  }
  const fetcher: MediaFetcher = { async fetch() { return Buffer.from('<html>not found</html>') } }
  const adapter = new BucketAdapter({ fetcher, store })
  await assert.rejects(
    () => adapter.publish(
      {
        ref: { kind: 'intella', id: 'lora-bad' }, editioId: 'ed-bad',
        output: { slug: 'bad', sources: [{ provenance: 'huggingface', uri: 'https://hf/repo/resolve/main/bad.safetensors' }] },
      },
      { visibility: 'private', custody: 'ours' },
    ),
    /not a valid safetensors file/,
  )
  assert.equal(puts.length, 0, 'nothing is uploaded once the header check fails')
})

test('publish: an intella with no weight source throws', async () => {
  const { fetcher, store } = fakes()
  const adapter = new BucketAdapter({ fetcher, store })
  await assert.rejects(
    () => adapter.publish({ ref: { kind: 'intella', id: 'x' }, output: { slug: 's', sources: [] }, editioId: 'e' }, { visibility: 'private', custody: 'ours' }),
    /no weight source/,
  )
})

test('retract: deletes a hosted model weight key (model prefix)', async () => {
  const { fetcher, store, dels } = fakes()
  const adapter = new BucketAdapter({ fetcher, store })
  await adapter.retract({ externalRef: 'https://cdn.example/models/ed-7/my-lora.safetensors' } as Editio)
  assert.deepEqual(dels, ['models/ed-7/my-lora.safetensors'])
})

test('publish: STREAMS model weights when fetcher + store support it (never buffers)', async () => {
  const { Readable } = await import('node:stream')
  const streamed: Array<{ key: string; contentType: string; contentLength?: number }> = []
  let bufferedFetch = false
  let bufferedPut = false
  const fetcher: MediaFetcher = {
    async fetch() { bufferedFetch = true; return Buffer.from('nope') },
    async fetchStream(url) {
      assert.equal(url, 'https://hf/repo/resolve/main/big.safetensors')
      return { body: Readable.from([Buffer.from('weight-bytes')]), contentType: 'application/octet-stream', contentLength: 12 }
    },
  }
  const store: ObjectStore = {
    async put() { bufferedPut = true; return 'nope' },
    async del() {},
    async putStream(key, _body, contentType, contentLength) {
      streamed.push({ key, contentType, contentLength })
      return `https://cdn.example/${key}`
    },
  }
  const adapter = new BucketAdapter({ fetcher, store })
  const { externalRef } = await adapter.publish(
    {
      ref: { kind: 'intella', id: 'lora-9' }, editioId: 'ed-9',
      output: { slug: 'big', sources: [{ provenance: 'huggingface', uri: 'https://hf/repo/resolve/main/big.safetensors' }] },
    },
    { visibility: 'private', custody: 'ours' },
  )
  assert.equal(externalRef, 'https://cdn.example/models/ed-9/big.safetensors')
  assert.deepEqual(streamed, [{ key: 'models/ed-9/big.safetensors', contentType: 'application/octet-stream', contentLength: 12 }])
  assert.equal(bufferedFetch, false, 'must not buffer-fetch when streaming is available')
  assert.equal(bufferedPut, false, 'must not buffer-put when streaming is available')
})

test('publish: falls back to the buffered path when streaming is unavailable', async () => {
  // The default fakes() have no fetchStream/putStream → buffered path.
  const { fetcher, store, fetched, puts } = fakes()
  const adapter = new BucketAdapter({ fetcher, store })
  await adapter.publish(
    {
      ref: { kind: 'intella', id: 'lora-3' }, editioId: 'ed-3',
      output: { slug: 'small', sources: [{ provenance: 'huggingface', uri: 'https://hf/small.safetensors' }] },
    },
    { visibility: 'private', custody: 'ours' },
  )
  assert.deepEqual(fetched, ['https://hf/small.safetensors'])
  assert.equal(puts[0].key, 'models/ed-3/small.safetensors')
})
