import type { Progressus, PhaseDurations } from '../types/progressus.js'

// =============================================================================
// progressus (execution rail) — derive phase durations from a Progressus timeline
// =============================================================================
//
// A run accumulates a stream of Progressus reports on `Actum.progressus`. On
// completion we roll that timeline up into `Actum.phaseDurations` — the "how fast
// is each step" substrate (the unification target for `ActumExecutio`'s
// provisionMs/downloadMs/… telemetry). Durations come from transition TIMESTAMPS,
// never from per-tick progress (spec §7). Single source of truth for the roll-up,
// so every completion site derives it the same way — mirrors `projectExitus`.
// =============================================================================

/** The roll-up key for a report: `phase` alone, or `phase/target`. */
export function phaseKey(p: Pick<Progressus, 'phase' | 'target'>): string {
  return p.target ? `${p.phase}/${p.target}` : p.phase
}

/**
 * Roll a Progressus timeline up into per-`(phase, target)` durations (ms).
 *
 * Each report marks the start of its segment; the segment's duration runs until the
 * NEXT report's `at`. Consecutive reports sharing a key accumulate, so total
 * dwell-time in a phase is correct even across coalesced message/checkpoint entries.
 * The final report contributes no duration (it is terminal, or the run is still open).
 * Out-of-order timestamps are skipped rather than producing a negative duration.
 */
export function rollupPhaseDurations(timeline: readonly Progressus[]): PhaseDurations {
  const out: PhaseDurations = {}
  for (let i = 0; i < timeline.length - 1; i++) {
    const cur = timeline[i]
    const next = timeline[i + 1]
    const ms = next.at.getTime() - cur.at.getTime()
    if (ms < 0) continue
    const key = phaseKey(cur)
    out[key] = (out[key] ?? 0) + ms
  }
  return out
}
