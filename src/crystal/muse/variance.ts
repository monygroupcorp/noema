// =============================================================================
// muse/variance — the knife's edge: how much room the cutting floor has left
// =============================================================================
//
// An INSTRUMENT READING, not a warning. Both outcomes are legitimate and nothing
// here blocks anything: a user who has narrowed the floor deliberately is close
// to what they came for and wants to stay narrow, and a user who has run the
// floor dry wants to open it back up. The readout's only job is to say which
// situation they are in, with the numbers attached so a surface can phrase it.
//
// That framing is what makes the measurement hard. Steering exists IN ORDER TO
// narrow the floor, so a naive "the floor got smaller" threshold congratulates
// the user by alarming at them. Two signals are needed, and they answer two
// different questions:
//
//   AIMED       the live floor is a fraction of the width the session started
//               with. The user cut it there on purpose. Useful, not alarming.
//   EXHAUSTED   recent rolls keep landing on combinations already seen. This is
//               the one the user actually FEELS — combinatorial headroom on its
//               own does not predict it, because a wide floor whose live pools
//               are lopsided repeats itself long before it runs out.
//
// COMBINATORIC, NOT PERCEPTUAL. Everything here is counted from state already in
// hand: fragment pools and the recent rolls. No model call, no fetch, no key, no
// spend — which is what lets the readout fire on every piece rather than being
// rationed. A perceptual measure (are these pictures actually looking alike) is
// more accurate in one real case — a floor with combinations left that is
// nonetheless producing near-identical images — and it is metered and slower
// than the stream. That case is the known cost of counting instead of looking.
//
// Pure and deterministic: same floor and same rolls, same readout.

import {
  CATEGORIES,
  isLive,
  type Category,
  type Fragment,
  type Garden,
} from './taxonomy.js'

// --- What the readout says ---------------------------------------------------

/** Why the floor reads as narrow. Both may hold at once. */
export type NarrowingReason =
  /** The live floor is a fraction of the width the session started with. */
  | 'aimed'
  /** Recent rolls keep repeating combinations already seen in the window. */
  | 'exhausted'

/** One category's live width against its starting width. */
export type CategoryWidth = {
  category: Category
  /** Fragments currently live in this category. */
  live: number
  /** Fragments this category held at the session's starting width. */
  start: number
}

export type VarianceReadout = {
  /** True when at least one reason holds. Information, never a gate. */
  narrowed: boolean
  /** Which of the two situations this is, so a surface can say which. */
  reasons: NarrowingReason[]

  /** Distinct combinations the live floor can still produce. */
  liveCombinations: number
  /** Distinct combinations the floor could produce at its starting width. */
  startCombinations: number
  /** `liveCombinations / startCombinations`, clamped to 0..1. 1 means untouched. */
  headroom: number

  /** Live fragments across every category. */
  liveFragments: number
  /** Fragments at the session's starting width, across every category. */
  startFragments: number

  /** How many of the supplied rolls the repetition window actually looked at. */
  rollsConsidered: number
  /** Distinct combinations among those rolls. */
  distinctCombinations: number
  /** `1 - distinct/considered`, 0..1. 0 means every roll was new. */
  repetition: number

  /** Per-category live and starting widths, in `CATEGORIES` order. */
  widths: CategoryWidth[]
}

// --- Calibration -------------------------------------------------------------

export type VarianceThresholds = {
  /** How many of the most recent rolls the repetition measure looks at. */
  window: number
  /**
   * Rolls required before repetition is reported at all. Below this the sample
   * is too small to distinguish a repeating floor from an unlucky pair.
   */
  minRolls: number
  /** Headroom at or below which the floor reads as `aimed`. */
  headroom: number
  /** Repetition at or above which the floor reads as `exhausted`. */
  repetition: number
}

/**
 * v1 calibration. Deliberately parameters and not constants: the readout is
 * information rather than a gate, so these can be retuned against a real stream
 * without changing what any of the numbers mean.
 */
export const DEFAULT_VARIANCE_THRESHOLDS: VarianceThresholds = {
  window: 12,
  minRolls: 6,
  headroom: 0.25,
  repetition: 0.5,
}

export type VarianceOptions = Partial<VarianceThresholds> & {
  /**
   * The floor as it stood at the session's start, when the caller holds a
   * snapshot of it.
   *
   * Absent, the baseline is the SAME floor counted with every fragment live —
   * which is the session's starting width exactly as long as the session has
   * only ever disabled fragments, because disable never removes anything. A
   * session that also ADDS fragments to its floor should pass its snapshot, or
   * the additions widen the baseline along with the live width.
   */
  sessionStart?: Garden
}

// --- Counting ----------------------------------------------------------------

/**
 * The canonical key for a rolled combination.
 *
 * Category and text together, because the same phrase under two categories is
 * two different fragments, and order-independent, because a roll is a set of
 * slots rather than a sequence.
 */
export function combinationKey(fragments: readonly Fragment[]): string {
  return fragments
    .map((f) => `${f.category}=${f.text.trim().toLowerCase()}`)
    .sort()
    .join('|')
}

/** Live fragment count per category, in `CATEGORIES` order. */
function liveCounts(garden: Garden, countDisabled: boolean): number[] {
  return CATEGORIES.map((category) => {
    const pool = garden[category]
    if (!pool) return 0
    return countDisabled ? pool.length : pool.filter(isLive).length
  })
}

/**
 * Distinct combinations a set of per-category pool sizes can produce.
 *
 * Empty categories drop out of the product rather than zeroing it: a category
 * with no fragments contributes no slot to the prompt, which is how the sampler
 * already behaves. A floor with no fragments at all produces nothing, so it
 * counts 0 rather than the empty product's 1.
 */
function combinations(counts: readonly number[]): number {
  const present = counts.filter((n) => n > 0)
  if (present.length === 0) return 0
  return present.reduce((product, n) => product * n, 1)
}

/** Sum of natural logs, so the ratio of two very wide floors stays finite. */
function logWidth(counts: readonly number[]): number {
  let sum = 0
  for (const n of counts) if (n > 0) sum += Math.log(n)
  return sum
}

// --- The readout -------------------------------------------------------------

/**
 * Read how much variance the cutting floor has left.
 *
 * @param floor        the session's cutting floor, live and disabled fragments alike
 * @param recentRolls  rolls in the order they were produced; the most recent
 *                     `window` of them are what repetition is measured over
 */
export function readVariance(
  floor: Garden,
  recentRolls: readonly (readonly Fragment[])[] = [],
  options: VarianceOptions = {},
): VarianceReadout {
  const thresholds: VarianceThresholds = { ...DEFAULT_VARIANCE_THRESHOLDS, ...options }
  const window = Math.max(1, Math.trunc(thresholds.window))

  const live = liveCounts(floor, false)
  // The baseline: the caller's snapshot when it has one, otherwise this same
  // floor with the disabled fragments counted back in. Disable is reversible and
  // removes nothing, so the floor still carries its own starting width.
  const start = liveCounts(options.sessionStart ?? floor, true)

  const liveCombinations = combinations(live)
  const startCombinations = combinations(start)

  // The sparse-floor guard, and the reason this measures a RATIO at all.
  // Real decomposes produce thin categories as a matter of course — a first
  // moodboard can leave a category holding two fragments — so an absolute width
  // threshold would report "narrowed" to every user on their first roll, before
  // they had steered anything. The signal is CHANGE against the session's own
  // starting point: a floor that was always thin has a headroom of 1 and says
  // nothing, and the same floor says something the moment a steer cuts into it.
  const headroom =
    startCombinations === 0
      ? 1
      : liveCombinations === 0
        ? 0
        : Math.min(1, Math.exp(logWidth(live) - logWidth(start)))

  // Repetition over the most recent `window` rolls. This is the half of the
  // reading that combinatorial headroom cannot supply: a floor with room left
  // still repeats itself when its live pools are lopsided, and repetition is
  // what the user actually sees arriving in the stream.
  const considered = recentRolls.slice(-window)
  const distinct = new Set(considered.map(combinationKey)).size
  const repetition = considered.length === 0 ? 0 : 1 - distinct / considered.length

  const reasons: NarrowingReason[] = []
  if (startCombinations > 0 && headroom <= thresholds.headroom) reasons.push('aimed')
  if (considered.length >= thresholds.minRolls && repetition >= thresholds.repetition) {
    reasons.push('exhausted')
  }

  return {
    narrowed: reasons.length > 0,
    reasons,
    liveCombinations,
    startCombinations,
    headroom,
    liveFragments: live.reduce((a, b) => a + b, 0),
    startFragments: start.reduce((a, b) => a + b, 0),
    rollsConsidered: considered.length,
    distinctCombinations: distinct,
    repetition,
    widths: CATEGORIES.map((category, i) => ({
      category,
      live: live[i],
      start: start[i],
    })),
  }
}
