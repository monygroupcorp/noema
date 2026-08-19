// =============================================================================
// muse/sampler — deterministic one-fragment-per-category roll
// =============================================================================
//
// The slot machine. Given a garden (fragments pooled by category) and a roll
// index, pick exactly one fragment from each non-empty category. Empty and
// missing categories simply drop out; nothing throws and nothing `undefined`
// reaches the caller.
//
// Determinism is a hard requirement: the same (garden, steer, rollIndex) must
// always produce the same roll, so a roll can be linked to, replayed, priced and
// tested. A caller may carry a roll forward and fire it later rather than
// re-rolling, so a pick that moved between the two would fire a prompt nobody
// saw. `Math.random()` is therefore not used anywhere in this module, and the
// weighted pick below is a pure function of (pool, weights, seed).
//
// The per-category offset is derived from the category's IDENTITY (a hash of its
// name), not from any incidental property such as the length of its name. An
// offset keyed on name length gives every same-length category the same seed, so
// those categories advance in lockstep across rolls: `hair`, `pose` and `mood`
// would always draw the same index into their own pools, as would `props` and
// `style`, and `subject`, `setting` and `palette`. The garden would then have far
// fewer distinct outcomes than its size suggests, while each individual roll
// still looked well-formed.
//
// STEERING. A roll optionally reads per-fragment state: a fragment may be turned
// off, and a fragment may be weighted up or down. Both are keyed by fragment
// IDENTITY (`fragmentKey`), never by array position — a garden rebuild renumbers
// positions, and state keyed on a position then lands on a different fragment. A
// disabled fragment stays in the garden and is simply not drawn: darkened, not
// deleted. With no state supplied, every pick is exactly the uniform pick this
// module made before steering existed.

import { CATEGORIES, fragmentKey, type Fragment, type Garden } from './taxonomy.js'

// --- Per-fragment steer state ------------------------------------------------

/** What a steer says about one fragment. Both fields are optional; absent = the default. */
export type FragmentState = {
  /** `false` takes the fragment out of the draw while leaving it in the garden. Default `true`. */
  enabled?: boolean
  /** Draw weight relative to its pool-mates, clamped to [WEIGHT_MIN, WEIGHT_MAX]. Default 1. */
  weight?: number
}

/** Per-fragment steer state, keyed by `fragmentKey(fragment)`. */
export type SteerState = ReadonlyMap<string, FragmentState>

/**
 * The weight bounds, and they are load-bearing rather than defensive.
 *
 * An unbounded weight makes a fragment's pool-mates unreachable in practice,
 * which collapses a category to a single value — indistinguishable from a pool
 * that has genuinely been exhausted, and it would make any readout of how much of
 * the pool is still live report a number that is not true. The bound fixes the
 * widest odds one fragment can hold over a pool-mate at
 * WEIGHT_MAX / WEIGHT_MIN = 64:1: strongly steered, still reachable.
 */
export const WEIGHT_MIN = 0.125
export const WEIGHT_MAX = 8

/**
 * Weights are quantized to integer units at this resolution before the pick, so
 * the draw is exact integer arithmetic with no floating-point comparison in it.
 * WEIGHT_MIN lands on 1 unit and WEIGHT_MAX on 64.
 */
const WEIGHT_SCALE = 8

/** A fragment's weight in integer units: clamped, quantized, never below 1. */
function weightUnits(weight: number | undefined): number {
  if (typeof weight !== 'number' || !Number.isFinite(weight)) return WEIGHT_SCALE
  const clamped = Math.min(WEIGHT_MAX, Math.max(WEIGHT_MIN, weight))
  return Math.max(1, Math.round(clamped * WEIGHT_SCALE))
}

function gcd(a: number, b: number): number {
  while (b !== 0) {
    const next = a % b
    a = b
    b = next
  }
  return a
}

/**
 * The weight line for a pool, reduced by its greatest common divisor.
 *
 * The reduction is what keeps an unsteered roll identical to the uniform roll:
 * every fragment at the default weight gives an all-equal line, which reduces to
 * one unit each, and the pick below is then `seed % pool.length` — the arithmetic
 * this module used before weights existed.
 */
function weightLine(pool: readonly Fragment[], steer: SteerState | undefined): number[] {
  const units = pool.map((f) => weightUnits(steer?.get(fragmentKey(f))?.weight))
  const divisor = units.reduce((d, u) => gcd(d, u), 0)
  return divisor > 1 ? units.map((u) => u / divisor) : units
}

/** The fragments a steer leaves in the draw. A disabled fragment stays in the garden. */
function enabledPool(
  pool: readonly Fragment[] | undefined,
  steer: SteerState | undefined,
): readonly Fragment[] {
  if (!pool || pool.length === 0) return []
  if (!steer) return pool
  return pool.filter((f) => steer.get(fragmentKey(f))?.enabled !== false)
}

// --- Seeding -----------------------------------------------------------------

/** FNV-1a over the category name: a small, stable, per-identity offset. */
function hashCategory(category: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < category.length; i++) {
    h ^= category.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

/** Roll seed for one category: category identity, offset by the roll index. */
function seedFor(category: string, rollIndex: number): number {
  // Knuth's multiplicative constant spreads consecutive roll indices apart, so
  // successive rolls do not merely step every category forward by one.
  return (hashCategory(category) + Math.imul(rollIndex >>> 0, 2654435761)) >>> 0
}

/**
 * Draw one fragment from a pool along its cumulative weight line.
 *
 * Pure in (pool, weights, seed): the seed picks a position on the line and the
 * position determines the fragment, so the same three inputs always land on the
 * same fragment. A pool with nothing in it yields `undefined`, exactly as an empty
 * pool always has.
 */
function pick(
  pool: readonly Fragment[],
  weights: readonly number[],
  seed: number,
): Fragment | undefined {
  if (pool.length === 0) return undefined
  const total = weights.reduce((sum, w) => sum + w, 0)
  let position = seed % total
  for (let i = 0; i < pool.length; i++) {
    position -= weights[i]
    if (position < 0) return pool[i]
  }
  return pool[pool.length - 1]
}

/**
 * Sample one fragment per non-empty category.
 *
 * A category whose fragments are all disabled drops out of the roll exactly as an
 * empty or missing category does — nothing throws and no `undefined` reaches the
 * caller. Sparse categories are normal (a real dataset can decompose to two
 * `lighting` fragments), so a steer emptying one is expected traffic, not an
 * error.
 *
 * @param garden      fragment pools keyed by category
 * @param rollIndex   which roll this is; the same index always yields the same roll
 * @param steer       optional per-fragment enabled/weight state; absent = the uniform
 *                    roll this module has always produced
 */
export function rollFragments(garden: Garden, rollIndex: number, steer?: SteerState): Fragment[] {
  const chosen: Fragment[] = []
  for (const category of CATEGORIES) {
    const pool = enabledPool(garden[category], steer)
    const fragment = pick(pool, weightLine(pool, steer), seedFor(category, rollIndex))
    if (fragment) chosen.push(fragment)
  }
  return chosen
}
