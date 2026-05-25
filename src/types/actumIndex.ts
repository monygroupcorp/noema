// =============================================================================
// ActumIndex — per-AuctorKey aggregation of dispatched actums
// =============================================================================
//
// The crystal privacy invariant: actum/modo rows carry NO identity columns
// (modo → actum.nullifier → signum(arcanum) → signum(deposit) → anima is the
// only chain back to identity). That keeps the data layer clean, but it leaves
// `/status` with nothing to answer "what gens does THIS user have in flight?"
// without violating the invariant.
//
// ActumIndex is an explicit, separate aggregation collection — not metadata on
// the actum row. It writes from `ExecuteFlow` using whichever side of the
// `AuctorKey` union the trace carries:
//
//   - Identified run → entry with `animaId` set
//   - Anonymous run  → entry with `commitment` set
//
// Both are first-class. Indexing a commitment doesn't leak new information:
// every spend already carries the commitment as `testis` on the arcanum signum,
// so this collection just makes the existing ledger data queryable through
// `/status`. The trust boundary is the chat/session correlation, same as
// anonymous `/make`.
//
// `/status` consults the index via `findFor(key)` for whichever AuctorKey it
// holds. The webhook removes entries on terminal status (completus/fractus).

import type { AuctorKey } from '../flow/types.js'

export interface ActumIndex {
  // ─ Discriminated union mirroring AuctorKey ─────────────────────────────────
  // Exactly one of these is set per entry. Enforced by the ExecuteFlow write
  // site, which reads ctx.identity (itself an AuctorKey).
  animaId?:    string
  commitment?: string

  /** FK → Actum. The row in Actorum. */
  actumId: string
  /** FK → Modus.id. Carried for `/status`'s modusLabel display without a
   *  second join to Actorum from the read path. */
  modusId: string
  /** When the entry was recorded — typically actum.inceptum. */
  createdAt: Date
}

/**
 * ActumIndexStore — persistence for the per-AuctorKey aggregation.
 *
 * Append-on-dispatch + remove-on-terminal. The `remove` site is the completion
 * webhook (success and failure both clear). A drift-recovery sweep can prune
 * stale entries by joining against Actorum.findById — out of scope for v1.
 */
export interface ActumIndexStore {
  /** Record a new dispatched actum for this AuctorKey. Idempotent on actumId. */
  record(entry: ActumIndex): Promise<void>
  /** All entries for an AuctorKey — caller filters by Actum status if needed.
   *  Looks up by `animaId` OR `commitment` depending on the union discriminant. */
  findFor(key: AuctorKey): Promise<ActumIndex[]>
  /** Drop the entry for a finished/failed actum. Idempotent. */
  remove(actumId: string): Promise<void>
}
