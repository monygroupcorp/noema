import { test } from 'node:test'
import assert from 'node:assert/strict'
import { GalleryAdapter, HOSTING_NOTICE } from '../../../src/crystal/GalleryAdapter.js'
import type { ArchiveSource, ExportManifest } from '../../../src/crystal/ArchiveAdapter.js'
import type { MediaFetcher } from '../../../src/crystal/MediaFetcher.js'
import type { ObjectStore } from '../../../src/crystal/R2Uploader.js'
import type { Editio } from '../../../src/types/editio.js'

// =============================================================================
// GalleryAdapter — hosts a collection's approved pieces as public ERC-721 tokenURIs
// (the temporary hosting bridge). Injected fetcher + store + source → no network.
// =============================================================================

function fakes(manifest: ExportManifest | null) {
  const fetched: string[] = []
  const objects = new Map<string, Buffer>()
  const dels: string[] = []
  const fetcher: MediaFetcher = {
    async fetch(url) {
      fetched.push(url)
      // Retract re-fetches our own manifest by URL — serve it from what we stored.
      if (url.includes('/manifest.json')) {
        const key = url.replace('https://cdn.example/', '')
        const buf = objects.get(key)
        if (buf) return buf
      }
      if (url.includes('boom')) throw new Error('fetch failed')
      return Buffer.from(`bytes:${url}`)
    },
  }
  const store: ObjectStore = {
    async put(key, bytes, _ct) { objects.set(key, bytes); return `https://cdn.example/${key}` },
    async del(key) { dels.push(key); objects.delete(key) },
  }
  const source: ArchiveSource = { async read() { return manifest } }
  return { fetcher, store, source, fetched, objects, dels }
}

const piece = (url: string, traits: Array<[string, string]> = []) => ({
  output: { image: url },
  attributes: traits.map(([trait_type, value]) => ({ trait_type, value })),
})

test('publish: hosts each piece as <editioId>/<tokenId>.png + .json under a public base uri', async () => {
  const manifest: ExportManifest = {
    nomen: 'My Drop', provenanceHash: 'sha256:abc', numerus: 2,
    pieces: [piece('https://pod/a.png', [['bg', 'red']]), piece('https://pod/b.png', [['bg', 'blue']])],
  }
  const { fetcher, store, source, objects } = fakes(manifest)
  const adapter = new GalleryAdapter({ fetcher, store, source })
  assert.equal(adapter.key, 'gallery')

  const { externalRef } = await adapter.publish(
    { ref: { kind: 'collectio', id: 'coll-1' }, editioId: 'ed-5' },
    { visibility: 'marketplace', custody: 'ours' },
  )

  // Base URI is the hosted directory — set your contract's baseURI to it.
  assert.equal(externalRef, 'https://cdn.example/gallery/ed-5')
  // Per-piece objects: image + metadata, 0-indexed tokenIds.
  assert.ok(objects.has('gallery/ed-5/0.png'))
  assert.ok(objects.has('gallery/ed-5/0.json'))
  assert.ok(objects.has('gallery/ed-5/1.png'))
  assert.ok(objects.has('gallery/ed-5/1.json'))
  // Metadata's `image` is the FULL public url (not a relative path) so a tokenURI resolves it.
  const meta0 = JSON.parse(objects.get('gallery/ed-5/0.json')!.toString('utf8'))
  assert.equal(meta0.image, 'https://cdn.example/gallery/ed-5/0.png')
  assert.deepEqual(meta0.attributes, [{ trait_type: 'bg', value: 'red' }])
})

test('publish: writes a manifest with the honest-custody notice + a retract file index', async () => {
  const manifest: ExportManifest = {
    provenanceHash: 'sha256:x', numerus: 2,
    pieces: [piece('https://pod/a.png'), piece('https://pod/b.png')],
  }
  const { fetcher, store, source, objects } = fakes(manifest)
  const adapter = new GalleryAdapter({ fetcher, store, source })
  await adapter.publish({ ref: { kind: 'collectio', id: 'c' }, editioId: 'ed-1' }, { visibility: 'marketplace', custody: 'ours' })

  const m = JSON.parse(objects.get('gallery/ed-1/manifest.json')!.toString('utf8'))
  assert.equal(m.collection.totalSupply, 2)
  assert.equal(m.collection.tokenIdStart, 0)
  assert.equal(m.hosting.durability, 'best-effort')
  assert.equal(m.hosting.notice, HOSTING_NOTICE)
  assert.deepEqual(m.files, ['0.png', '0.json', '1.png', '1.json', 'manifest.json', 'metadata.json'])
})

test('publish: a piece whose media 404s is skipped; tokenIds stay contiguous', async () => {
  const manifest: ExportManifest = {
    provenanceHash: 'sha256:x', numerus: 3,
    pieces: [piece('https://pod/a.png'), piece('https://pod/boom.png'), piece('https://pod/c.png')],
  }
  const { fetcher, store, source, objects } = fakes(manifest)
  const adapter = new GalleryAdapter({ fetcher, store, source })
  await adapter.publish({ ref: { kind: 'collectio', id: 'c' }, editioId: 'ed-1' }, { visibility: 'marketplace', custody: 'ours' })
  assert.ok(objects.has('gallery/ed-1/0.png'))
  assert.ok(objects.has('gallery/ed-1/1.png'))
  assert.ok(!objects.has('gallery/ed-1/2.png'), 'only two pieces hosted; numbering is gapless')
  const m = JSON.parse(objects.get('gallery/ed-1/manifest.json')!.toString('utf8'))
  assert.equal(m.skipped, 1)
})

test('publish: throws when no piece media can be hosted', async () => {
  const { fetcher, store, source } = fakes({ provenanceHash: 'x', numerus: 1, pieces: [piece('https://pod/boom.png')] })
  const adapter = new GalleryAdapter({ fetcher, store, source })
  await assert.rejects(
    () => adapter.publish({ ref: { kind: 'collectio', id: 'c' }, editioId: 'e' }, { visibility: 'marketplace', custody: 'ours' }),
    /no piece media could be hosted/,
  )
})

test('publish: only a collectio can be hosted; empty collection rejected', async () => {
  const okManifest: ExportManifest = { provenanceHash: 'x', numerus: 1, pieces: [piece('https://pod/a.png')] }
  let a = new GalleryAdapter({ ...fakes(okManifest), source: { async read() { return okManifest } } })
  await assert.rejects(
    () => a.publish({ ref: { kind: 'actum', id: 'x' }, editioId: 'e' }, { visibility: 'marketplace', custody: 'ours' }),
    /only a collection/,
  )
  a = new GalleryAdapter({ ...fakes(null), source: { async read() { return { provenanceHash: 'x', numerus: 0, pieces: [] } } } })
  await assert.rejects(
    () => a.publish({ ref: { kind: 'collectio', id: 'c' }, editioId: 'e' }, { visibility: 'marketplace', custody: 'ours' }),
    /no approved pieces/,
  )
})

test('retract: deletes every hosted object listed in the manifest', async () => {
  const manifest: ExportManifest = {
    provenanceHash: 'sha256:x', numerus: 2,
    pieces: [piece('https://pod/a.png'), piece('https://pod/b.png')],
  }
  const { fetcher, store, source, dels, objects } = fakes(manifest)
  const adapter = new GalleryAdapter({ fetcher, store, source })
  const { externalRef } = await adapter.publish({ ref: { kind: 'collectio', id: 'c' }, editioId: 'ed-7' }, { visibility: 'marketplace', custody: 'ours' })

  await adapter.retract({ externalRef } as Editio)
  assert.deepEqual(
    dels.sort(),
    ['gallery/ed-7/0.json', 'gallery/ed-7/0.png', 'gallery/ed-7/1.json', 'gallery/ed-7/1.png', 'gallery/ed-7/manifest.json', 'gallery/ed-7/metadata.json'].sort(),
  )
  assert.equal(objects.size, 0, 'the whole hosted set is gone')
})

test('retract: a no-externalRef editio is a safe no-op', async () => {
  const { fetcher, store, source, dels } = fakes(null)
  const adapter = new GalleryAdapter({ fetcher, store, source })
  await adapter.retract({} as Editio)
  assert.equal(dels.length, 0)
})
