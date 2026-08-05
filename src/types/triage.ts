// =============================================================================
// TRIAGE — the offline batch-moderation read (spec docs/spec/moderation-classifier.md §5)
// =============================================================================
//
// A measurement + prioritization store, DECOUPLED from the live publish path
// (Editio / ModerationGate). A batch job runs the SAME host-side NSFW router
// (`SexualContentRouter`) over the stored Actum corpus (the ~163k-gen dataset) and
// any backlog, and writes one `TriageScore` per media item here — NOT onto the
// Editio. It answers "how much flagged material exists, and where should human
// review look first?" — it NEVER publishes or reports (spec §5, §0-A).
//
// PUBLIC orchestration (like `PublicationWorker` / the `ModerationGate` port): this
// records the router's OUTPUT (a sexual bool + score). The DETECTION itself — the
// model, the thresholds, the tuning — stays in the private compliance module
// (ADR-0012 §49). The router is injected into the batch dispatcher.
//
// This is an INTERNAL safety-audit surface, not a user-facing one: triage results
// are ops data (access-controlled), never exposed on a public surface. Scanning our
// own stored corpus for abuse material is a trust-&-safety measure, distinct from
// the publish-boundary gate (which alone fires at the public trust boundary, §9).
// =============================================================================

/**
 * One media item's triage result — the router's escalation decision for a single
 * URL, recorded for measurement + review prioritization. `sexual` is the router's
 * high-recall ESCALATION signal, NOT a CSAM verdict (§0-A): a flagged item means
 * "a human should look", never "this is CSAM" and never a report.
 */
export interface TriageScore {
  /** Content-addressed id: the SHA-256 of the media url (stable, idempotent upsert key). */
  id: string
  /** The Actum this media belongs to (for review context + backlink). */
  actumId: string
  /** The media url that was scored. */
  url: string
  /** MIME type at scan time (image/*, video/*, …). */
  contentType: string
  /** The router's escalation signal: true ⇒ a human should review it. NOT a CSAM verdict. */
  sexual: boolean
  /** The router's NSFW score in [0,1], when available. */
  confidence?: number
  /** Best-effort age hint from the router (v1 always 'unknown'). Booster for review, never a gate. */
  ageSignal?: 'minor' | 'adult' | 'unknown'
  /** Which model/pipeline produced this (audit) — the router `source`. */
  source: string
  /** SHA-256 of the scored bytes, when computed (dedup + verdict-cache alignment). */
  sha256?: string
  /** When this item was scored (ISO-8601). */
  scannedAt: string
  /** Human-review disposition once a person has looked (mirrors the Editio review vocab). */
  reviewOutcome?: 'pending' | 'approved' | 'rejected'
}

/** Aggregate read of a triage run — "the read" (how much flagged, router flag-rate). */
export interface TriageStats {
  scanned: number
  flagged: number
  /** flagged / scanned (0 when nothing scanned). */
  flagRate: number
}

/**
 * The triage store — a durable, idempotent record of batch-scored media, SEPARATE
 * from the `Editionum` (the live publish store). Upsert is keyed by the content-
 * addressed `id` so a re-run of the same url overwrites, never duplicates.
 */
export interface TriageStore {
  /** Upsert one score (idempotent on `id`). */
  put(score: TriageScore): Promise<void>
  /** Fetch a prior score for a url (resumability: skip already-scored items). */
  getByUrl(url: string): Promise<TriageScore | null>
  /** All scores for one Actum (review context). */
  listByActum(actumId: string): Promise<TriageScore[]>
  /**
   * The review queue read: flagged items (`sexual:true`), highest-confidence first,
   * optionally only those not yet adjudicated (`reviewOutcome` unset/pending).
   */
  listFlagged(opts?: { limit?: number; pendingOnly?: boolean }): Promise<TriageScore[]>
  /** Aggregate counts over the whole store — "the read". */
  stats(): Promise<TriageStats>
}
