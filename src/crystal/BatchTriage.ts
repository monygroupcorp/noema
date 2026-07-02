// =============================================================================
// BatchTriage — the offline batch-moderation dispatcher (spec §5)
// =============================================================================
//
// Runs the SAME host-side NSFW router (`SexualContentRouter`) over a batch of stored
// media — the ~163k-gen Actum corpus and any backlog — writing one `TriageScore` per
// item to the `TriageStore`. It is a MEASUREMENT + prioritization tool, wholly
// DECOUPLED from the live publish path: it never touches an `Editio`, never publishes,
// and never reports (spec §5, §0-A). "The read" = how much flagged material exists +
// the router's flag-rate on real content.
//
// RUNTIME-AGNOSTIC: the router is injected. Today that is the host-side
// `OnnxNsfwRouter` (in-process CPU worker — small model, ~tens of ms/image, ample for
// a one-time corpus sweep). A GPU-batch pod modus (spec §5) is the scale-out: build a
// pod-backed `SexualContentRouter` and inject it here — this dispatcher does not change.
//
// RESUMABLE + IDEMPOTENT: a url already in the store is skipped (unless `force`), so a
// long sweep can stop and restart; the content-addressed id makes re-scoring an upsert.
// PUBLIC orchestration (ADR-0012 §49) — the detection/threshold lives in the private
// router; this only sequences fetch → route → record.
// =============================================================================

import { createHash } from 'node:crypto'
import type { MediaFetcher } from './MediaFetcher.js'
import type { TriageScore, TriageStore } from '../types/triage.js'
import type { SexualContentRouter } from './SexualContentRouter.js'
import type { Actorum } from '../types/cursus.js'
import { allMediaUrls, mediaTypeFor } from './BucketAdapter.js'
import { makeLogger } from '../lib/logger.js'

const log = makeLogger('triage:batch')

/** One media item to triage — an Actum's produced media url. */
export interface TriageItem {
  actumId: string
  url: string
  /** MIME type; derived from the url extension when omitted. */
  contentType?: string
}

/** The outcome of a batch run — "the read". */
export interface BatchTriageSummary {
  /** Items freshly scored this run. */
  scanned: number
  /** Of the scored items, how many the router flagged sexual. */
  flagged: number
  /** Items skipped because a prior score exists (resumability). */
  skipped: number
  /** Items that could not be fetched/scored (counted, not recorded). */
  errors: number
  /** flagged / scanned this run (0 when nothing scanned). */
  flagRate: number
}

export interface BatchTriageDeps {
  fetcher: MediaFetcher
  router: SexualContentRouter
  store: TriageStore
  /** Needed by `runActa` to resolve an Actum id → its produced media urls. */
  actorum?: Pick<Actorum, 'findById'>
  /** Injectable clock for deterministic `scannedAt` in tests. */
  now?: () => Date
}

export class BatchTriage {
  private readonly now: () => Date
  constructor(private readonly deps: BatchTriageDeps) {
    this.now = deps.now ?? (() => new Date())
  }

  /** Content-addressed triage id — the SHA-256 of the media url (stable upsert key). */
  private idFor(url: string): string {
    return createHash('sha256').update(url).digest('hex')
  }

  /** Score an explicit list of media items. Resumable (skips already-scored urls). */
  async runItems(items: TriageItem[], opts?: { force?: boolean }): Promise<BatchTriageSummary> {
    let scanned = 0, flagged = 0, skipped = 0, errors = 0

    for (const item of items) {
      // Resumability: don't re-fetch/re-score a url we already have (unless forced).
      if (!opts?.force) {
        const existing = await this.deps.store.getByUrl(item.url)
        if (existing) { skipped++; continue }
      }

      const contentType = item.contentType ?? mediaTypeFor(item.url).contentType
      let bytes: Buffer
      try {
        bytes = await this.deps.fetcher.fetch(item.url)
      } catch (err) {
        // A measurement tool tolerates gaps: a missing/broken url is counted, not fatal.
        log.warn('triage: media fetch failed — skipping (counted as error)', { url: item.url, error: err instanceof Error ? err.message : String(err) })
        errors++
        continue
      }

      let routing
      try {
        routing = await this.deps.router.route({ bytes, url: item.url, contentType })
      } catch (err) {
        log.warn('triage: router failed — skipping (counted as error)', { url: item.url, error: err instanceof Error ? err.message : String(err) })
        errors++
        continue
      }

      const score: TriageScore = {
        id: this.idFor(item.url),
        actumId: item.actumId,
        url: item.url,
        contentType,
        sexual: routing.sexual,
        ...(routing.confidence !== undefined ? { confidence: routing.confidence } : {}),
        ...(routing.ageSignal !== undefined ? { ageSignal: routing.ageSignal } : {}),
        source: routing.source,
        sha256: createHash('sha256').update(bytes).digest('hex'),
        scannedAt: this.now().toISOString(),
      }
      await this.deps.store.put(score)
      scanned++
      if (routing.sexual) flagged++
    }

    return { scanned, flagged, skipped, errors, flagRate: scanned === 0 ? 0 : flagged / scanned }
  }

  /** Score every produced-media url of the given Acta (enumerated via `allMediaUrls`). */
  async runActa(actumIds: string[], opts?: { force?: boolean }): Promise<BatchTriageSummary> {
    if (!this.deps.actorum) throw new Error('BatchTriage.runActa requires an actorum to resolve Acta media')
    const items: TriageItem[] = []
    for (const actumId of actumIds) {
      const actum = await this.deps.actorum.findById(actumId)
      if (!actum) { log.warn('triage: actum not found — skipping', { actumId }); continue }
      for (const url of allMediaUrls(actum.exitus)) items.push({ actumId, url })
    }
    return this.runItems(items, opts)
  }
}
