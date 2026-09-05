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

  /** Current spendable balance in impetus points (= signorum.balance). */
  balanceImpetus: bigint

  /** USD equivalent of `balanceImpetus`, derived for display. */
  balanceUsd: number

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

/** One row under YOUR GENS. */
export interface GenEntry {
  actumId: string
  /** Human-readable modus name ("Flux Schnell", "ChatGPT"…). */
  modusLabel: string
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
