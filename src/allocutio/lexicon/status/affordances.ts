// =============================================================================
// Status affordances — platform-neutral action descriptors for the /status HUD
// =============================================================================
// Parallel to bulletin/affordances.ts but a richer surface: per-row Cancel for
// each gen, per-row Bulletin link for each studio, per-row Join for each
// joinable studio, plus a footer with Refresh / History / Settings.
//
// Action ids encode the target id when needed (cancel:<actumId>, etc.). The
// callback prefix is `stat:` — added in exactly one place (packAffordances).

import type { Affordance } from '../bulletin/affordances.js'
import type { UiKeyboard } from '../ui/Keyboard.js'
import type { StatusSnapshot } from './types.js'

// Re-export the shared Affordance shape so consumers can import it from the
// status namespace if that reads better in their context.
export type { Affordance } from '../bulletin/affordances.js'

/**
 * The full set of /status affordances grouped into rows. Empty groups produce
 * no row (so a user with no gens doesn't see an empty button row).
 */
export function statusAffordancesFor(s: StatusSnapshot): Affordance[][] {
  const rows: Affordance[][] = []

  // Per-gen Cancel rows. One row per gen, label includes the modus for
  // unambiguous tap-targeting when there are several.
  for (const g of s.gens) {
    rows.push([
      { id: `cancel:${g.actumId}`, label: `× Cancel ${g.modusLabel}`, kind: 'action', scope: 'host' },
    ])
  }

  // Per-studio Bulletin link (jump-to-bulletin for the studio). Only owners see
  // this row — the scope is enforced at the callback dispatcher, not here.
  for (const st of s.studios) {
    rows.push([
      { id: `bulletin:${st.studioId}`, label: `→ ${st.label}`, kind: 'action', scope: 'host' },
    ])
  }

  // Per-joinable Join row.
  for (const j of s.joinable) {
    rows.push([
      { id: `join:${j.studioId}`, label: `▶ Join ${j.label}`, kind: 'action', scope: 'any' },
    ])
  }

  // Footer — always present.
  rows.push([
    { id: 'refresh',  label: '↻ Refresh',  kind: 'action', scope: 'any' },
    { id: 'history',  label: 'History',    kind: 'action', scope: 'any' },
    { id: 'settings', label: 'Settings',   kind: 'action', scope: 'any' },
  ])

  return rows
}

/** Pack to UiKeyboard for Telegram. `data` is prefixed `stat:<id>`. */
export function packStatusAffordances(rows: Affordance[][]): UiKeyboard {
  return rows.map(row => row.map(a => ({ label: a.label, data: `stat:${a.id}` })))
}

/** Strip the `stat:` prefix from a callback data string. Returns null if not a
 *  status callback (lets the dispatcher fall through to other handlers). */
export function parseStatusData(data: string): string | null {
  return data.startsWith('stat:') ? data.slice(5) : null
}
