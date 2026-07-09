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
// holds. `findFor` is IN-FLIGHT ONLY: on terminal SUCCESS (`completus`) the webhook
// RETAINS the row and stamps it settled (`settle`), but `findFor` filters settled
// rows OUT, so it keeps returning only the small in-flight (`nascens|agens`) set it
// always did. That keeps `/status`'s per-row `actorum.findById` fan-out bounded and
// leaves the GDPR export payload unchanged. Settled rows are queryable spend history
// (noema-026) EXCLUSIVELY through `listSettled` / `sumSettledImpetus`. A `fractus`
// (failed/refunded) run is NOT spend, so that branch still prunes (`remove`).

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

  // ─ Settled stamp (noema-026) — set only once the run terminates as `completus` ─
  // These make the row a durable spend-history record queryable by its owner. They
  // add NO new owner↔anonymous-half linkage: the row already keys on animaId|commitment
  // and already carries actumId + modusId; these are attributes of that same, already
  // owner-linked actum (the owner's own spend), not a join to any foreign anonymous row.
  /** When the run settled (from `actum.completum`). Presence discriminates a settled row
   *  from an in-flight one; the settled listing filters + paginates on it. */
  settledAt?: Date
  /** Impetus (points) the run cost, serialised as a string — JSON-safe and consistent with
   *  the public `Run.cost` convention (a bigint would break JSON serialisation of the row,
   *  e.g. in the GDPR export). Stamped from `actum.impetus`. */
  impetus?: string
  /** The modus label (`Modus.nomen`) at settle, so the spend list renders without a second
   *  join. Falls back to `modusId` when the modus can't be resolved. */
  modusLabel?: string
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
  /** In-flight entries for an AuctorKey (settled rows excluded). Looks up by `animaId`
   *  OR `commitment` depending on the union discriminant. Bounded to the owner's active
   *  runs — settled spend history lives behind `listSettled`/`sumSettledImpetus`, never
   *  here (both `/status` and the GDPR export depend on this staying in-flight-only). */
  findFor(key: AuctorKey): Promise<ActumIndex[]>
  /** Drop the entry for a finished/failed actum. Idempotent. */
  remove(actumId: string): Promise<void>

  // ─ Settled spend-history (noema-026) — optional so in-memory/dev doubles that ─
  // don't retain simply keep pruning via `remove`. Production (MongoActumIndex)
  // implements all three; `CrystalApi.listRuns` degrades to an empty page when a
  // wired store lacks them.
  /**
   * Retain-on-settle: stamp the EXISTING row terminal (settledAt + cost + label) in place,
   * instead of removing it. Keyed by `actumId`, so it needs no AuctorKey and preserves the
   * original owner key untouched. Idempotent (the completion webhook is at-least-once — a
   * repeat call re-stamps the same values). No-op if the row is already gone.
   */
  settle?(actumId: string, patch: { settledAt: Date; impetus: string; modusLabel: string }): Promise<void>
  /**
   * Owner-scoped, cursor-paginated, settled-only listing (newest settled first). Paginated
   * at the DB — never loads the whole history into memory. `cursor` is the opaque token a
   * prior page returned; omit for the first page. Returns `[]` for a bursaToken key (those
   * runs are never indexed). Owner-scoping is the index key itself — foreign owners' rows
   * are unreachable, mirroring how `/status` lists in-flight gens via `findFor`.
   */
  listSettled?(key: AuctorKey, opts: { limit: number; cursor?: string }): Promise<{ entries: ActumIndex[]; nextCursor?: string }>
  /** Lifetime sum of settled impetus for the owner, serialised as a string — the running
   *  total. Owner-scoped by the index key; `'0'` when there is no settled history. */
  sumSettledImpetus?(key: AuctorKey): Promise<string>
}
