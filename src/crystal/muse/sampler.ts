// =============================================================================
// muse/sampler — deterministic one-fragment-per-category roll
// =============================================================================
//
// The slot machine. Given a garden (fragments pooled by category) and a roll
// index, pick exactly one fragment from each non-empty category. Empty and
// missing categories simply drop out; nothing throws and nothing `undefined`
// reaches the caller.
//
// Determinism is a hard requirement: the same (garden, rollIndex) must always
// produce the same roll, so a roll can be linked to, replayed, and tested.
// `Math.random()` is therefore not used anywhere in this module.
//
// The per-category offset is derived from the category's IDENTITY (a hash of its
// name), not from any incidental property such as the length of its name. An
// offset keyed on name length gives every same-length category the same seed, so
// those categories advance in lockstep across rolls: `hair`, `pose` and `mood`
// would always draw the same index into their own pools, as would `props` and
// `style`, and `subject`, `setting` and `palette`. The garden would then have far
// fewer distinct outcomes than its size suggests, while each individual roll
// still looked well-formed.

import { CATEGORIES, type Fragment, type Garden } from './taxonomy.js'

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

function pick<T>(pool: readonly T[] | undefined, seed: number): T | undefined {
  if (!pool || pool.length === 0) return undefined
  return pool[seed % pool.length]
}

/**
 * Sample one fragment per non-empty category.
 *
 * @param garden      fragment pools keyed by category
 * @param rollIndex   which roll this is; the same index always yields the same roll
 */
export function rollFragments(garden: Garden, rollIndex: number): Fragment[] {
  const chosen: Fragment[] = []
  for (const category of CATEGORIES) {
    const fragment = pick(garden[category], seedFor(category, rollIndex))
    if (fragment) chosen.push(fragment)
  }
  return chosen
}
