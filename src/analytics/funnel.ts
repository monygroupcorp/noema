// =============================================================================
// funnel — pure drop-off math over a fixed, ordered stage list. Answers "where
// do visitors stop" from counts alone: no database access here, so this is
// hermetically testable and the one place the ordering/percentage logic lives
// (the Mongo aggregation in BehaviourEventStore and the Actorum counts in
// cursus.ts just supply the raw per-stage numbers).
// =============================================================================

export interface FunnelStage {
  stage:        string
  visitors:     number
  /** visitors at this stage ÷ visitors at the first stage, 0–1. */
  ofStart:      number
  /** visitors at this stage ÷ visitors at the PREVIOUS stage, 0–1. 1 for the first stage. */
  ofPrevious:   number
  /** visitors lost between the previous stage and this one. 0 for the first stage. */
  droppedHere:  number
}

/**
 * `counts` must already be keyed by the stage names in `order`, in no particular
 * key order — `order` is what fixes the funnel's sequence. A stage absent from
 * `counts` reads as 0 (nobody reached it), not an error — a fresh window with no
 * funding attempts yet is a true funnel, not a malformed one.
 */
export function computeFunnel(order: readonly string[], counts: Record<string, number>): FunnelStage[] {
  const start = counts[order[0]] ?? 0
  let previous = start
  return order.map((stage, i) => {
    const visitors = counts[stage] ?? 0
    const stageResult: FunnelStage = {
      stage,
      visitors,
      ofStart:     start === 0 ? 0 : visitors / start,
      ofPrevious:  i === 0 ? 1 : (previous === 0 ? 0 : visitors / previous),
      droppedHere: i === 0 ? 0 : Math.max(0, previous - visitors),
    }
    previous = visitors
    return stageResult
  })
}

/** The canonical visitor journey this corpus can currently see end to end. */
export const DEFAULT_FUNNEL_ORDER = [
  'catalog_view',
  'quote',
  'sign_in',
  'funding_attempt',
  'run_attempt',
  'run_complete',
] as const
