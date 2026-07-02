// =============================================================================
// SexualContentRouter — the PUBLIC port for the host-side NSFW escalation signal
// =============================================================================
//
// A port, exactly like `ModerationGate` (ADR-0012 §49 / moderation-classifier.md
// §13: the model choice + this architecture are PUBLIC; the threshold, tuning, and
// impl are PRIVATE). The concrete `OnnxNsfwRouter` implementation — the model, the
// resident worker, the tunable high-recall threshold — lives in the gitignored
// private compliance module and is injected at deploy. This public file ships only
// the interface, so public orchestration (the publish cascade, `BatchTriage`) can
// depend on the shape without the detection internals.
//
// §0-A — THE RULE THIS PORT ENCODES: NSFW ≠ CSAM. A router is NOT a classifier. An
// NSFW model detects *sexual* content, which for adults is ALLOWED. Wiring a bare
// NSFW model into the `CsamClassifier` seam would turn every adult nude into
// `match:true` → auto-reject a legal image AND file a FALSE NCMEC report. So this is
// a DISTINCT interface: the router only answers "does this need the authoritative
// CSAM check / human review?" — it NEVER produces a CSAM verdict, NEVER files a
// report. The gate cascade enforces that separation.
// =============================================================================

/** A router decision for one media item. `sexual` is the escalation signal only. */
export interface SexualRouting {
  /** True ⇒ escalate to the authoritative CSAM check / human review. NOT a CSAM verdict. */
  sexual: boolean
  /** Provider NSFW score in [0,1], when available (the raw signal behind `sexual`). */
  confidence?: number
  /**
   * Best-effort face-based age hint. A severity BOOSTER for review, never a gate:
   * face-centric and unreliable on generated/no-face content. v1 always reports
   * 'unknown' (age classification is deferred to v2 — spec §3b, §12).
   */
  ageSignal?: 'minor' | 'adult' | 'unknown'
  /** Which model/pipeline produced this (for audit + the review record). */
  source: string
}

/**
 * The host-side open NSFW model as a HIGH-RECALL escalation router. Cheap, no
 * vendor, runs locally on content headed for review/publish. `route()` decides
 * whether an item is "sexual" (⇒ escalate) against a private, tunable threshold. A
 * miss is the one gap the design accepts — mitigated by (a) the authoritative
 * classifier being the real decision on escalated items and (b) periodic batch-triage
 * sampling of the passed population (spec §2). Deliberately NOT a `CsamClassifier`.
 */
export interface SexualContentRouter {
  route(item: { bytes: Buffer; url: string; contentType: string }): Promise<SexualRouting>
}
