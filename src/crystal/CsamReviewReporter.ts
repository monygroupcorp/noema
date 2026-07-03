// =============================================================================
// CsamReviewReporter — the PUBLIC port for a REVIEWER-confirmed CSAM report
// =============================================================================
//
// The human-review path's report seam (spec §4; the Thorn-independent adjudicator).
// When a trained reviewer AFFIRMATIVELY confirms that a held publication is CSAM, that
// is "actual knowledge" (18 U.S.C. §2258A) → a NCMEC CyberTipline report is the legal
// duty. This port is how the public settle/adjudication layer triggers that report
// WITHOUT holding the private reporting internals.
//
// A port, like `ModerationGate` (ADR-0012 §49): the IMPLEMENTATION — evidence
// assembly, byte hashing, the deferred/live NCMEC transport, 90-day preservation — is
// PRIVATE (the compliance module) and injected at deploy. This public file ships only
// the interface. Absent (public build) → the confirm action still REJECTS the content
// but logs LOUDLY that no report was filed (never a silent miss).
//
// §0-A boundary preserved: this fires ONLY on an explicit HUMAN confirmation, never
// from a model/router. The router/NSFW models never reach this seam.
// =============================================================================

/** Everything the reviewer-confirm action knows about one confirmed-CSAM publication. */
export interface ReviewedCsamReport {
  /** The held publication the reviewer adjudicated. */
  editioId: string
  /** The canonical artifact confirmed as CSAM. */
  artifact: { kind: 'actum' | 'intella' | 'collectio'; id: string }
  /** Who put it forth — the same identity union the ledger/Editio uses. */
  uploader: { animaId: string } | { commitment: string } | undefined
  /** The media urls the reviewer confirmed (each becomes a piece of report evidence). */
  urls: string[]
  /** The reviewer's identity (the platform admin animaId) — for the audit trail. */
  reviewedBy: string
  /** ISO-8601 confirmation time. */
  confirmedAt: string
}

/**
 * Files a NCMEC CyberTipline report for reviewer-confirmed CSAM. Returns the assembled
 * report id(s) and whether they were LIVE-submitted (false until an ESP account +
 * live transport exist — the deferred reporter assembles + preserves but does not yet
 * submit). A failure MUST NOT un-reject the content (the content stays rejected).
 */
export interface CsamReviewReporter {
  reportConfirmed(r: ReviewedCsamReport): Promise<{ reportId: string; reportIds: string[]; submitted: boolean }>
}
