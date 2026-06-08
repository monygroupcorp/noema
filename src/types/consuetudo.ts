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
// First occupant: verb→flow rebinds. A canon verb (`make`, `chat`) has a
// platform default (CANON_VERBS); an owner may rebind it to a different modus
// via `/bind <verb> <slug>` (or the same intent on web/API), and that override
// lives here, keyed by AuctorKey (animaId for identified users, commitment for
// anonymous). `resolve` returns the override or `undefined` (fall through to
// the platform default). Shaped to later re-home `Anima.affines` onto this same
// owner-keyed bag (future — NOT built now). Only `verb → modusId` exists today.
// =============================================================================

import type { AuctorKey } from '../flow/types.js'

/**
 * Consuetudinum — the owner-keyed verb→flow binding store.
 *
 * One implementation: MongoConsuetudinum (keyed by AuctorKey). MemoryConsuetudinum
 * backs the hermetic tests.
 */
export interface Consuetudinum {
  /** The owner's bound modusId for a verb, or undefined if unbound. */
  resolve(owner: AuctorKey, verb: string): Promise<string | undefined>
  /** Persist (upsert) the owner's verb→modusId binding. */
  bind(owner: AuctorKey, verb: string, modusId: string): Promise<void>
}
