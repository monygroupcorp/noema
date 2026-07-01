// =============================================================================
// ArweaveUploader — graduate a collection to PERMANENT Arweave storage
// =============================================================================
//
// The "migrate to permanence" step for the hosting bridge (see GalleryAdapter):
// an artist spends credits and NOEMA pushes their pieces to Arweave via a bundler
// (Irys) on their behalf — a one-way, pay-once upload that yields a permanent base
// URI to point a contract's `baseURI` at. NOEMA holds the funded Irys account (a
// secret) so this lives NOEMA-side; NOESIS (static/secretless) cannot.
//
// SPLIT for testability (mirrors HfUploader):
//   - `ArweaveUploader` — the ORCHESTRATION: fetch → meter/charge → two-pass upload
//     (images, then metadata pointing at the image txids) → build + upload an Arweave
//     PATH MANIFEST so `<gateway>/<manifestTxid>/<tokenId>.json` resolves. Pure logic
//     over injected seams; fully hermetically tested with fakes.
//   - `IrysTransport` — the REAL Irys bundler (SDK). LIVE-UNVERIFIED: needs a funded
//     wallet + network, so it is the only untested surface. Lazy-loaded.
//
// ⚠ GO-LIVE HARDENING (before real funding — a paid, NON-IDEMPOTENT upload):
//   1. The PublicationWorker is at-least-once; a re-settle would RE-UPLOAD + RE-CHARGE.
//      Persist the manifest txid on the Editio and short-circuit a retry before wiring
//      real funds. 2. Charge happens after fetch/before upload; a mid-upload crash
//      leaves paid-for orphan data items with no manifest. 3. `charge` here is a SEAM —
//      the container wires the real ledger debit + a bytes→credits price/markup.
// =============================================================================

import type { MediaFetcher } from './MediaFetcher.js'
import { primaryMediaUrl, mediaTypeFor } from './BucketAdapter.js'
import type { ExportManifest } from './ArchiveAdapter.js'
import { makeLogger } from '../lib/logger.js'

const log = makeLogger('publishing:arweave')

/** One uploaded Arweave data item — its transaction id + a gateway URL. */
export interface ArweaveUpload { id: string; url: string }

/** The Arweave bundler I/O seam. Injected so the orchestration is fake-testable;
 *  the real impl is `IrysTransport`. Just two ops — the path manifest is built in
 *  the orchestration and uploaded through `upload` like any other object. */
export interface ArweaveTransport {
  /** Estimated cost (atomic funding units, e.g. winston) to store `bytes`. */
  price(bytes: number): Promise<bigint>
  /** Upload one data item; returns its txid + gateway URL. */
  upload(bytes: Buffer, contentType: string): Promise<ArweaveUpload>
}

/** Metering seam — charge the publisher for `bytes` of permanent storage (throws if
 *  they cannot afford it). The container wires the real credit debit. */
export interface ArweaveCharger {
  charge(by: { animaId: string } | { commitment: string }, bytes: number): Promise<void>
}

export interface GraduateRequest {
  pieces: ExportManifest['pieces']
  nomen?: string
  by: { animaId: string } | { commitment: string }
}

export interface GraduateResult { baseUri: string; manifestTxid: string; count: number; bytes: number }

const MANIFEST_CONTENT_TYPE = 'application/x.arweave-manifest+json'

export class ArweaveUploader {
  constructor(private readonly deps: { transport: ArweaveTransport; fetcher: MediaFetcher; charger?: ArweaveCharger }) {}

  /** Push a collection's approved pieces to Arweave + tie them into one base URI. */
  async graduate(req: GraduateRequest): Promise<GraduateResult> {
    // 1) Fetch every piece up front so we can meter the total before spending funds.
    const fetched: Array<{ imageName: string; metaName: string; bytes: Buffer; contentType: string; attributes: unknown[] }> = []
    let tokenId = 0
    let bytes = 0
    for (const piece of req.pieces) {
      const url = primaryMediaUrl(piece.output)
      if (!url) continue
      const { ext, contentType } = mediaTypeFor(url)
      const buf = await this.deps.fetcher.fetch(url)
      bytes += buf.length
      fetched.push({ imageName: `${tokenId}.${ext}`, metaName: `${tokenId}.json`, bytes: buf, contentType, attributes: piece.attributes ?? [] })
      tokenId++
    }
    if (fetched.length === 0) throw new Error('arweave: no piece media to graduate')

    // 2) Meter FIRST — refuse before we spend Irys funds if the publisher can't pay.
    if (this.deps.charger) await this.deps.charger.charge(req.by, bytes)

    // 3) Two-pass upload: image → txid, then metadata whose `image` is the image's
    //    permanent gateway URL. Collect a path→txid map for the manifest.
    const paths: Record<string, { id: string }> = {}
    for (let i = 0; i < fetched.length; i++) {
      const f = fetched[i]
      const img = await this.deps.transport.upload(f.bytes, f.contentType)
      const meta = { name: `${req.nomen ?? 'Piece'} #${i}`, image: img.url, attributes: f.attributes }
      const metaUp = await this.deps.transport.upload(Buffer.from(JSON.stringify(meta, null, 2)), 'application/json')
      paths[f.imageName] = { id: img.id }
      paths[f.metaName] = { id: metaUp.id }
    }

    // 4) One Arweave path manifest ties the whole set under a single txid, so a
    //    contract's baseURI = `<gateway>/<manifestTxid>/` and `tokenURI` resolves at
    //    `<gateway>/<manifestTxid>/<tokenId>.json`.
    const manifestDoc = {
      manifest: 'arweave/paths',
      version: '0.1.0',
      index: { path: '0.json' },
      paths,
    }
    const manifest = await this.deps.transport.upload(Buffer.from(JSON.stringify(manifestDoc)), MANIFEST_CONTENT_TYPE)
    log.info('arweave graduation complete', { count: fetched.length, bytes, manifestTxid: manifest.id })
    return { baseUri: manifest.url, manifestTxid: manifest.id, count: fetched.length, bytes }
  }
}

// ---------------------------------------------------------------------------
// IrysTransport — the REAL Irys bundler. LIVE-UNVERIFIED (no funded wallet in tests).
// Lazy-loads the SDK so an unconfigured boot never touches it. The SDK surface
// (`getPrice`, `upload`) must be re-checked against Irys docs when funding lands.
// ---------------------------------------------------------------------------

export interface IrysConfig {
  /** Funding wallet private key (an EVM key for the ethereum token). Secret → env. */
  privateKey: string
  /** Gateway base for resolving txids (default the Irys gateway). */
  gateway?: string
}

/** The slice of the Irys client the transport uses. Kept minimal + local because the
 *  SDK surface is LIVE-UNVERIFIED — re-check `getPrice`/`upload` against Irys docs
 *  when a funded wallet is set up. */
interface IrysClient {
  getPrice(bytes: number): Promise<{ toString(): string }>
  upload(data: Buffer, opts?: { tags?: Array<{ name: string; value: string }> }): Promise<{ id: string }>
}

export class IrysTransport implements ArweaveTransport {
  private client?: Promise<IrysClient>
  private readonly gateway: string

  constructor(private readonly cfg: IrysConfig) {
    this.gateway = (cfg.gateway ?? 'https://gateway.irys.xyz').replace(/\/$/, '')
  }

  private irys(): Promise<IrysClient> {
    if (!this.client) {
      this.client = (async () => {
        // Lazy dynamic import — the SDK is only needed when Arweave is actually configured.
        const { Uploader } = await import('@irys/upload')
        const { Ethereum } = await import('@irys/upload-ethereum')
        const built = await (Uploader(Ethereum) as unknown as { withWallet(k: string): Promise<unknown> }).withWallet(this.cfg.privateKey)
        return built as IrysClient
      })()
    }
    return this.client
  }

  async price(bytes: number): Promise<bigint> {
    const irys = await this.irys()
    return BigInt((await irys.getPrice(bytes)).toString())
  }

  async upload(bytes: Buffer, contentType: string): Promise<ArweaveUpload> {
    const irys = await this.irys()
    const receipt = await irys.upload(bytes, { tags: [{ name: 'Content-Type', value: contentType }] })
    return { id: receipt.id, url: `${this.gateway}/${receipt.id}` }
  }
}
