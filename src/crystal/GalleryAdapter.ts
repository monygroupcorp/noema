// =============================================================================
// GalleryAdapter — host a Collectio's pieces as public ERC-721 tokenURIs
// =============================================================================
//
// The "publish to hosting" destination (editio-export-spec.md): a TEMPORARY BRIDGE.
// NOEMA hosts each approved piece + its OpenSea metadata under a stable, PUBLIC base
// URI, so an artist can point ANY contract's `tokenURI(id)` at it and mint elsewhere
// (or NOESIS — which is static + secretless — leans on this endpoint because it
// cannot host tokenURIs itself). It is ALSO the mutable-projection endpoint dynamic /
// event NFTs need (living-NFTs reuse this substrate).
//
// EXPLICITLY BEST-EFFORT, NOT PERMANENT CUSTODY. NOEMA is an AI-generation platform,
// not a storage provider — the manifest carries a notice urging migration to Arweave/
// IPFS. `retract` deletes the hosted set (revocable, like the bucket adapter). The
// durable path is the separate Arweave graduation (a one-way, credit-metered push).
//
// PUBLIC surface → gated by the moderation gate exactly like the feed (a predictable
// base URI can't be unguessable). Keyed by the publication id so a re-settle overwrites
// the same objects (idempotent) and `retract` can recompute the directory.
//
// Layout (OpenSea ERC-721 metadata standard), 0-indexed tokenIds:
//   <base>/<editioId>/<tokenId>.<ext>   — the image
//   <base>/<editioId>/<tokenId>.json    — { name, image (FULL url), attributes[] }
//   <base>/<editioId>/manifest.json     — header + items + `files` (for retract)
//   <base>/<editioId>/metadata.json     — flat array of every item's metadata
// `externalRef` = the base URI `<base>/<editioId>` (set your contract's baseURI to it).
// =============================================================================

import { v4 as uuidv4 } from 'uuid'
import type { PublicationAdapter, PublishArtifact, PublishPolicy } from './PublicationAdapter.js'
import type { Editio } from '../types/editio.js'
import type { MediaFetcher } from './MediaFetcher.js'
import type { ObjectStore } from './R2Uploader.js'
import { primaryMediaUrl, mediaTypeFor } from './BucketAdapter.js'
import type { ArchiveSource } from './ArchiveAdapter.js'
import { makeLogger } from '../lib/logger.js'

const log = makeLogger('publishing:gallery')

/** The honest-custody notice embedded in every hosted manifest. */
export const HOSTING_NOTICE =
  'Hosted by NOEMA as a best-effort, temporary bridge — NOEMA is an AI-generation platform, ' +
  'not a permanent storage provider. Migrate these tokenURIs to Arweave/IPFS before relying ' +
  'on them long-term; NOEMA does not guarantee indefinite availability.'

export class GalleryAdapter implements PublicationAdapter {
  readonly key = 'gallery'
  private readonly prefix: string

  constructor(private readonly deps: { fetcher: MediaFetcher; store: ObjectStore; source: ArchiveSource; prefix?: string }) {
    this.prefix = deps.prefix ?? 'gallery'
  }

  async publish(artifact: PublishArtifact, _policy: PublishPolicy): Promise<{ externalRef: string }> {
    if (artifact.ref.kind !== 'collectio') {
      throw new Error('gallery-adapter: only a collection can be hosted')
    }
    const manifest = await this.deps.source.read(artifact.ref.id)
    if (!manifest) throw new Error(`gallery-adapter: collection ${artifact.ref.id} not found`)
    if (manifest.pieces.length === 0) throw new Error('gallery-adapter: collection has no approved pieces to host')

    const id = artifact.editioId ?? uuidv4()
    const dir = `${this.prefix}/${id}`

    const items: Array<{ tokenId: number; image: string; metadata: string; attributes: unknown[] }> = []
    const files: string[] = []
    let tokenId = 0
    let skipped = 0
    for (const piece of manifest.pieces) {
      const url = primaryMediaUrl(piece.output)
      if (!url) { skipped++; continue }
      const { ext, contentType } = mediaTypeFor(url)
      let bytes: Buffer
      try {
        bytes = await this.deps.fetcher.fetch(url)
      } catch (err) {
        log.warn('gallery: piece media fetch failed — skipping', { url, error: String(err) })
        skipped++
        continue
      }
      const imageName = `${tokenId}.${ext}`
      const metaName = `${tokenId}.json`
      const imageUrl = await this.deps.store.put(`${dir}/${imageName}`, bytes, contentType)
      const meta = {
        name: `${manifest.nomen ?? 'Piece'} #${tokenId}`,
        image: imageUrl, // FULL public url — a tokenURI resolves the art directly
        attributes: piece.attributes ?? [],
      }
      const metaUrl = await this.deps.store.put(`${dir}/${metaName}`, Buffer.from(JSON.stringify(meta, null, 2)), 'application/json')
      items.push({ tokenId, image: imageUrl, metadata: metaUrl, attributes: meta.attributes })
      files.push(imageName, metaName)
      tokenId++
    }
    if (items.length === 0) throw new Error('gallery-adapter: no piece media could be hosted')

    // The base URI is a hosted image URL minus its filename — store-agnostic (works for
    // any ObjectStore that returns a public `<base>/<key>` url).
    const firstImage = items[0].image
    const baseUri = firstImage.slice(0, firstImage.lastIndexOf('/'))

    const rollup = {
      collection: {
        id: artifact.ref.id,
        ...(manifest.nomen !== undefined ? { name: manifest.nomen } : {}),
        provenanceHash: manifest.provenanceHash,
        totalSupply: items.length,
        tokenIdStart: 0,
      },
      baseUri,
      hosting: { provider: 'noema-r2', durability: 'best-effort', notice: HOSTING_NOTICE },
      ...(skipped > 0 ? { skipped } : {}),
      items,
      // Relative object names under `<dir>/` — the index `retract` deletes by.
      files: [...files, 'manifest.json', 'metadata.json'],
    }
    await this.deps.store.put(`${dir}/metadata.json`, Buffer.from(JSON.stringify(items, null, 2)), 'application/json')
    await this.deps.store.put(`${dir}/manifest.json`, Buffer.from(JSON.stringify(rollup, null, 2)), 'application/json')
    log.info('gallery published', { collectioId: artifact.ref.id, editioId: id, pieces: items.length, skipped, baseUri })
    return { externalRef: baseUri }
  }

  async retract(editio: Editio): Promise<void> {
    if (!editio.externalRef) return
    const marker = `/${this.prefix}/`
    const at = editio.externalRef.indexOf(marker)
    if (at < 0) return
    const dir = `${this.prefix}/${editio.externalRef.slice(at + marker.length)}`
    // Enumerate the hosted objects from our own manifest, then delete each (best-effort —
    // a temporary bridge; a partially-deleted set still converges to gone).
    let files: string[] = ['manifest.json', 'metadata.json']
    try {
      const buf = await this.deps.fetcher.fetch(`${editio.externalRef}/manifest.json`)
      const m = JSON.parse(buf.toString('utf8')) as { files?: string[] }
      if (Array.isArray(m.files)) files = m.files
    } catch (err) {
      log.warn('gallery retract: manifest unreadable — deleting rollups only', { error: String(err) })
    }
    for (const f of files) {
      try {
        await this.deps.store.del(`${dir}/${f}`)
      } catch (err) {
        log.warn('gallery retract: delete failed', { key: `${dir}/${f}`, error: String(err) })
      }
    }
  }
}
