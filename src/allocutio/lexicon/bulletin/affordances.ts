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
  type PickerState, type ArmState,
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

  // /arm wizard takes over the whole surface while active (image → config → then the model menu).
  if (s.arm) return armAffordances(s.arm, !!s.loadout)

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

  // Mod • → Add picker is a sub-state of the `mod` submenu — render the picker rows.
  if (s.activeSubmenu === 'mod' && s.picker) return pickerAffordances(s.picker)

  // Submenu open → render that submenu's affordances.
  if (s.activeSubmenu) return submenuAffordances(s.activeSubmenu, s.canStart, s.warmTtlMs)

  // Active state: the locked single top-3. State variance lives in the body.
  return [[
    { id: 'mod',     label: 'Mod •',    kind: 'submenu', scope: 'host' },
    { id: 'share',   label: 'Share •',  kind: 'submenu', scope: 'host' },
    { id: 'destroy', label: 'Destroy',  kind: 'submenu', scope: 'host' },
  ]]
}

function submenuAffordances(which: Exclude<ActiveSubmenu, null>, canStart = false, warmTtlMs = WARM_LADDER_MS[0]): Affordance[][] {
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
    case 'mod': {
      // Opening Mod • already shows the loadout/spec as the body (no separate "View
      // loadout" button — it'd be redundant). `Add model` opens the picker sub-state.
      // An armed, not-yet-provisioned studio also offers a warm-window stepper + `[▸ Start]`
      // so the host sets how long it stays warm BEFORE launching (else it reaps on the default).
      const rows: Affordance[][] = [[{ id: 'mod.add', label: 'Add model', kind: 'action', scope: 'host' }]]
      if (canStart) {
        const idx = Math.max(0, WARM_LADDER_MS.indexOf(warmTtlMs))
        rows.push([
          { id: 'dec',  label: GLYPH.warmDec, kind: 'action', scope: 'host' },
          { id: 'noop', label: `warm: ${WARM_LADDER_LABEL[idx]}`, kind: 'noop' },
          { id: 'inc',  label: GLYPH.warmInc, kind: 'action', scope: 'host' },
        ])
        rows.push([{ id: 'mod.start', label: `${GLYPH.start} Start studio`, kind: 'action', scope: 'host' }])
      }
      rows.push([{ id: 'submenu.back', label: '← Back', kind: 'action', scope: 'host' }])
      return rows
    }
  }
}

/** Inline-button labels wrap badly when long — clip to keep every row to one tidy line. */
function trunc(s: string, max = 30): string {
  return s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s
}

/**
 * The `/arm` wizard rows — image step or config step. Icon-only back on top (cancels at the
 * image step, steps back at the config step), then one option per row. Index-encoded ids
 * (`arm.image:<i>` / `arm.config:<i>`) keep callback_data short.
 */
export function armAffordances(a: ArmState, hasFlow = false): Affordance[][] {
  // The first layer (preset) dismisses the wizard → a Cancel (⊗); deeper layers step back → (←).
  // On the chooser, once ≥1 flow is added, a Proceed sits beside Cancel to move forward.
  const top: Affordance[] = a.step === 'preset'
    ? [{ id: 'arm.cancel', label: GLYPH.cancel, kind: 'action', scope: 'host' }]
    : [{ id: 'arm.back',   label: GLYPH.back,   kind: 'action', scope: 'host' }]
  if (a.step === 'preset' && hasFlow) {
    top.push({ id: 'arm.proceed', label: `Proceed ${GLYPH.next}`, kind: 'action', scope: 'host' })
  }
  const rows: Affordance[][] = [top]

  if (a.step === 'preset') {
    // The flow chooser is laid out like the model list: the name opens a detail card, the ＋
    // commits the flow. Custom is the exception (the manual builder, no detail to show) — a
    // single full-width button that drops into the image→config path.
    a.presets.forEach((p, i) => {
      if (p.id === 'custom') {
        rows.push([{ id: `arm.preset:${i}`, label: trunc(p.label), kind: 'action', scope: 'host' }])
      } else {
        rows.push([
          { id: `arm.flow:${i}`,   label: trunc(p.label, 26), kind: 'action', scope: 'host' },
          { id: `arm.preset:${i}`, label: GLYPH.add,          kind: 'action', scope: 'host' },
        ])
      }
    })
    return rows
  }

  if (a.step === 'flowdetail') {
    rows.push([{ id: 'arm.flowadd', label: `${GLYPH.add} Add this flow`, kind: 'action', scope: 'host' }])
    return rows
  }

  // image / config steps — one option per row.
  const opts = a.step === 'image' ? a.images : a.configs
  opts.forEach((o, i) => rows.push([{ id: `arm.${a.step}:${i}`, label: trunc(o), kind: 'action', scope: 'host' }]))
  return rows
}

/**
 * The `Mod • → Add` picker rows — pure function of PickerState, a two-stage machine.
 * Aesthetic: an ever-present icon-only control row on top (Back · Search), every option on
 * its own row (never two across), and arrow-only Prev/Next on their own row when paginated.
 *
 * Top control row (icons only, every stage): Back · Search (⌕) · By-trigger (⌗).
 *
 * stage 'categories' — choose a model type (mount location), popular-first:
 *   [ ← ] [ ⌕ ] [ ⌗ ]              top control row
 *   [ checkpoints ]                 one mount per row (`mod.cat:<mount>`)
 *   [ loras ]
 *
 * stage 'list' — the paginated models in that mount (or flat search results):
 *   [ ← ] [ ⌕ ] [ ⌗ ]              top control row
 *   [ Base: FLUX.1 Schnell ]        only when the mount supports base filtering (LoRA)
 *   [ <item nomen> ] [ ＋ ]  × N    name → detail card; ＋ → direct add (per-row pair)
 *   [ ◀ ] [ ▶ ]                     arrows only, gated on page bounds; row omitted if neither
 *
 * stage 'detail' — one model's card (body rendered by the view):
 *   [ ← ] [ ⌕ ]                    Back → list
 *   [ ＋ Add ]
 *
 * Item picks use a generation-tagged, PAGE-RELATIVE index so callback_data stays well
 * under Telegram's 64-byte cap; the manager rejects a stale `token` and otherwise resolves
 * `i` against `picker.items`. Back (`submenu.back`) is stage-aware in the manager.
 */
export function pickerAffordances(p: PickerState): Affordance[][] {
  const rows: Affordance[][] = [[
    { id: 'submenu.back', label: GLYPH.back,    kind: 'action', scope: 'host' },
    { id: 'mod.search',   label: GLYPH.search,  kind: 'action', scope: 'host' },
    { id: 'mod.trigger',  label: GLYPH.trigger, kind: 'action', scope: 'host' },
  ]]

  if (p.stage === 'categories') {
    for (const mount of p.categories) {
      rows.push([{ id: `mod.cat:${mount}`, label: trunc(mount), kind: 'action', scope: 'host' }])
    }
    return rows
  }

  if (p.stage === 'detail') {
    // The card body is rendered by the view; here we offer just the direct Add.
    rows.push([{ id: 'mod.detailadd', label: '＋ Add', kind: 'action', scope: 'host' }])
    return rows
  }

  // stage 'list'
  // Base filter — shown only for a mount that supports it (the LoRA folder). One button that
  // cycles through the base families present in the data (FLUX/SDXL/… + All), each with a count.
  if (p.baseFamilies && p.baseFamilies.length > 0) {
    const cur = p.baseFamilies.find(f => f.id === (p.baseFilter ?? '')) ?? p.baseFamilies[0]
    rows.push([{ id: 'mod.basefilter', label: `Base: ${trunc(cur.label, 24)}`, kind: 'action', scope: 'host' }])
  }

  // One row per item: the name opens its detail card; the ＋ adds it directly. (A deliberate
  // two-button exception to one-per-row — the ＋ is an action on that model, not a second model.)
  p.items.forEach((it, i) => {
    rows.push([
      { id: `mod.detail:${p.token}:${i}`, label: trunc(it.nomen, 26), kind: 'action', scope: 'host' },
      { id: `mod.pick:${p.token}:${i}`,   label: GLYPH.add, kind: 'action', scope: 'host' },
    ])
  })

  // Arrow-only nav row — only when there's somewhere to go.
  const nav: Affordance[] = []
  if (p.page > 0) nav.push({ id: 'mod.page:prev', label: GLYPH.prev, kind: 'action', scope: 'host' })
  if (p.page < p.pageCount - 1) nav.push({ id: 'mod.page:next', label: GLYPH.next, kind: 'action', scope: 'host' })
  if (nav.length) rows.push(nav)
  return rows
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
