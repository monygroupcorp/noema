// =============================================================================
// CONSUETUDO — an account's established defaults (the "platform preferences" slot)
// =============================================================================
//
// "consuetudo" = custom, habit, established usage (Latin, 3rd decl. fem.;
// gen. pl. consuetudinum). A user's habitual way of working — defaults that
// travel WITH the account across every surface (Telegram, web, API), not a
// per-adapter setting. This is the owner-keyed "platform preferences" slot the
// `Anima.affines` precedence chain already names ("cast-time > affines >
// platform preferences > modus defaults"), made anon-capable (AuctorKey, not
// anima-only). ADR-0003 sanctioned it as the one new bit of owner-keyed state.
//
// Two occupants, both owner-keyed by AuctorKey (animaId for identified users,
// commitment for anonymous):
//
//   1. verb→flow rebinds. A canon verb (`make`, `chat`) has a platform default
//      (CANON_VERBS); an owner may rebind it to a different modus via
//      `/bind <verb> <slug>`. `resolve` returns the override or `undefined`
//      (fall through to the platform default).
//
//   2. affines — per-modus input affinities (re-homed from `Anima.affines`). The
//      owner's default input overrides for a specific flow:
//      `{ [inputKey]: overrideValue }`. The cast-time precedence the resolver
//      names is "cast-time input > affines > modus defaults"; affines are this
//      account-level, anon-capable tier. `resolveAffines` returns the map or
//      `undefined`. (Previously a required field on the Anima record, never read;
//      moved here so all owner-keyed preferences share one home — ADR-0003.)
// =============================================================================

import type { AuctorKey } from '../flow/types.js'

/**
 * Consuetudinum — an account's owner-keyed established defaults: verb→flow
 * rebinds + per-modus input affines.
 *
 * One implementation: MongoConsuetudinum (keyed by AuctorKey). MemoryConsuetudinum
 * backs the hermetic tests.
 */
export interface Consuetudinum {
  /** The owner's bound modusId for a verb, or undefined if unbound. */
  resolve(owner: AuctorKey, verb: string): Promise<string | undefined>
  /** Persist (upsert) the owner's verb→modusId binding. */
  bind(owner: AuctorKey, verb: string, modusId: string): Promise<void>

  /** The owner's input affinities for a modus (`{ inputKey: value }`), or undefined if none. */
  resolveAffines(owner: AuctorKey, modusId: string): Promise<Record<string, unknown> | undefined>
  /** Persist (upsert/replace) the owner's per-modus input affinities. */
  setAffines(owner: AuctorKey, modusId: string, affines: Record<string, unknown>): Promise<void>
}
