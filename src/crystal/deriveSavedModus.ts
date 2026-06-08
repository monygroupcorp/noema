// =============================================================================
// deriveSavedModus — fork a canonical (or any) Modus into a user-owned saved flow
// =============================================================================
//
// ADR-0003 §2: "A named saved version = a derived `Modus` (the full case)." It is
// a real Modorum entry — `canonica: false`, the captured tweaks baked into the
// `Porta.default`s, owned by an `AuctorKey`, linked to its parent via `fonte`.
//
// Pure + crystal-only: no I/O, no new nouns. Copies the base wholesale (genus,
// runpodSpec/gradus, exitus, ministerium, categoria, … — every field rides along
// the spread), then overrides identity/provenance, folds the pinned loadout into
// the weight manifest, and bakes the captured config into the input schema.
//
// Editing a saved flow later = re-derive + re-register with a bumped versio
// (never Modorum.update — that only accepts non-definitional fields). ADR-0003 §2.

import type { Modus, AuctorKey } from '../types/modus.js'
import { hashModus } from './hashModus.js'

/** How the saved flow surfaces its prompt at run time. */
export type PromptMode = 'open' | 'pinned'

export interface DeriveSavedModusOpts {
  /** The global-unique slug the user chose — becomes both `id` and the runnable name. */
  slug: string
  /** Display name. */
  name: string
  /** Who owns the saved flow — `await identity.resolve(userId)` (an AuctorKey). */
  owner: AuctorKey
  /** The captured config values (the flow card / actum aditus). Each becomes a `Porta.default`. */
  aditus: Record<string, unknown>
  /**
   * Prompt mode. `'pinned'` bakes the captured `prompt` value as the Porta default;
   * `'open'` leaves the `prompt` Porta a fresh required input (no default).
   */
  promptMode: PromptMode
  /** LoRAs the user pinned onto the loadout — folded into `intellae` as `{ id, role: 'lora' }`. */
  pinned?: Array<{ id: string }>
  /** Semantic version for the derived flow. Defaults to '1.0.0' (a fresh fork). */
  versio?: string
}

/**
 * Derive a user-owned saved Modus from a base.
 *
 * Generic over the concrete Modus subtype (e.g. `Essentia`) so subtype fields
 * (runpodSpec, categoria, …) copy through and the return type is preserved.
 */
export function deriveSavedModus<M extends Modus>(base: M, opts: DeriveSavedModusOpts): M {
  // The config bakes into the input schema as Porta defaults. The `prompt` Porta is
  // special: defaulted only when pinned (open → stays a fresh required input).
  const aditus = Object.fromEntries(
    Object.entries(base.aditus).map(([key, porta]) => {
      const captured = opts.aditus[key]
      const isPrompt = key === 'prompt'
      const apply = captured !== undefined && (!isPrompt || opts.promptMode === 'pinned')
      return [key, apply ? { ...porta, default: captured } : { ...porta }]
    })
  )

  // The weight manifest = the base's weights + the user's pinned LoRAs.
  const baseIntellae = base.intellae ?? []
  const pinnedIntellae = (opts.pinned ?? []).map(p => ({ id: p.id, role: 'lora' }))
  const intellae = [...baseIntellae, ...pinnedIntellae]

  const derived: M = {
    ...base,
    id: opts.slug,
    nomen: opts.name,
    auctor: opts.owner,
    canonica: false,
    fonte: base.id,
    versio: opts.versio ?? '1.0.0',
    intellae,
    aditus,
    contentHash: '',
  }
  derived.contentHash = hashModus(derived)
  return derived
}
