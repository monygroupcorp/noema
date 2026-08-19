// =============================================================================
// muse/taxonomy — the two-tier prompt-fragment category split
// =============================================================================
//
// A moodboard is decomposed into short, reusable prompt fragments, each tagged
// with exactly one category. Cohesion when those fragments are recombined comes
// almost entirely from WHICH categories exist and how they are tiered — not from
// how cleverly the final sentence is written.
//
// Two tiers, and the distinction is load-bearing:
//   EXCLUSIVE — these define the world. Exactly one of each may be present in a
//               composed prompt; two settings or two styles describe two images.
//   ATTRIBUTE — these describe the single figure. One of each, and they STACK:
//               hair from one source, outfit from another, pose from a third,
//               all landing on one figure. The stacking is the point.
//
// Pure data and pure functions: no I/O, no platform imports. `src/crystal` is
// the platform-neutral ring.

/** One categorized, reusable prompt fragment lifted from a caption. */
export type Fragment = {
  /** Which slot this fragment fills. */
  category: Category
  /** The fragment itself — a short noun/adjective phrase, prompt-ready. */
  text: string
  /** The moodboard entry it came from. */
  source: string
  /** The model binding for that source (e.g. a LoRA trigger word). */
  trigger: string
  /**
   * Session state: this fragment has been turned OFF on the cutting floor.
   *
   * Off is not gone. A disabled fragment stays in the garden and stays in the
   * session's dataset — it darkens, and it can be turned back on. Keeping it is
   * what lets the floor remember how wide it was before the user began aiming,
   * which is the baseline `variance` measures against.
   *
   * Steering sets this; `buildGarden` normalizes fragments as it pools them and
   * produces a floor that is entirely live, so a floor re-grown from captions
   * starts from full width rather than inheriting an earlier session's cuts.
   */
  disabled?: boolean
}

/** A fragment counts toward the floor's live width unless a steer turned it off. */
export function isLive(fragment: Fragment): boolean {
  return fragment.disabled !== true
}

/** World-defining categories: at most one of each may appear in a prompt. */
export const EXCLUSIVE = ['setting', 'style', 'palette', 'lighting', 'mood'] as const

/** Figure-describing categories: one of each, and they stack onto one figure. */
export const ATTRIBUTE = ['subject', 'hair', 'outfit', 'pose', 'expression', 'props'] as const

export type ExclusiveCategory = (typeof EXCLUSIVE)[number]
export type AttributeCategory = (typeof ATTRIBUTE)[number]
export type Category = ExclusiveCategory | AttributeCategory

/** Every category, attribute tier first. Sampling order. */
export const CATEGORIES: readonly Category[] = [...ATTRIBUTE, ...EXCLUSIVE]

/** Which tier a category belongs to. */
export type Tier = 'exclusive' | 'attribute'

const EXCLUSIVE_SET: ReadonlySet<string> = new Set(EXCLUSIVE)
const ATTRIBUTE_SET: ReadonlySet<string> = new Set(ATTRIBUTE)

/** True for a world-defining category. Narrows, so callers can branch on the tier. */
export function isExclusive(category: string): category is ExclusiveCategory {
  return EXCLUSIVE_SET.has(category)
}

/** True for a figure-describing category. Narrows, so callers can branch on the tier. */
export function isAttribute(category: string): category is AttributeCategory {
  return ATTRIBUTE_SET.has(category)
}

/** True for any known category. */
export function isCategory(category: string): category is Category {
  return isExclusive(category) || isAttribute(category)
}

/** The tier of a known category; `undefined` for anything outside the taxonomy. */
export function tierOf(category: string): Tier | undefined {
  if (isExclusive(category)) return 'exclusive'
  if (isAttribute(category)) return 'attribute'
  return undefined
}

/**
 * Slot order for the composed prompt, chosen for image-model readability.
 * Distinct from CATEGORIES (sampling order) on purpose — a category may be
 * sampled early and rendered late.
 */
export const TEMPLATE_ORDER: readonly Category[] = [
  'style',
  'subject',
  'hair',
  'outfit',
  'pose',
  'expression',
  'props',
  'setting',
  'lighting',
  'palette',
  'mood',
]

/** A garden is the pool of fragments available per category. */
export type Garden = Partial<Record<Category, Fragment[]>>

/**
 * The stable identity of a fragment: its category and its text.
 *
 * `buildGarden` already dedupes on exactly that pair (case-insensitively, per
 * category), so no two fragments in one garden can share it — which makes it the
 * identity any per-fragment state (enabled, weight) is keyed by. An array index
 * is NOT an identity: rebuilding a garden renumbers it, and state keyed on a
 * position then lands on a different fragment.
 */
export function fragmentKey(fragment: Pick<Fragment, 'category' | 'text'>): string {
  return `${fragment.category}:${fragment.text.trim().toLowerCase()}`
}
