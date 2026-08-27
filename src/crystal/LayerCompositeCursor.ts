import type { Cursor, CursorResult } from '../types/cursus.js'
import type { Actum } from '../types/actum.js'
import type { Modus } from '../types/modus.js'
import type { LayerCompositeEngine } from './LayerCompositeEngine.js'
import type { MediaFetcher } from './MediaFetcher.js'
import { privateMarker, privateWritePrefix } from './MediaFetcher.js'
import type { Uploader } from './R2Uploader.js'
import { randomUUID } from 'node:crypto'

// =============================================================================
// LayerCompositeCursor — the host-side "layer-composite" runtime
// =============================================================================
//
// A deterministic, host-side cursor (ministerium 'composite') — a sibling of
// the ApiCursor: synchronous, no GPU pod. It fetches the
// ordered layer images, composites them (z-order, bottom→top), hosts the result
// and returns the URL inline.
//
// Inputs (aditus):
//   - `layers`: ordered image URLs, bottom→top (an array, or a single URL).
//               Declared as a `text` Porta so an array passes validation intact.
//   - `width` / `height` (optional): force the canvas size.
// Output (exitus): `{ image }` — the composited PNG.
//
// Host-side deterministic work is effectively free → reserve/charge 0n (the
// Cursor contract's local/self-hosted convention).

export class LayerCompositeCursor implements Cursor {
  constructor(
    private readonly deps: {
      engine: LayerCompositeEngine
      fetcher: MediaFetcher
      uploader: Uploader
      /** The private-outputs store (noema-347). Present only where the deployment configures a
       *  private bucket; absent, a private run cannot be composited host-side and is refused
       *  rather than written to the public bucket. */
      privateUploader?: Uploader
    },
  ) {}

  async reserve(modus: Modus, _aditus: Record<string, unknown>): Promise<bigint> {
    return modus.impetusFixum ?? 0n
  }

  async run(actum: Actum): Promise<CursorResult> {
    const aditus = actum.aditus
    const urls = readLayers(aditus.layers)
    if (urls.length === 0) {
      throw new Error('layer-composite: `layers` is required (ordered image URLs, bottom→top)')
    }

    const buffers: Buffer[] = []
    for (const url of urls) buffers.push(await this.deps.fetcher.fetch(url))

    const opts: { width?: number; height?: number } = {}
    const width = asPositiveInt(aditus.width)
    const height = asPositiveInt(aditus.height)
    if (width !== undefined) opts.width = width
    if (height !== undefined) opts.height = height

    const png = await this.deps.engine.composite(buffers, opts)

    // A private run — by its dispatch stamp, or because a layer we just read is private —
    // writes to the private store and yields a marker, never a URL.
    const prefix = privateWritePrefix(actum, urls)
    if (prefix) {
      if (!this.deps.privateUploader) {
        throw new Error('layer-composite: this run is private but no private-outputs store is configured')
      }
      const key = `${prefix}${randomUUID()}.png`
      await this.deps.privateUploader.put(key, png, 'image/png')
      return { kind: 'sync', exitus: { exitus: { image: privateMarker(key) }, impetus: 0n } }
    }

    const url = await this.deps.uploader.put(`composites/${actum.id}.png`, png, 'image/png')

    return { kind: 'sync', exitus: { exitus: { image: url }, impetus: 0n } }
  }
}

/** Read the `layers` aditus into an ordered URL list (array or single string). */
function readLayers(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((v) => String(v)).filter((s) => s.length > 0)
  if (typeof value === 'string' && value.length > 0) return [value]
  return []
}

/** Coerce an aditus dimension to a positive integer, or undefined. */
function asPositiveInt(value: unknown): number | undefined {
  if (value === undefined || value === null) return undefined
  const n = Number(value)
  return Number.isFinite(n) && n > 0 ? Math.round(n) : undefined
}
