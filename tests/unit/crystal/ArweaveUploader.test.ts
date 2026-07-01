import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ArweaveUploader, type ArweaveTransport, type ArweaveCharger } from '../../../src/crystal/ArweaveUploader.js'
import { ArweaveAdapter } from '../../../src/crystal/ArweaveAdapter.js'
import type { ArchiveSource, ExportManifest } from '../../../src/crystal/ArchiveAdapter.js'
import type { MediaFetcher } from '../../../src/crystal/MediaFetcher.js'

// =============================================================================
// ArweaveUploader — two-pass upload (image → metadata → path manifest) with a
// metering seam. Hermetic: fake transport + fake charger + fake fetcher.
// =============================================================================

function fakeTransport() {
  const uploads: Array<{ contentType: string; text: string }> = []
  let n = 0
  const transport: ArweaveTransport = {
    async price(bytes) { return BigInt(bytes) },
    async upload(bytes, contentType) { const id = `tx-${n++}`; uploads.push({ contentType, text: bytes.toString('utf8') }); return { id, url: `https://gw/${id}` } },
  }
  return { transport, uploads }
}

const fetcher: MediaFetcher = { async fetch(url) { return Buffer.from(`bytes:${url}`) } }
const piece = (url: string, traits: Array<[string, string]> = []) => ({
  output: { image: url },
  attributes: traits.map(([trait_type, value]) => ({ trait_type, value })),
})

test('graduate: uploads image + metadata per piece and a path manifest tying them together', async () => {
  const { transport, uploads } = fakeTransport()
  const charged: Array<{ by: unknown; bytes: number }> = []
  const charger: ArweaveCharger = { async charge(by, bytes) { charged.push({ by, bytes }); } }
  const uploader = new ArweaveUploader({ transport, fetcher, charger })

  const res = await uploader.graduate({
    pieces: [piece('https://pod/a.png', [['bg', 'red']]), piece('https://pod/b.png')],
    nomen: 'Drop', by: { animaId: 'anima-1' },
  })

  // 2 images + 2 metadata + 1 manifest.
  assert.equal(uploads.length, 5)
  assert.equal(uploads[0].contentType, 'image/png')
  assert.equal(uploads[1].contentType, 'application/json')
  assert.equal(uploads[4].contentType, 'application/x.arweave-manifest+json')

  // The metadata's `image` is the image's permanent gateway URL (not the source url).
  const meta0 = JSON.parse(uploads[1].text)
  assert.equal(meta0.image, 'https://gw/tx-0')
  assert.deepEqual(meta0.attributes, [{ trait_type: 'bg', value: 'red' }])

  // The path manifest maps each tokenId file → its txid.
  const manifest = JSON.parse(uploads[4].text)
  assert.equal(manifest.manifest, 'arweave/paths')
  assert.deepEqual(manifest.paths, {
    '0.png': { id: 'tx-0' }, '0.json': { id: 'tx-1' },
    '1.png': { id: 'tx-2' }, '1.json': { id: 'tx-3' },
  })

  // Base URI is the manifest txid; count + metered bytes reported.
  assert.equal(res.baseUri, 'https://gw/tx-4')
  assert.equal(res.manifestTxid, 'tx-4')
  assert.equal(res.count, 2)
  assert.equal(res.bytes, Buffer.from('bytes:https://pod/a.png').length + Buffer.from('bytes:https://pod/b.png').length)

  // Metered the publisher for the total image bytes, before uploading.
  assert.equal(charged.length, 1)
  assert.deepEqual(charged[0].by, { animaId: 'anima-1' })
  assert.equal(charged[0].bytes, res.bytes)
})

test('graduate: an unaffordable charge aborts BEFORE any upload', async () => {
  const { transport, uploads } = fakeTransport()
  const charger: ArweaveCharger = { async charge() { throw new Error('insufficient credits') } }
  const uploader = new ArweaveUploader({ transport, fetcher, charger })
  await assert.rejects(
    () => uploader.graduate({ pieces: [piece('https://pod/a.png')], by: { animaId: 'a' } }),
    /insufficient credits/,
  )
  assert.equal(uploads.length, 0, 'nothing was uploaded — no Irys funds spent')
})

test('graduate: pieces without media are skipped; empty set throws', async () => {
  const { transport } = fakeTransport()
  const uploader = new ArweaveUploader({ transport, fetcher })
  const res = await uploader.graduate({ pieces: [{ output: { textContent: 'x' } }, piece('https://pod/b.png')], by: { commitment: 'c1' } })
  assert.equal(res.count, 1, 'only the piece with media graduated')

  await assert.rejects(
    () => uploader.graduate({ pieces: [{ output: { textContent: 'x' } }], by: { commitment: 'c1' } }),
    /no piece media/,
  )
})

// ── ArweaveAdapter (spine seam) ──────────────────────────────────────────────

function adapterFor(manifest: ExportManifest | null) {
  const { transport, uploads } = fakeTransport()
  const uploader = new ArweaveUploader({ transport, fetcher })
  const source: ArchiveSource = { async read() { return manifest } }
  return { adapter: new ArweaveAdapter({ uploader, source }), uploads }
}

test('adapter: graduates a collection and returns the Arweave base URI', async () => {
  const manifest: ExportManifest = { nomen: 'Drop', provenanceHash: 'x', numerus: 1, pieces: [piece('https://pod/a.png')] }
  const { adapter } = adapterFor(manifest)
  assert.equal(adapter.key, 'arweave')
  const { externalRef } = await adapter.publish(
    { ref: { kind: 'collectio', id: 'c' }, editioId: 'e', by: { animaId: 'anima-1' } },
    { visibility: 'marketplace', custody: 'ours' },
  )
  assert.match(externalRef, /^https:\/\/gw\/tx-\d+$/)
})

test('adapter: requires a publishing identity (to meter the cost)', async () => {
  const manifest: ExportManifest = { provenanceHash: 'x', numerus: 1, pieces: [piece('https://pod/a.png')] }
  const { adapter } = adapterFor(manifest)
  await assert.rejects(
    () => adapter.publish({ ref: { kind: 'collectio', id: 'c' }, editioId: 'e' }, { visibility: 'marketplace', custody: 'ours' }),
    /publishing identity is required/,
  )
})

test('adapter: only a collectio; not retractable (permanent)', async () => {
  const { adapter } = adapterFor({ provenanceHash: 'x', numerus: 1, pieces: [piece('https://pod/a.png')] })
  await assert.rejects(
    () => adapter.publish({ ref: { kind: 'actum', id: 'a' }, editioId: 'e', by: { animaId: 'x' } }, { visibility: 'marketplace', custody: 'ours' }),
    /only a collection/,
  )
  assert.equal((adapter as { retract?: unknown }).retract, undefined, 'no retract — Arweave is permanent')
})
