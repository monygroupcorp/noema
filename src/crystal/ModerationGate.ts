// =============================================================================
// ModerationGate — the trust-boundary gate for public publishing
// =============================================================================
//
// Any Editio to a PUBLIC surface (visibility 'feed' | 'marketplace') MUST pass
// this gate, run ASYNCHRONOUSLY on publish-request, BEFORE going live:
//   pending → scan → published | rejected.
// Never a synchronous publish to a public surface. This is the compliance
// posture's trust-boundary CSAM/NCMEC scan expressed as the →public gate
// (docs/spec/publishing.md §8; memory project_compliance_posture).
//
// The interface is the seam; it is injected exactly like the deterministic runtime
// engines. This PUBLIC file ships only the PORT + two stubs. The REAL scanner —
// fetch → hash → known-CSAM match (exact + perceptual) → optional classifier →
// reject + NCMEC CyberTipline report — is the compliance abuse surface and is
// therefore PRIVATE (ADR-0012 §49 — not published): it lives in the gitignored
// `src/private/compliance` module and is injected at deploy. `src/index.ts` loads
// it via a guarded dynamic import and falls back to the fail-closed
// `denyModerationGate` when it is absent (a public build). The other stub,
// `permissiveModerationGate`, is the explicit dev/staging opt-in only.
// =============================================================================

import type { PublishArtifact } from './PublicationAdapter.js'

/**
 * A gate verdict:
 *   - `{ ok: true }`                       — pass; publish may proceed.
 *   - `{ ok: false, reason }`              — REJECT; content never goes live.
 *   - `{ ok: false, reason, hold: true }`  — HOLD for human review: do NOT publish,
 *                                            do NOT reject, do NOT report. An escalation
 *                                            signal (e.g. the pre-Thorn NSFW router)
 *                                            that a person must adjudicate (spec §4).
 *
 * `hold` is a REFUSAL to auto-publish (so `ok` is false), distinguished from a reject
 * so the settle path can route it to the review queue instead of terminal rejection.
 * A hold is NEVER a CSAM verdict and NEVER files a NCMEC report (§0-A).
 *
 * `billable` is set when the scan actually invoked the PAID classifier (Thorn) — the
 * settle forwards the per-scan fee only for billable scans (spec §7). Pre-Thorn, or on
 * a hash-only / router-cleared item, no paid call is made ⇒ not billable ⇒ no fee.
 */
export type ModerationVerdict =
  | { ok: true; billable?: boolean }
  | { ok: false; reason: string; hold?: boolean; billable?: boolean }

/** Scans an artifact bound for a public surface. */
export interface ModerationGate {
  scan(artifact: PublishArtifact): Promise<ModerationVerdict>
}

/**
 * PERMISSIVE gate — approves everything. This is the explicit DEV/STAGING opt-in
 * (`MODERATION_ALLOW_UNSCANNED=1`), NOT the default: the real gate is
 * `makeCsamModerationGate` (CsamModerationGate.ts), wired by the container whenever
 * detection is configured. Do NOT treat its `ok:true` as a real safety guarantee —
 * it is a structural no-op, flagged here on purpose; it must NEVER be active in
 * production. Preserves the async-gate architecture for local work without a scanner.
 *
 * PLACEHOLDER(publishing#1): permissive no-op, active only under MODERATION_ALLOW_UNSCANNED.
 * MUST NOT be active before the feed sees real public traffic. Ledger: docs/spec/publishing.md §10.
 */
export const permissiveModerationGate: ModerationGate = {
  async scan(): Promise<ModerationVerdict> {
    return { ok: true }
  },
}

/**
 * The SAFE default when no real scanner is configured: refuse every public publish.
 * A CSAM gate must fail CLOSED — an unconfigured scanner means "we can't vouch for
 * this content", which for a public surface means "it does not go live", never
 * "approve it anyway". This is what keeps unscanned content off the feed/marketplace
 * until the real scanner (+ NCMEC reporting) lands. Private/unlisted publishing is
 * unaffected (the gate only runs for public surfaces).
 *
 * Dev/staging can opt into the permissive gate explicitly via MODERATION_ALLOW_UNSCANNED=1
 * (wired in the container) — an informed, logged choice, never the silent default.
 */
export const denyModerationGate: ModerationGate = {
  async scan(): Promise<ModerationVerdict> {
    return { ok: false, reason: 'public publishing is unavailable — content moderation is not yet configured' }
  },
}

/**
 * INTERIM manual-review gate — HOLD every public publish for a human.
 *
 * The operator posture (2026-08-01) while the automated PRIVATE compliance module +
 * NCMEC ESP are stood up: open the public feed/marketplace via HUMAN review rather
 * than keep it fail-closed dark. Every public publish returns a HOLD verdict, so the
 * settle path routes it to the existing admin review queue (`listHeldEditions` →
 * `Review.tsx`, reveal-gated) where a reviewer explicitly approves / rejects /
 * confirms-CSAM. Nothing is ever auto-approved and nothing is ever auto-rejected.
 *
 * This is a DETECTION posture, NOT a detector: it inspects nothing, matches no hashset,
 * calls no classifier, and — critically — files NO NCMEC report on its own. A hold is
 * never a CSAM verdict (§0-A); the NCMEC report/preserve stays the reviewer's explicit
 * `confirmCsamAndReport` action. It is therefore NOT billable (no paid classifier ran).
 *
 * Selected ONLY under the explicit `MODERATION_MANUAL_REVIEW=1` opt-in (index.ts), and
 * ranks BELOW the real private gate but ABOVE permissive/deny. Default with no flag stays
 * the fail-closed `denyModerationGate`. Enabling it in production is the operator's
 * counsel-gated call — it opens public publishing and REQUIRES the review queue be
 * actively cleared; it does NOT replace the NCMEC ESP/report/preserve obligation.
 */
export const manualReviewGate: ModerationGate = {
  async scan(): Promise<ModerationVerdict> {
    return { ok: false, hold: true, reason: 'held for manual review' }
  },
}

/**
 * The →public gate SELECTION, as a pure function of what is configured — extracted from
 * `index.ts` so the fail-closed precedence is directly unit-testable (the container maps
 * the returned `mode` to its log line and injects `gate`). Precedence, all fail-closed:
 *
 *   1. the real PRIVATE gate            — present AND detection configured;
 *   2. else `manualReviewGate`          — MODERATION_MANUAL_REVIEW=1 (interim human review);
 *   3. else `permissiveModerationGate`  — MODERATION_ALLOW_UNSCANNED=1 (dev/staging only);
 *   4. else `denyModerationGate`        — the safe default (public publishing off).
 *
 * The default (no private gate, neither flag) is ALWAYS `deny` — never approve unscanned
 * content on a public surface.
 */
export type ModerationGateMode = 'private' | 'manual' | 'permissive' | 'deny'

export function selectModerationGate(opts: {
  privateGate: ModerationGate | null
  manualReview: boolean
  allowUnscanned: boolean
}): { gate: ModerationGate; mode: ModerationGateMode } {
  if (opts.privateGate) return { gate: opts.privateGate, mode: 'private' }
  if (opts.manualReview) return { gate: manualReviewGate, mode: 'manual' }
  if (opts.allowUnscanned) return { gate: permissiveModerationGate, mode: 'permissive' }
  return { gate: denyModerationGate, mode: 'deny' }
}
