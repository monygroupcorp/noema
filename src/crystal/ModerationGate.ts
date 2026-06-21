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
// The interface is the seam; it is injected exactly like the deterministic
// runtime engines (real impl + fake for tests). The REAL scanner (CSAM/NCMEC
// classification + reporting) is specced, NOT built — so the spine ships against
// the interface and the real implementation drops in behind it later without a
// spine change.
// =============================================================================

import type { PublishArtifact } from './PublicationAdapter.js'

/** A gate verdict: pass, or refuse with a reason. */
export type ModerationVerdict = { ok: true } | { ok: false; reason: string }

/** Scans an artifact bound for a public surface. */
export interface ModerationGate {
  scan(artifact: PublishArtifact): Promise<ModerationVerdict>
}

/**
 * PLACEHOLDER gate — approves everything. The real CSAM/NCMEC scanner is unbuilt
 * (compliance posture); this preserves the async-gate ARCHITECTURE (the pending
 * → scan → published path always runs) while the scanner that decides verdicts
 * lands later. Wired by the container until then. Do NOT treat its `ok:true` as
 * a real safety guarantee — it is a structural no-op, flagged here on purpose.
 *
 * PLACEHOLDER(publishing#1): inert stand-in for the real CSAM/NCMEC scanner+reporter.
 * MUST be replaced before the feed sees real public traffic. Ledger: docs/spec/publishing.md §10.
 */
export const permissiveModerationGate: ModerationGate = {
  async scan(): Promise<ModerationVerdict> {
    return { ok: true }
  },
}
