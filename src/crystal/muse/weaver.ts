// =============================================================================
// muse/weaver — free template composition, and the gate that decides when it
// is not enough
// =============================================================================
//
// Two pure functions and one seam:
//
//   composeTemplate  — zero-cost string assembly. Fixed slot order, fixed
//                      connective words, missing categories drop out.
//   detectConflicts  — the cheap gate. Returns REASONS, not a boolean: the
//                      caller decides what to do with them, and the strings are
//                      what a UI would show.
//   PromptSmoother   — the seam an LLM-backed weave will satisfy. Declared here,
//                      implemented elsewhere. Nothing in this module performs
//                      I/O, reads an environment variable, or calls a model.

import { type Fragment, type Category } from './taxonomy.js'

// --- Template composer -------------------------------------------------------
// Slots ordered for image-model readability; missing categories drop out without
// leaving a dangling connective behind.

export function composeTemplate(fragments: Fragment[]): string {
  const by = {} as Partial<Record<Category, string>>
  for (const f of fragments) by[f.category] = f.text

  const parts: string[] = []
  if (by.style) parts.push(by.style)
  if (by.subject) parts.push(by.subject)
  if (by.hair) parts.push(by.hair)
  if (by.outfit) parts.push(`wearing ${by.outfit}`)
  if (by.pose) parts.push(by.pose)
  if (by.expression) parts.push(by.expression)
  if (by.props) parts.push(`holding ${by.props}`)
  if (by.setting) parts.push(`set in ${by.setting}`)
  if (by.lighting) parts.push(by.lighting)
  if (by.palette) parts.push(`${by.palette} tones`)
  if (by.mood) parts.push(by.mood) // mood is adjectival — render plainly
  return parts.join(', ')
}

// --- Conflict detector -------------------------------------------------------
// The exclusive/attribute split already prevents two-of-a-category. What slips
// through is CROSS-category leakage: two kept fragments implying two different
// places, or a scene whose brightness fights itself. Detect those; only then is
// a paid weave worth buying.

const PLACE_WORDS = [
  'room', 'background', 'sky', 'landscape', 'environment',
  'meadow', 'forest', 'interior', 'indoors', 'outdoors', 'field', 'wall',
  'castle', 'building', 'motherboard', 'street', 'studio', 'seascape',
]
const BRIGHT_WORDS = ['bright', 'vibrant', 'sunlit', 'glowing', 'radiant', 'luminous']
const DIM_WORDS = ['dim', 'dark', 'muted', 'shadowy', 'gloomy', 'overcast', 'night']

function hasAny(text: string, words: string[]): boolean {
  const t = text.toLowerCase()
  return words.some((w) => new RegExp(`\\b${w}\\b`).test(t))
}

/**
 * Report cross-category clashes in a rolled fragment set. An empty result means
 * the free template composes a coherent prompt on its own.
 */
export function detectConflicts(fragments: Fragment[]): string[] {
  const reasons: string[] = []

  // 1. Two implied places — a non-setting fragment smuggling in a location while
  // a setting fragment already establishes one. A single implied place with no
  // setting beside it is simply the place; there is nothing to reconcile, and
  // reporting it would buy a paid weave for a prompt that has no clash in it.
  const setting = fragments.find((f) => f.category === 'setting')
  if (setting) {
    const placeFrags = fragments.filter(
      (f) => f.category !== 'setting' && hasAny(f.text, PLACE_WORDS),
    )
    for (const pf of placeFrags) {
      reasons.push(
        `two places: [${pf.category}] "${pf.text}" implies a location alongside [setting] "${setting.text}"`,
      )
    }
  }

  // 2. Brightness fighting itself across WHOLE-SCENE descriptors only.
  // (lighting is excluded deliberately: a bright light source in a dark scene is
  // chiaroscuro, not a clash — only setting↔palette describe the whole scene's
  // brightness.)
  const scene = fragments.filter((f) => f.category === 'setting' || f.category === 'palette')
  const bright = scene.find((f) => hasAny(f.text, BRIGHT_WORDS))
  const dim = scene.find((f) => hasAny(f.text, DIM_WORDS))
  if (bright && dim) {
    reasons.push(
      `brightness clash: [${bright.category}] "${bright.text}" vs [${dim.category}] "${dim.text}"`,
    )
  }

  return reasons
}

// --- The paid seam -----------------------------------------------------------

/** What a smoother returns: the woven prompt, plus a note on what it reconciled. */
export type WovenPrompt = {
  prompt: string
  /** One sentence on the hardest tension the smoother resolved. */
  cohesionNote?: string
}

/**
 * The seam a paid weave satisfies: the rolled fragments and the reasons the
 * cheap gate flagged, in; one coherent prompt, out. Declared here so callers can
 * be written against it; no implementation lives in this module.
 */
export type PromptSmoother = (
  fragments: Fragment[],
  reasons: string[],
) => Promise<WovenPrompt>
