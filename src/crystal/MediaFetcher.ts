// =============================================================================
// MediaFetcher — fetch a media URL into bytes (host-side cursors)
// =============================================================================
//
// Host-side deterministic cursors (layer-composite, ffmpeg) read their inputs
// from URLs (R2-hosted upstream outputs / trait layer files). This is the one
// I/O seam they share — injected so the cursors stay unit-testable with an
// in-memory fake (no network).

import { Readable } from 'node:stream'

/** A streamed fetch — the response body plus what the server told us about it. */
export interface MediaStream {
  body: Readable
  contentType?: string
  /** Bytes, when the server sent a Content-Length. */
  contentLength?: number
}

export interface MediaFetcher {
  /** Fetch a URL into a Buffer. Throws on a non-OK response. */
  fetch(url: string): Promise<Buffer>
  /**
   * Fetch a URL as a STREAM (never materializes the whole body in memory).
   * Optional — used for large payloads like model weights; callers fall back to
   * `fetch` when absent. Throws on a non-OK response.
   */
  fetchStream?(url: string): Promise<MediaStream>
}

/** The real fetcher — global fetch (Node 18+). Buffered + streaming. */
export const httpMediaFetcher: MediaFetcher = {
  async fetch(url: string): Promise<Buffer> {
    const res = await fetch(url)
    if (!res.ok) throw new Error(`media fetch failed: ${url} → ${res.status}`)
    return Buffer.from(await res.arrayBuffer())
  },
  async fetchStream(url: string): Promise<MediaStream> {
    const res = await fetch(url)
    if (!res.ok || !res.body) throw new Error(`media fetch failed: ${url} → ${res.status}`)
    const len = res.headers.get('content-length')
    return {
      body: Readable.fromWeb(res.body as Parameters<typeof Readable.fromWeb>[0]),
      ...(res.headers.get('content-type') ? { contentType: res.headers.get('content-type')! } : {}),
      ...(len ? { contentLength: Number(len) } : {}),
    }
  },
}
