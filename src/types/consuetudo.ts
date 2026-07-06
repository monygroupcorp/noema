// =============================================================================
// CONSUETUDO — an account's established defaults (the "platform preferences" slot)
// =============================================================================
//
// "consuetudo" = custom, habit, established usage (Latin, 3rd decl. fem.;
// gen. pl. consuetudinum). A user's habitual way of working — settings that
// travel WITH the account across every surface (Telegram, web, API), not a
// per-adapter setting. THE one owner-keyed account-state home (ADR-0003), made
// anon-capable (AuctorKey, not anima-only) so it works for anonymous callers the
// identified-only Anima/Persona cannot. Its charter is deliberately "all owner-
// keyed preferences share one home" — spanning both how a user GENERATES
// (defaults) and how they PRESENT (skin), rather than spawning a new noun per
// concern (crystal-first: minimize surface).
//
// Four occupants, all owner-keyed by AuctorKey (animaId for identified users,
// commitment for anonymous):
//
//   1. verb→flow rebinds. A canon verb (`make`, `chat`) has a platform default
//      (CANON_VERBS); an owner may rebind it to a different modus via
//      `/bind <verb> <slug>`. `resolve` returns the override or `undefined`
//      (fall through to the platform default). `listBindings` reads them all.
//
//   2. affines — per-modus input affinities (re-homed from `Anima.affines`). The
//      owner's default input overrides for a specific flow:
//      `{ [inputKey]: overrideValue }`. The cast-time precedence the resolver
//      names is "cast-time input > affines > generatio > modus defaults"; affines
//      are this account-level, anon-capable tier. (Previously a required field on
//      the Anima record, never read; moved here so all owner-keyed preferences
//      share one home — ADR-0003.)
//
//   3. generatio — cross-cutting generation defaults (style, negative prompt, …),
//      applied at cast time UNDER affines (see `applyAccountDefaults`).
//
//   4. appearance — the owner's presentation skin (avatar/accent/look). NOT a
//      generation default — a distinct kind of owner-keyed preference that lives
//      here for the same reason (one anon-capable home), not on the web Profile
//      alone. The generation path never reads it.
// =============================================================================

import type { AuctorKey } from '../flow/types.js'

/**
 * Appearance — the owner's presentation "skin" (the web Profile screen). Owner-keyed
 * like every other consuetudo occupant, so it works for anonymous (commitment) callers
 * too — the frontend identity is anon-first, so this could NOT live on the identified-
 * only Anima/Persona. All URLs are our-hosted (R2) or BYO.
 */
export interface Appearance {
  avatarUrl?: string
  bannerUrl?: string
  backgroundUrl?: string
  /** One signal color (hex). */
  accent?: string
  /** Signature look — a UI-validated tag ('clean' | 'n64' | 'vapor' | 'editorial'). */
  look?: string
}

/**
 * Generatio — the owner's cross-cutting generation defaults (the web Preferences
 * screen), applied at cast time under the affines precedence chain. Distinct from
 * `affines` (which are PER-modus input overrides); these apply across commands.
 */
export interface Generatio {
  /** Prepended to the prompt when the flow has a prompt input and none is style-set. */
  style?: string
  /** Fills a flow's negative-prompt input when the caller didn't provide one. */
  negativePrompt?: string
  /** Preferred output encoding — stored; applied by the runner where supported. */
  outputFormat?: string
  /** Telegram delivery shape — consumed by the Telegram adapter, not the web run path. */
  telegramDeliverAs?: 'album' | 'individual'
  /** Models (intellaId) auto-applied as pinnedModels on every run (unless overridden). */
  autoApplyModels?: string[]
  /** Default project (Provincia id) new work files into ("land in project", web Preferences).
   *  Stored here so the choice travels across web · Telegram · API; cast-time auto-filing is
   *  the marked next step (like the other applied-where-supported fields above). */
  defaultProjectId?: string
}

/** One verb→modus binding row (for the read side — `listBindings`). */
export interface Binding { verb: string; modusId: string }

/**
 * Consuetudinum — an account's owner-keyed established defaults + presentation:
 * verb→flow rebinds, per-modus input affines, cross-cutting generation prefs, and
 * the profile appearance. All keyed by AuctorKey (anon-capable — ADR-0003).
 *
 * One implementation: MongoConsuetudinum (keyed by AuctorKey). MemoryConsuetudinum
 * backs the hermetic tests.
 */
export interface Consuetudinum {
  /** The owner's bound modusId for a verb, or undefined if unbound. */
  resolve(owner: AuctorKey, verb: string): Promise<string | undefined>
  /** Persist (upsert) the owner's verb→modusId binding. */
  bind(owner: AuctorKey, verb: string, modusId: string): Promise<void>
  /** Every verb→modus override the owner has set (the read side of `bind`). */
  listBindings(owner: AuctorKey): Promise<Binding[]>

  /** The owner's input affinities for a modus (`{ inputKey: value }`), or undefined if none. */
  resolveAffines(owner: AuctorKey, modusId: string): Promise<Record<string, unknown> | undefined>
  /** Persist (upsert/replace) the owner's per-modus input affinities. */
  setAffines(owner: AuctorKey, modusId: string, affines: Record<string, unknown>): Promise<void>

  /** The owner's presentation skin, or undefined if unset. */
  resolveAppearance(owner: AuctorKey): Promise<Appearance | undefined>
  /** Persist (upsert/replace) the owner's appearance. */
  setAppearance(owner: AuctorKey, appearance: Appearance): Promise<void>

  /** The owner's cross-cutting generation defaults, or undefined if unset. */
  resolveGeneratio(owner: AuctorKey): Promise<Generatio | undefined>
  /** Persist (upsert/replace) the owner's generation defaults. */
  setGeneratio(owner: AuctorKey, generatio: Generatio): Promise<void>
}
