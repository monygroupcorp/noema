// =============================================================================
// symbols — the brand's unicode vocabulary
// =============================================================================
// One source for every glyph and emoji the product speaks in, so the same visual
// language carries across surfaces (Telegram today, web chat / Discord later).
// Platform adapters render these into their own controls; the meanings stay fixed.

/** Control glyphs — the buttons/affordances of the menus. */
export const GLYPH = {
  warmDec: '⏱ ‹',   // step the warm window down
  warmInc: '› ⏱',   // step the warm window up
  confirm: '✓',
  refresh: '⟳',
  time:    '⏱',     // reopen the warm-window stepper
  kill:    '✕',
  info:    'ℹ',
  rate:    '♥',     // default rating affordance (before a choice)
  wrench:  '⚙',
  back:    '←',
  tweak:   '✎',
  rerun:   '↻',
} as const

/** Rating glyphs — the fixed feedback set on a delivered result. */
export const RATING: Record<string, string> = { beautiful: '😻', funny: '😹', negative: '😿' }

/**
 * Reaction glyphs — the lifecycle feedback on the user's command:
 *   thinking (received) → ok (cold accepted) | fire (warm reuse).
 * A non-reaction surface (web) expresses the same beats differently, same meaning.
 */
export const REACTION = { thinking: '🤔', ok: '👌', fire: '🔥' } as const
