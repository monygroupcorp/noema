// =============================================================================
// VerdictCache — content-addressed moderation-verdict reuse (spec §7)
// =============================================================================
//
// Publishing a PUBLIC surface runs the moderation gate, which (post-Thorn) makes a
// PAID per-scan classifier call. Re-publishing the IDENTICAL content — the same
// artifact to a second surface, or a re-publish of the same bytes — should not pay
// (or wait) to re-decide what we already know. This small store caches a gate verdict
// keyed by a content-address of the scanned media, so an identical re-publish REUSES
// the verdict: no re-scan, no re-charge (spec §7).
//
// The content key is the SHA-256 of the artifact's sorted media urls — stable for the
// same artifact (its R2 keys are content-addressed upstream) and cheap to compute
// WITHOUT re-fetching bytes, so the cache check happens before the gate runs. (Byte-
// level dedup across DIFFERENT urls carrying identical bytes is a refinement — the
// gate already computes per-media SHA-256s internally; surfacing them for a byte-keyed
// cache is a later step. The dominant case — the same artifact re-published — is a url
// match today.) A key is null when the artifact has no media (nothing scanned/billed).
// =============================================================================

import { createHash } from 'node:crypto'
import type { ModerationVerdict } from './ModerationGate.js'
import { allMediaUrls } from './BucketAdapter.js'

/** A durable, reusable gate verdict for one content-addressed key. */
export interface CachedVerdict {
  /** The content key (see `contentKey`). */
  key: string
  /** The gate outcome. */
  ok: boolean
  /** Refusal reason (when !ok). */
  reason?: string
  /** True when the refusal was a HOLD-for-review (not a terminal reject). */
  hold?: boolean
  /** When the underlying scan ran (ISO-8601). */
  scannedAt: string
}

/** A content-addressed store of prior gate verdicts. */
export interface VerdictCache {
  get(key: string): Promise<CachedVerdict | null>
  put(v: CachedVerdict): Promise<void>
}

/**
 * The content key for an artifact's scanned media — the SHA-256 of its sorted media
 * urls. Null when the artifact carries no media (nothing to scan / bill / cache).
 */
export function contentKey(output?: Record<string, unknown>): string | null {
  const urls = allMediaUrls(output).slice().sort()
  if (urls.length === 0) return null
  return createHash('sha256').update(urls.join('\n')).digest('hex')
}

/** Project a live gate verdict onto its cacheable shape. */
export function toCachedVerdict(key: string, v: ModerationVerdict, scannedAt: string): CachedVerdict {
  return {
    key,
    ok: v.ok,
    ...(v.ok === false && v.reason !== undefined ? { reason: v.reason } : {}),
    ...(v.ok === false && v.hold ? { hold: true } : {}),
    scannedAt,
  }
}

/** Reconstruct a gate verdict from a cached one (never `billable` — no scan ran). */
export function fromCachedVerdict(c: CachedVerdict): ModerationVerdict {
  if (c.ok) return { ok: true }
  return { ok: false, reason: c.reason ?? 'previously refused by the safety scan', ...(c.hold ? { hold: true } : {}) }
}
