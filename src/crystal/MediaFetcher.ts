// =============================================================================
// MediaFetcher — fetch a media URL into bytes (host-side cursors)
// =============================================================================
//
// Host-side deterministic cursors (layer-composite, ffmpeg) read their inputs
// from URLs (R2-hosted upstream outputs / trait layer files). This is the one
// I/O seam they share — injected so the cursors stay unit-testable with an
// in-memory fake (no network).

export interface MediaFetcher {
  /** Fetch a URL into a Buffer. Throws on a non-OK response. */
  fetch(url: string): Promise<Buffer>
}

/** The real fetcher — global fetch (Node 18+) → Buffer. */
export const httpMediaFetcher: MediaFetcher = {
  async fetch(url: string): Promise<Buffer> {
    const res = await fetch(url)
    if (!res.ok) throw new Error(`media fetch failed: ${url} → ${res.status}`)
    return Buffer.from(await res.arrayBuffer())
  },
}
