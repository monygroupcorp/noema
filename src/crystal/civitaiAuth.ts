// =============================================================================
// civitaiAuth — attach our system Civitai API token to a Civitai-origin fetch
// =============================================================================
//
// Civitai's download endpoints now require authentication even for ordinary
// public LoRAs (rth, 2026-11-13 boardroom: a plain anonymous GET against
// `/api/download/models/:id` 401s). This wraps a `MediaFetcher` so a request to
// civitai.com (and no other host) carries `Authorization: Bearer
// $CIVITAI_API_TOKEN` — a redirect off civitai.com (civitai's download endpoint
// 302s to a time-limited CDN/S3 href) drops the header before the next hop, so
// our token is never handed to a third party. The token itself never appears in
// a URL or an error message — only this one header, attached only while the
// current hop's host is civitai.com.
//
// Two distinct refusals are reported as one typed `CivitaiDownloadError` with a
// `status`, so a caller can tell an operator what actually happened instead of
// a bare HTTP code: no token was configured at all, vs. civitai rejected the one
// we sent (an expired/revoked key). Both read identically on the wire (401/403)
// but mean different fixes.
// =============================================================================

import { Readable } from 'node:stream'
import type { MediaFetcher, MediaStream } from './MediaFetcher.js'

export const CIVITAI_HOST = 'civitai.com'

/** True when `url`'s host IS civitai.com or a subdomain of it. */
export function isCivitaiUrl(url: string): boolean {
  let hostname: string
  try {
    hostname = new URL(url).hostname.toLowerCase()
  } catch {
    return false
  }
  return hostname === CIVITAI_HOST || hostname.endsWith(`.${CIVITAI_HOST}`)
}

/** Civitai refused the download — no token was attached, or civitai rejected the one we sent.
 *  Never carries the token; `message` is safe to log. */
export class CivitaiDownloadError extends Error {
  readonly status: number
  constructor(message: string, status: number) {
    super(message)
    this.name = 'CivitaiDownloadError'
    this.status = status
  }
}

/** A URL with its query/fragment stripped — safe to log even if a mirror's own
 *  (never ours) query string happens to carry a credential-shaped parameter. */
function withoutQuery(url: string): string {
  return url.split('?')[0].split('#')[0]
}

const MAX_REDIRECTS = 5

/** Follow redirects by hand, attaching our Bearer token only while the CURRENT hop's host is
 *  civitai.com — the header is dropped the moment a redirect leaves that host. */
async function followWithAuth(
  url: string,
  token: string | undefined,
  extraHeaders: Record<string, string> | undefined,
  fetchFn: typeof fetch,
): Promise<Response> {
  let current = url
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const headers: Record<string, string> = { ...extraHeaders }
    if (token && isCivitaiUrl(current)) headers.Authorization = `Bearer ${token}`
    const res = await fetchFn(current, { headers, redirect: 'manual' })
    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get('location')
      if (!location) throw new Error(`civitai redirect (HTTP ${res.status}) with no Location header: ${withoutQuery(current)}`)
      await res.body?.cancel().catch(() => {})
      current = new URL(location, current).toString()
      continue
    }
    if (isCivitaiUrl(current) && (res.status === 401 || res.status === 403)) {
      await res.body?.cancel().catch(() => {})
      throw new CivitaiDownloadError(
        token
          ? `civitai rejected our download token (HTTP ${res.status}) for ${withoutQuery(current)}`
          : `civitai requires authentication to download ${withoutQuery(current)} (HTTP ${res.status}) and no CIVITAI_API_TOKEN is configured`,
        res.status,
      )
    }
    return res
  }
  throw new Error(`civitai: too many redirects fetching ${withoutQuery(url)}`)
}

/**
 * Wrap a base `MediaFetcher` so a civitai.com URL carries our system Bearer token; every other
 * host passes through to `base` unchanged. `fetchFn` is injectable (defaults to global `fetch`)
 * so the redirect/auth/error behavior is unit-testable with no network.
 */
export function civitaiAwareFetcher(base: MediaFetcher, token: string | undefined, fetchFn: typeof fetch = fetch): MediaFetcher {
  async function fetchCivitaiStream(url: string): Promise<MediaStream> {
    const res = await followWithAuth(url, token, undefined, fetchFn)
    if (!res.ok || !res.body) throw new Error(`civitai fetch failed: ${withoutQuery(url)} → ${res.status}`)
    const len = res.headers.get('content-length')
    return {
      body: Readable.fromWeb(res.body as Parameters<typeof Readable.fromWeb>[0]),
      ...(res.headers.get('content-type') ? { contentType: res.headers.get('content-type')! } : {}),
      ...(len ? { contentLength: Number(len) } : {}),
    }
  }

  return {
    async fetch(url: string): Promise<Buffer> {
      if (!isCivitaiUrl(url)) return base.fetch(url)
      const res = await followWithAuth(url, token, undefined, fetchFn)
      if (!res.ok) throw new Error(`civitai fetch failed: ${withoutQuery(url)} → ${res.status}`)
      return Buffer.from(await res.arrayBuffer())
    },
    // Present only when `base` itself supports streaming — a caller that branches on
    // `fetcher.fetchStream`'s truthiness (BucketAdapter's buffered-vs-streamed choice) must
    // see the SAME capability it would see on `base`, civitai-aware or not.
    ...(base.fetchStream
      ? { fetchStream: (url: string) => (isCivitaiUrl(url) ? fetchCivitaiStream(url) : base.fetchStream!(url)) }
      : {}),
  }
}
