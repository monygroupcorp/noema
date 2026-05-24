// =============================================================================
// Affordances — platform-neutral action descriptors for the bulletin.
// =============================================================================
//
// The bulletin's action row is a list of *affordances* (what the user can do
// now), not a list of buttons. Telegram packs them into an inline keyboard;
// the API will serialize the same descriptors as JSON; future Discord/web
// adapters do the same with their own controls. ONE pure function
// `affordancesFor(snapshot)` decides; every renderer reads from there.
//
// Keep these descriptors DUMB: an id + a label + a kind. No platform shapes.
// =============================================================================

import {
  WARM_LADDER_MS, WARM_LADDER_LABEL,
} from './types.js'
import { GLYPH } from '../symbols.js'
import type { BulletinSnapshot } from './BulletinView.js'

/**
 * One affordance — a thing the user can do on the bulletin right now.
 *
 * `id` is the canonical action identifier. Telegram callback_data is built as
 * `bul:<id>`. API/other transports embed the id verbatim in their request
 * shapes. NEVER include platform-specific encoding here.
 *
 * `kind: 'noop'` is rendered (e.g. the warm-stepper read-out) but produces no
 * action — used to keep the row balanced for visual feedback. `kind: 'submenu'`
 * means activation opens a child affordance set; the dispatcher reads
 * `snapshot.activeSubmenu` to decide which to show on the next render.
 */
export interface Affordance {
  id: string
  label: string
  kind: 'action' | 'submenu' | 'noop'
  /** Permission scope. 'host'-only buttons are hidden from guests. 'any' for refresh etc. */
  scope?: 'host' | 'guest' | 'any'
}

/** Which submenu is currently expanded on the bulletin, if any. */
export type ActiveSubmenu = 'mod' | 'share' | 'destroy' | null

/**
 * The pure top-row decision: given a snapshot, return the rows of affordances
 * to render. Two distinct shapes survive in v1:
 *
 *   1. SETUP pre-state (first gen just delivered, host hasn't picked warm window)
 *      [— · warm: <ladder> · +]  [confirm]
 *      Kept until /arm subsumes it. This is the cost-confirmation flow for
 *      /make users.
 *
 *   2. ACTIVE state (confirmed or running): the spec'd single top-3
 *      [Mod •] [Share •] [Destroy]
 *      Identical in every alive sub-state (provisioning / bootstrapping /
 *      running / warm-idle). Activating a `•` switches `snapshot.activeSubmenu`,
 *      and the next render returns that submenu's rows.
 *
 *   3. SUBMENU state (any submenu open): the submenu's own rows + a Back.
 *
 *   4. Ended (receipted) → no actions.
 */
export function affordancesFor(s: BulletinSnapshot): Affordance[][] {
  if (s.ended) return []

  // Setup pre-state: warm stepper + confirm. (/make-era; /arm will subsume.)
  if (!s.confirmed) {
    const idx = Math.max(0, WARM_LADDER_MS.indexOf(s.warmTtlMs))
    return [
      [
        { id: 'dec',  label: GLYPH.warmDec, kind: 'action', scope: 'host' },
        { id: 'noop', label: `warm: ${WARM_LADDER_LABEL[idx]}`, kind: 'noop' },
        { id: 'inc',  label: GLYPH.warmInc, kind: 'action', scope: 'host' },
      ],
      [
        { id: 'confirm', label: GLYPH.confirm, kind: 'action', scope: 'host' },
      ],
    ]
  }

  // Submenu open → render that submenu's affordances.
  if (s.activeSubmenu) return submenuAffordances(s.activeSubmenu)

  // Active state: the locked single top-3. State variance lives in the body.
  return [[
    { id: 'mod',     label: 'Mod •',    kind: 'submenu', scope: 'host' },
    { id: 'share',   label: 'Share •',  kind: 'submenu', scope: 'host' },
    { id: 'destroy', label: 'Destroy',  kind: 'submenu', scope: 'host' },
  ]]
}

function submenuAffordances(which: Exclude<ActiveSubmenu, null>): Affordance[][] {
  switch (which) {
    case 'destroy':
      // Never an immediate action — always confirms via the submenu.
      return [
        [
          { id: 'destroy.now',   label: 'Now',   kind: 'action', scope: 'host' },
          { id: 'destroy.drain', label: 'Drain', kind: 'action', scope: 'host' },
        ],
        [
          { id: 'submenu.back',  label: '← Back', kind: 'action', scope: 'host' },
        ],
      ]
    case 'share':
      return [
        [
          { id: 'share.copy',    label: 'Copy link',  kind: 'action', scope: 'host' },
          { id: 'share.forward', label: 'Forward',    kind: 'action', scope: 'host' },
        ],
        [
          { id: 'submenu.back',  label: '← Back', kind: 'action', scope: 'host' },
        ],
      ]
    case 'mod':
      // Stub — `View loadout` shows current image + base model in the body.
      // Add/swap lands in the later Mod • warm-modification sprint.
      return [
        [
          { id: 'mod.view',     label: 'View loadout', kind: 'action', scope: 'host' },
        ],
        [
          { id: 'submenu.back', label: '← Back',       kind: 'action', scope: 'host' },
        ],
      ]
  }
}

// ── Pack: Affordance[][] → UiKeyboard ────────────────────────────────────────
//
// Adapter-side helper. Each Affordance becomes one {label, data} button; data
// is `bul:<id>`. Noops use a sentinel `bul:noop`. This is the ONLY place the
// `bul:` prefix is added; downstream code reads `id` from after the prefix.
import type { UiKeyboard } from '../ui/Keyboard.js'

export function packAffordances(rows: Affordance[][]): UiKeyboard {
  return rows.map(row => row.map(a => ({ label: a.label, data: `bul:${a.id}` })))
}

/** The inverse: extract the action id from a `bul:<id>` callback data string.
 *  Returns null if the prefix is missing. */
export function parseAffordanceData(data: string): string | null {
  return data.startsWith('bul:') ? data.slice(4) : null
}
