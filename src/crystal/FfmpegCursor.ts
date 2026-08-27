import type { Cursor, CursorResult } from '../types/cursus.js'
import type { Actum } from '../types/actum.js'
import type { Modus } from '../types/modus.js'
import type { FfmpegEngine, FramesToVideoOp } from './FfmpegEngine.js'
import type { MediaFetcher } from './MediaFetcher.js'
import { privateMarker, privateWritePrefix } from './MediaFetcher.js'
import type { Uploader } from './R2Uploader.js'
import { randomUUID } from 'node:crypto'

// =============================================================================
// FfmpegCursor — the host-side "ffmpeg" runtime
// =============================================================================
//
// A deterministic, host-side cursor (ministerium 'ffmpeg') — a sibling of the
// layer-composite cursor. Synchronous, no GPU pod. It exposes BOUNDED ffmpeg
// operations (never raw args); the canonical operation is frames→video, which
// assembles an ordered set of generated frames into an animation (the Collectio
// "animate" path).
//
// Inputs (aditus) for frames→video:
//   - `frames`: ordered frame image URLs (array, or a single URL). `text` Porta
//               so an array passes validateAditus intact.
//   - `fps` (optional, default 12): frames per second, clamped 1–60.
//   - `format` (optional, default 'mp4'): 'mp4' | 'webm'.
// Output (exitus): `{ video }`.
//
// Host-side deterministic work → reserve/charge 0n (the Cursor local convention).

const VIDEO_FORMATS = new Set<FramesToVideoOp['format']>(['mp4', 'webm'])

export class FfmpegCursor implements Cursor {
  constructor(
    private readonly deps: {
      engine: FfmpegEngine
      fetcher: MediaFetcher
      uploader: Uploader
      /** The private-outputs store (noema-347). Present only where the deployment configures a
       *  private bucket; absent, a private run cannot be encoded host-side and is refused rather
       *  than written to the public bucket. */
      privateUploader?: Uploader
    },
  ) {}

  async reserve(modus: Modus, _aditus: Record<string, unknown>): Promise<bigint> {
    return modus.impetusFixum ?? 0n
  }

  async run(actum: Actum): Promise<CursorResult> {
    const aditus = actum.aditus
    const urls = readUrls(aditus.frames)
    if (urls.length === 0) {
      throw new Error('ffmpeg frames-to-video: `frames` is required (ordered frame image URLs)')
    }

    const format = parseFormat(aditus.format)
    const fps = asFps(aditus.fps)

    const frames: Buffer[] = []
    for (const url of urls) frames.push(await this.deps.fetcher.fetch(url))

    const result = await this.deps.engine.run({ op: 'frames-to-video', frames, fps, format })

    // A private run — by its dispatch stamp, or because a frame we just read is private —
    // writes to the private store and yields a marker, never a URL.
    const prefix = privateWritePrefix(actum, urls)
    if (prefix) {
      if (!this.deps.privateUploader) {
        throw new Error('ffmpeg: this run is private but no private-outputs store is configured')
      }
      const key = `${prefix}${randomUUID()}.${result.ext}`
      await this.deps.privateUploader.put(key, result.bytes, result.contentType)
      return { kind: 'sync', exitus: { exitus: { video: privateMarker(key) }, impetus: 0n } }
    }

    const url = await this.deps.uploader.put(`videos/${actum.id}.${result.ext}`, result.bytes, result.contentType)

    return { kind: 'sync', exitus: { exitus: { video: url }, impetus: 0n } }
  }
}

/** Read an ordered URL list from an aditus value (array or single string). */
function readUrls(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((v) => String(v)).filter((s) => s.length > 0)
  if (typeof value === 'string' && value.length > 0) return [value]
  return []
}

function parseFormat(value: unknown): FramesToVideoOp['format'] {
  if (value === undefined || value === null) return 'mp4'
  const f = String(value).toLowerCase()
  if (!VIDEO_FORMATS.has(f as FramesToVideoOp['format'])) {
    throw new Error(`ffmpeg: unsupported format "${f}" (expected mp4 or webm)`)
  }
  return f as FramesToVideoOp['format']
}

function asFps(value: unknown): number {
  const n = Number(value)
  return Number.isFinite(n) && n > 0 ? n : 12
}
