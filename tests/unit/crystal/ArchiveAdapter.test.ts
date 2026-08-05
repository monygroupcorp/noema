import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Readable } from 'node:stream'
import { ArchiveAdapter, type ArchiveSource, type ExportManifest } from '../../../src/crystal/ArchiveAdapter.js'
import type { MediaFetcher } from '../../../src/crystal/MediaFetcher.js'
import type { ObjectStore } from '../../../src/crystal/R2Uploader.js'
import type { Editio } from '../../../src/types/editio.js'

// =============================================================================
// ArchiveAdapter — bundles a Collectio's approved pieces into a ZIP hosted in R2.
// Injected fetcher + object store + source → no network, no real collection.
// =============================================================================

/** Extract the entry names from a ZIP buffer by scanning local file headers
 *  (PK\x03\x04). Filenames are stored UNCOMPRESSED in the header, so this works
 *  regardless of the deflate level — enough to assert the archive's layout. */
function zipEntryNames(buf: Buffer): string[] {
  const names: string[] = []
  for (let i = 0; i + 30 <= buf.length; i++) {
    if (buf[i] === 0x50 && buf[i + 1] === 0x4b && buf[i + 2] === 0x03 && buf[i + 3] === 0x04) {
      const nameLen = buf.readUInt16LE(i + 26)
      names.push(buf.subarray(i + 30, i + 30 + nameLen).toString('utf8'))
    }
  }
  return names
}

function fakes(manifest: ExportManifest | null) {
  const fetched: string[] = []
  const fetcher: MediaFetcher = {
    async fetch(url) {
      fetched.push(url)
      if (url.includes('boom')) throw new Error('fetch failed')
      return Buffer.from(`bytes:${url}`)
    },
  }
  const streamed: Array<{ key: string; contentType: string; buf: Buffer }> = []
  const dels: string[] = []
  const store: ObjectStore = {
    async put(key, bytes, contentType) { streamed.push({ key, contentType, buf: bytes }); return `https://cdn.example/${key}` },
    async del(key) { dels.push(key) },
    async putStream(key, body: Readable, contentType) {
      const chunks: Buffer[] = []
      for await (const c of body) chunks.push(c as Buffer)
      streamed.push({ key, contentType, buf: Buffer.concat(chunks) })
      return `https://cdn.example/${key}`
    },
  }
  const source: ArchiveSource = { async read() { return manifest } }
  return { fetcher, store, source, fetched, streamed, dels }
}

const piece = (url: string, traits: Array<[string, string]> = []) => ({
  output: { image: url },
  attributes: traits.map(([trait_type, value]) => ({ trait_type, value })),
})

test('publish: bundles every piece into images/ + metadata/ under a stable editioId key', async () => {
  const manifest: ExportManifest = {
    nomen: 'My Drop', provenanceHash: 'sha256:abc', numerus: 2,
    pieces: [piece('https://pod/a.png', [['bg', 'red']]), piece('https://pod/b.png', [['bg', 'blue']])],
  }
  const { fetcher, store, source, fetched, streamed } = fakes(manifest)
  const adapter = new ArchiveAdapter({ fetcher, store, source })
  assert.equal(adapter.key, 'archive')

  const { externalRef } = await adapter.publish(
    { ref: { kind: 'collectio', id: 'coll-1' }, editioId: 'ed-5' },
    { visibility: 'private', custody: 'ours' },
  )

  assert.deepEqual(fetched, ['https://pod/a.png', 'https://pod/b.png'], 'fetched each piece media in order')
  assert.equal(streamed.length, 1)
  assert.equal(streamed[0].key, 'exports/ed-5.zip', 'keyed by the publication id')
  assert.equal(streamed[0].contentType, 'application/zip')
  assert.equal(externalRef, 'https://cdn.example/exports/ed-5.zip')

  const names = zipEntryNames(streamed[0].buf)
  assert.deepEqual(
    names.sort(),
    ['images/0001.png', 'images/0002.png', 'manifest.json', 'metadata.json', 'metadata/0001.json', 'metadata/0002.json'].sort(),
    'zip layout: one image + one metadata sidecar per piece, plus the two roll-up files',
  )
  assert.ok(streamed[0].buf.subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 0x03, 0x04])), 'valid ZIP magic')
})

test('publish: a piece whose media 404s is SKIPPED, not fatal — sequence stays gapless', async () => {
  const manifest: ExportManifest = {
    provenanceHash: 'sha256:x', numerus: 3,
    pieces: [piece('https://pod/a.png'), piece('https://pod/boom.png'), piece('https://pod/c.png')],
  }
  const { fetcher, store, source, streamed } = fakes(manifest)
  const adapter = new ArchiveAdapter({ fetcher, store, source })
  await adapter.publish({ ref: { kind: 'collectio', id: 'c' }, editioId: 'ed-1' }, { visibility: 'private', custody: 'ours' })

  const names = zipEntryNames(streamed[0].buf).filter((n) => n.startsWith('images/')).sort()
  assert.deepEqual(names, ['images/0001.png', 'images/0002.png'], 'the failed piece is dropped and numbering stays contiguous')
})

test('publish: a piece with no resolvable media is skipped', async () => {
  const manifest: ExportManifest = {
    provenanceHash: 'sha256:x', numerus: 2,
    pieces: [{ output: { textContent: 'no media' }, attributes: [] }, piece('https://pod/b.png')],
  }
  const { fetcher, store, source, fetched, streamed } = fakes(manifest)
  const adapter = new ArchiveAdapter({ fetcher, store, source })
  await adapter.publish({ ref: { kind: 'collectio', id: 'c' }, editioId: 'ed-1' }, { visibility: 'private', custody: 'ours' })
  assert.deepEqual(fetched, ['https://pod/b.png'], 'only the piece with media was fetched')
  assert.deepEqual(zipEntryNames(streamed[0].buf).filter((n) => n.startsWith('images/')), ['images/0001.png'])
})

test('publish: throws when the collection has no approved pieces', async () => {
  const { fetcher, store, source } = fakes({ provenanceHash: 'sha256:x', numerus: 0, pieces: [] })
  const adapter = new ArchiveAdapter({ fetcher, store, source })
  await assert.rejects(
    () => adapter.publish({ ref: { kind: 'collectio', id: 'c' }, editioId: 'e' }, { visibility: 'private', custody: 'ours' }),
    /no approved pieces/,
  )
})

test('publish: throws when the collection is not found', async () => {
  const { fetcher, store, source } = fakes(null)
  const adapter = new ArchiveAdapter({ fetcher, store, source })
  await assert.rejects(
    () => adapter.publish({ ref: { kind: 'collectio', id: 'gone' }, editioId: 'e' }, { visibility: 'private', custody: 'ours' }),
    /not found/,
  )
})

test('publish: only a collectio can be archived', async () => {
  const { fetcher, store, source } = fakes({ provenanceHash: 'x', numerus: 1, pieces: [piece('https://pod/a.png')] })
  const adapter = new ArchiveAdapter({ fetcher, store, source })
  await assert.rejects(
    () => adapter.publish({ ref: { kind: 'actum', id: 'a' }, editioId: 'e' }, { visibility: 'private', custody: 'ours' }),
    /only a collection/,
  )
})

test('publish: falls back to buffered put when the store has no putStream', async () => {
  const manifest: ExportManifest = { provenanceHash: 'x', numerus: 1, pieces: [piece('https://pod/a.png')] }
  const fetched: string[] = []
  const fetcher: MediaFetcher = { async fetch(url) { fetched.push(url); return Buffer.from('x') } }
  const puts: Array<{ key: string; buf: Buffer }> = []
  const store: ObjectStore = {
    async put(key, bytes) { puts.push({ key, buf: bytes }); return `https://cdn.example/${key}` },
    async del() {},
  }
  const adapter = new ArchiveAdapter({ fetcher, store, source: { async read() { return manifest } } })
  const { externalRef } = await adapter.publish({ ref: { kind: 'collectio', id: 'c' }, editioId: 'ed-2' }, { visibility: 'private', custody: 'ours' })
  assert.equal(externalRef, 'https://cdn.example/exports/ed-2.zip')
  assert.equal(puts.length, 1)
  assert.ok(puts[0].buf.subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 0x03, 0x04])), 'buffered path still produces a valid ZIP')
})

test('retract: deletes the hosted ZIP object recovered from the URL', async () => {
  const { fetcher, store, dels } = fakes(null)
  const adapter = new ArchiveAdapter({ fetcher, store, source: { async read() { return null } } })
  await adapter.retract({ externalRef: 'https://cdn.example/exports/ed-5.zip' } as Editio)
  assert.deepEqual(dels, ['exports/ed-5.zip'])
})

test('retract: a no-externalRef editio is a safe no-op', async () => {
  const { fetcher, store, dels } = fakes(null)
  const adapter = new ArchiveAdapter({ fetcher, store, source: { async read() { return null } } })
  await adapter.retract({} as Editio)
  assert.equal(dels.length, 0)
})
