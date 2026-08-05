// =============================================================================
// ArchiveAdapter — bundle a Collectio's pieces into a downloadable ZIP
// =============================================================================
//
// The "export to you" / sovereign-download destination (spec: publishing #1,
// editio-export-spec.md). Ports the legacy `CollectionExportService` worker onto
// the publishing spine: enumerate a Collectio's approved pieces, stream each
// piece's media + an OpenSea-style metadata sidecar into a ZIP, host that ZIP in
// OUR bucket, and return its URL as the Editio's `externalRef`.
//
// custody = 'ours', visibility = 'private' — a download is NOT a public surface,
// so it never touches the moderation gate (that fires only on feed/marketplace).
// This is why it works today while public destinations are fail-closed.
//
// The ZIP is streamed (archiver → PassThrough → R2 multipart put) so a 2 GB drop
// never materializes whole in memory. Keyed by the publication id so a re-settle
// (at-least-once delivery) overwrites the same object — idempotent — and `retract`
// can recompute the key to delete it.
//
// Zip layout (mirrors the legacy exporter so downstream tooling is unchanged):
//   images/<NNNN>.<ext>      — one per approved piece, 1-based, zero-padded
//   metadata/<NNNN>.json     — OpenSea metadata { name, image, attributes[] }
//   manifest.json            — collection header + every item
//   metadata.json            — flat array of every item's metadata
// =============================================================================

import archiver from 'archiver'
import { PassThrough } from 'node:stream'
import { v4 as uuidv4 } from 'uuid'
import type { PublicationAdapter, PublishArtifact, PublishPolicy } from './PublicationAdapter.js'
import type { Editio } from '../types/editio.js'
import type { MediaFetcher } from './MediaFetcher.js'
import type { ObjectStore } from './R2Uploader.js'
import { primaryMediaUrl, mediaTypeFor } from './BucketAdapter.js'
import { makeLogger } from '../lib/logger.js'

const log = makeLogger('publishing:archive')

/** One trait pair, OpenSea `attributes[]` shape. */
export interface ExportAttribute { trait_type: string; value: string }

/** One exportable piece: its produced media plus stamped trait attributes. */
export interface ExportPiece {
  /** The piece's produced output (an Actum's exitus) — media URL is pulled from it. */
  output?: Record<string, unknown>
  attributes?: ExportAttribute[]
}

/** The collection header + its approved pieces, resolved for export. */
export interface ExportManifest {
  nomen?: string
  provenanceHash: string
  numerus: number
  pieces: ExportPiece[]
}

/** Resolves a Collectio's exportable pieces. Injected so the adapter stays free of
 *  store knowledge (and unit-testable with an in-memory fake). Ownership is already
 *  enforced upstream at publish time — this read is not owner-scoped. */
export interface ArchiveSource {
  read(collectioId: string): Promise<ExportManifest | null>
}

export class ArchiveAdapter implements PublicationAdapter {
  readonly key = 'archive'
  private readonly prefix: string

  constructor(private readonly deps: { fetcher: MediaFetcher; store: ObjectStore; source: ArchiveSource; prefix?: string }) {
    this.prefix = deps.prefix ?? 'exports'
  }

  async publish(artifact: PublishArtifact, _policy: PublishPolicy): Promise<{ externalRef: string }> {
    if (artifact.ref.kind !== 'collectio') {
      throw new Error('archive-adapter: only a collection can be exported to an archive')
    }
    const manifest = await this.deps.source.read(artifact.ref.id)
    if (!manifest) throw new Error(`archive-adapter: collection ${artifact.ref.id} not found`)
    if (manifest.pieces.length === 0) {
      throw new Error('archive-adapter: collection has no approved pieces to export')
    }

    const id = artifact.editioId ?? uuidv4()
    const key = `${this.prefix}/${id}.zip`
    const width = String(manifest.pieces.length).padStart(4, '0').length

    const archive = archiver('zip', { zlib: { level: 9 } })
    const pass = new PassThrough()
    archive.pipe(pass)
    // Forward a fatal archiver error onto the piped stream so the upload REJECTS
    // (→ the settle's catch marks the Editio failed) instead of throwing uncaught
    // on an unhandled 'error' event and crashing the worker.
    archive.on('error', (err) => pass.destroy(err))
    archive.on('warning', (err) => log.warn('archiver warning', { error: String(err) }))

    // Start the multipart upload FIRST — it consumes `pass` as we append, so the
    // zip is never buffered whole. `putStream` resolves with the hosted URL.
    const uploaded = this.deps.store.putStream
      ? this.deps.store.putStream(key, pass, 'application/zip')
      : this._bufferedPut(key, pass)

    const items: Array<Record<string, unknown>> = []
    let skipped = 0
    let seq = 0
    for (const piece of manifest.pieces) {
      const url = primaryMediaUrl(piece.output)
      if (!url) { skipped++; continue }
      seq++
      const { ext } = mediaTypeFor(url)
      const padded = String(seq).padStart(width, '0')
      const imagePath = `images/${padded}.${ext}`
      try {
        const bytes = await this.deps.fetcher.fetch(url)
        archive.append(bytes, { name: imagePath })
      } catch (err) {
        log.warn('archive: piece media fetch failed — skipping', { url, error: String(err) })
        seq--
        skipped++
        continue
      }
      const meta = {
        name: `${manifest.nomen ?? 'Piece'} #${seq}`,
        image: imagePath,
        attributes: piece.attributes ?? [],
      }
      archive.append(JSON.stringify(meta, null, 2), { name: `metadata/${padded}.json` })
      items.push(meta)
    }

    const manifestDoc = {
      collection: {
        id: artifact.ref.id,
        ...(manifest.nomen !== undefined ? { name: manifest.nomen } : {}),
        provenanceHash: manifest.provenanceHash,
        totalSupply: items.length,
      },
      ...(skipped > 0 ? { skipped } : {}),
      items,
    }
    archive.append(JSON.stringify(manifestDoc, null, 2), { name: 'manifest.json' })
    archive.append(JSON.stringify(items, null, 2), { name: 'metadata.json' })

    await archive.finalize()
    const hosted = await uploaded
    log.info('archive published', { collectioId: artifact.ref.id, editioId: id, pieces: items.length, skipped })
    return { externalRef: hosted }
  }

  /** Buffer-then-put fallback for stores without streaming (in-memory test fakes). */
  private async _bufferedPut(key: string, pass: PassThrough): Promise<string> {
    const chunks: Buffer[] = []
    for await (const chunk of pass) chunks.push(chunk as Buffer)
    return this.deps.store.put(key, Buffer.concat(chunks), 'application/zip')
  }

  async retract(editio: Editio): Promise<void> {
    if (!editio.externalRef) return
    const marker = `/${this.prefix}/`
    const at = editio.externalRef.indexOf(marker)
    if (at < 0) return
    await this.deps.store.del(`${this.prefix}/${editio.externalRef.slice(at + marker.length)}`)
  }
}
