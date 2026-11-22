// =============================================================================
// Status — the user's app HUD (complementary surface to the bulletin)
// =============================================================================
// The bulletin owns one studio's posture. /status owns the user's state across
// the whole app: balance, their queued/running gens, their studios, joinable
// studios. Cancellation lives HERE (per-row), not on the bulletin — gens are
// per-gen, not per-studio.
//
// Types are platform-neutral: same DTOs the API will emit when /api/v1/me/status
// lands. Telegram is one renderer; web/Discord will be others.

import type { AuctorKey } from '../../../flow/types.js'

/**
 * Top-level aggregate the StatusView renders. Everything the user-HUD needs in
 * one fetch. The aggregator builds this from stores at request time (no
 * persistent registry; /status is a snapshot, not a session).
 */
export interface StatusSnapshot {
  /** The user this snapshot is FOR — identified or anonymous. Used by the
   *  view for "no balance / not signed in" branches. */
  auctorKey: AuctorKey | null

  /** Current spendable balance in impetus points (= signorum.balance). Excludes anything
   *  currently LOCKED against the user's own in-flight runs — see `heldImpetus` for that. */
  balanceImpetus: bigint

  /** USD equivalent of `balanceImpetus`, derived for display. */
  balanceUsd: number

  /**
   * Impetus currently held (locked) against the user's own in-flight runs — the sum of
   * `gens[].heldImpetus`. Derived, not stored (same convention as `balanceImpetus` itself):
   * a reservation is a HOLD, not a charge, and this is what tells the user that — without it
   * a run's lock just reads as a chunk of `balanceImpetus` that silently vanished (noema
   * reservation-reads-as-credits-gone). 0n when nothing is held.
   */
  heldImpetus: bigint

  /** USD equivalent of `heldImpetus`, derived for display. */
  heldUsd: number

  /**
   * The user's single most-recently-terminated run — whichever of a charge (settled) or a
   * release (failed/cancelled) happened last — so the SAME screen that shows a hold also shows
   * what became of it once it clears. Absent when the index isn't wired or the user has no
   * terminal history yet. v1: one row, not a feed — `GET /v1/me/activity` is the full history.
   */
  recentSettlement?: RecentSettlement

  /** Active gens (queued + running) the user is currently in. */
  gens: GenEntry[]

  /** Studios the user is the HOST of (Hospitium.hostKey matches the user). */
  studios: StudioEntry[]

  /** Studios the user could join — warm + open-to-them. May be empty in v1
   *  while the admission criteria are being designed; the UI hides the
   *  section when empty. */
  joinable: JoinableEntry[]

  /** Server-side timestamp the snapshot was taken — useful for staleness
   *  indication and SSE freshness on later platforms. */
  takenAt: Date
}

/** The user's most-recently-terminated run — a charge (settled) or a release (fractus). */
export interface RecentSettlement {
  actumId: string
  modusLabel: string
  kind: 'charge' | 'release'
  /** Impetus charged. 0n for a release (nothing charged — the hold was simply released). */
  impetus: bigint
  /** USD equivalent of `impetus`. */
  usd: number
  at: Date
}

/** One row under YOUR GENS. */
export interface GenEntry {
  actumId: string
  /** Human-readable modus name ("Flux Schnell", "ChatGPT"…). */
  modusLabel: string
  /**
   * Impetus locked against THIS run (`Actum.impetus` while nascens/agens — the upper-bound
   * reservation, not yet the settled cost). This is exactly the amount `balanceImpetus` looks
   * short by right now; it reappears as spendable (minus the real cost) once the run settles.
   */
  heldImpetus: bigint
  /** Where it's running — null if cold-pending. */
  studio: { id: string; hostLabel: string; isOwn: boolean } | null
  /** Lifecycle: nascens=queued, agens=running. */
  status: 'nascens' | 'agens'
  /** Wall-clock since dispatch — only meaningful for `agens`. */
  elapsedMs?: number
  /** Rough ETA for queued gens (estimated from queue depth + typical exec). */
  etaMs?: number
  /**
   * Where a gen WAITING FOR A WARM POD stands in line: 1-based place, and how many runs
   * are waiting on the same substrate image. Present only while the run is actually
   * queued — a `nascens` gen that is cold-starting its own pod is not in a line and
   * carries nothing here, which is the distinction the row needs to draw.
   */
  queue?: { place: number; depth: number }
}

/** One row under YOUR STUDIOS. */
export interface StudioEntry {
  /** The canonical studio handle — the bound Modo id (ADR-0006), what run-targeting
   *  uses; falls back to the Materia id when no session store is wired. */
  studioId: string
  /** The underlying pod (Materia) id — the key for per-studio earnings/guest joins. */
  materiaId: string
  /** Human-readable label: "flux-v1 on H100" or similar. */
  label: string
  /** Status: idle (warm), running (gen in flight), provisioning, terminated. */
  status: 'idle' | 'running' | 'provisioning' | 'terminated' | 'draining'
  /** Time remaining on the warm window before idle-reap, when applicable. */
  warmRemainingMs?: number
  /** Lifetime guest gens served by this studio (from earnings signa count). */
  guestsToday: number
  /** Net impetus earned on this studio (hostCut + hospitium − cost accrued). */
  netImpetus: bigint
  /** USD equivalent of `netImpetus` for display. */
  netUsd: number
}

/** One row under JOINABLE. */
export interface JoinableEntry {
  studioId: string
  label: string
  hostLabel: string
  /** Queue depth — informational; not blocking. */
  queueDepth: number
}
