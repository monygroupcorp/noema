// =============================================================================
// MediaFetcher — fetch a media URL into bytes (host-side cursors)
// =============================================================================
//
// Host-side deterministic cursors (layer-composite, ffmpeg) read their inputs
// from URLs (R2-hosted upstream outputs / trait layer files). This is the one
// I/O seam they share — injected so the cursors stay unit-testable with an
// in-memory fake (no network).

import { Readable } from 'node:stream'
import { createHash } from 'node:crypto'
import { getTrace } from '../lib/trace.js'
import { ownerKeyOf } from './ownerKey.js'
import type { AuctorKey } from '../flow/types.js'

// ── Private outputs: the marker scheme ───────────────────────────────────────
//
// A run whose owner asked for private outputs stores an opaque MARKER in
// `Actum.exitus` instead of a fetchable URL — the object lives in a dedicated
// bucket with no public binding, so no durable record carries a handle to it.
// The marker is resolved to a short-lived presigned GET only on an owner-scoped
// read, and to bytes here for the host's own read paths (moderation, triage,
// embeddings), which must keep working on private outputs.

/** The scheme every private-output marker carries. */
export const PRIVATE_MEDIA_SCHEME = 'noema-private://'

/** Whether a value is a private-output marker (rather than a fetchable URL). */
export function isPrivateMarker(value: unknown): value is string {
  return typeof value === 'string' && value.startsWith(PRIVATE_MEDIA_SCHEME)
}

/** The marker for an object key in the private-outputs bucket. */
export function privateMarker(key: string): string {
  return `${PRIVATE_MEDIA_SCHEME}${key}`
}

/** The object key a marker points at. Returns undefined for a non-marker. */
export function privateKeyOf(marker: string): string | undefined {
  return isPrivateMarker(marker) ? marker.slice(PRIVATE_MEDIA_SCHEME.length) : undefined
}

/**
 * The key PREFIX private outputs of one owner are written under —
 * `private-outputs/<sha256(ownerKey)[0:16]>/`. Owner-hashed (no raw id or bearer
 * secret in a path) and namespaced, exactly like `uploads/` and `exports/`.
 * Objects under it are named `<uuid>.<ext>` by the writer.
 */
export function privateOutputKeyPrefix(ownerKey: string): string {
  const scope = createHash('sha256').update(ownerKey).digest('hex').slice(0, 16)
  return `private-outputs/${scope}/`
}

/**
 * Every private-output marker a run's inputs carry, in encounter order.
 *
 * An aditus value is a media reference or a list of them; nothing nested deeper holds one, so
 * the scan is one level into arrays and no further. Duplicates are kept — the caller resolves
 * by key and puts the results back by value.
 */
export function privateMarkersIn(aditus: Record<string, unknown>): string[] {
  const found: string[] = []
  for (const value of Object.values(aditus)) {
    if (isPrivateMarker(value)) found.push(value)
    else if (Array.isArray(value)) for (const item of value) if (isPrivateMarker(item)) found.push(item)
  }
  return found
}

/**
 * The same inputs with every private-output marker replaced by what `resolved` maps it to.
 *
 * Shape is preserved exactly — a string stays a string, a list keeps its length and order — so
 * a flow's schema sees the inputs it declared. A marker missing from the map is left as-is;
 * every caller here resolves the full set from `privateMarkersIn` first, so that cannot silently
 * drop one.
 */
export function withResolvedPrivateMarkers(
  aditus: Record<string, unknown>,
  resolved: ReadonlyMap<string, string>,
): Record<string, unknown> {
  const swap = (v: unknown): unknown => (isPrivateMarker(v) ? resolved.get(v) ?? v : v)
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(aditus)) {
    out[key] = Array.isArray(value) ? value.map(swap) : swap(value)
  }
  return out
}

/**
 * The owner-scoped prefix a host-side writer must use for THIS actum's outputs, or undefined
 * when the run is public.
 *
 * A run is private if either is true:
 *   - it carries the dispatch stamp (`executio.privateOutputs`), or
 *   - one of its INPUTS is a private marker. A host-side cursor composites/encodes bytes it just
 *     read out of the private bucket; writing the result anywhere public would republish them.
 *     This direction only ever fails safe.
 *
 * The namespace is the caller's (`ownerKeyOf`, the same derivation the pod path uses — from the
 * actum's purse token or the ambient trace). When the run has no resolvable owner, a private
 * input's own namespace is reused: by construction that is where those bytes already live.
 */
export function privateWritePrefix(
  actum: { bursaToken?: string; executio?: { privateOutputs?: boolean } },
  inputUrls: readonly string[],
): string | undefined {
  const privateInput = inputUrls.find(isPrivateMarker)
  if (actum.executio?.privateOutputs !== true && privateInput === undefined) return undefined

  const trace = getTrace()
  const owner: AuctorKey | undefined =
    actum.bursaToken   ? { bursaToken: actum.bursaToken } :
    trace?.animaId     ? { animaId:    trace.animaId    } :
    trace?.commitment  ? { commitment: trace.commitment } :
    undefined
  if (owner) return privateOutputKeyPrefix(ownerKeyOf(owner))

  if (privateInput !== undefined) {
    const key = privateKeyOf(privateInput) ?? ''
    const cut = key.lastIndexOf('/')
    if (cut > 0) return key.slice(0, cut + 1)
  }
  return undefined
}

/**
 * Reads bytes for a private-output key. Registered once at startup when a
 * private-outputs bucket is configured; absent, a marker is unreadable and the
 * fetch throws rather than falling back to the network.
 */
export interface PrivateMediaResolver {
  fetch(key: string): Promise<Buffer>
  fetchStream?(key: string): Promise<MediaStream>
}

let privateResolver: PrivateMediaResolver | undefined

/** Install the private-output resolver (startup wiring). Idempotent. */
export function registerPrivateMediaResolver(resolver: PrivateMediaResolver | undefined): void {
  privateResolver = resolver
}

/** The installed resolver, if any — for callers that need to branch before fetching. */
export function privateMediaResolver(): PrivateMediaResolver | undefined {
  return privateResolver
}

function requireResolver(): PrivateMediaResolver {
  if (!privateResolver) {
    throw new Error(`private media unavailable: no private-outputs store is configured (${PRIVATE_MEDIA_SCHEME}…)`)
  }
  return privateResolver
}

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

/**
 * The real fetcher — global fetch (Node 18+). Buffered + streaming.
 *
 * A `noema-private://` marker is resolved through the registered private-output
 * resolver instead of the network, so every host-side read path that already
 * takes a MediaFetcher (moderation gate, batch triage, image embeddings) keeps
 * working on a private output with no change of its own.
 */
export const httpMediaFetcher: MediaFetcher = {
  async fetch(url: string): Promise<Buffer> {
    const privateKey = privateKeyOf(url)
    if (privateKey !== undefined) return requireResolver().fetch(privateKey)
    const res = await fetch(url)
    if (!res.ok) throw new Error(`media fetch failed: ${url} → ${res.status}`)
    return Buffer.from(await res.arrayBuffer())
  },
  async fetchStream(url: string): Promise<MediaStream> {
    const privateKey = privateKeyOf(url)
    if (privateKey !== undefined) {
      const resolver = requireResolver()
      if (resolver.fetchStream) return resolver.fetchStream(privateKey)
      const body = await resolver.fetch(privateKey)
      return { body: Readable.from(body), contentLength: body.byteLength }
    }
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
