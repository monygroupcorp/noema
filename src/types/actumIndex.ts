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

  // ─ Released stamp — set only once the run terminates as `fractus` (failure/cancel) ─
  // Mirrors the settled stamp above, but for the OTHER terminal outcome: signa released,
  // nothing charged. A `fractus` run is still NOT spend (sumSettledImpetus/listSettled are
  // untouched by this), but it is the other half of "what happened to my hold" — without it,
  // a failed run simply vanishes from the owner's history the instant it is pruned, which is
  // the same "reservation reads as credits gone" complaint this stamp exists to retire.
  /** When the run released (from `actum.completum` on the fail path). Presence discriminates
   *  a released row from an in-flight or settled one; `listReleased` filters + paginates on it. */
  releasedAt?: Date
}

/**
 * ActumIndexStore — persistence for the per-AuctorKey aggregation.
 *
 * Append-on-dispatch + settle/release-on-terminal (or remove, on a store that predates
 * those). The stamping site is `ActumCompletor.complete()`/`fail()` — the one choke point
 * every completion rail (the RunPod webhook, a sync cursor, the expiry reaper, the
 * warm-pod line, an owner cancel) reaches, so none of them can leave a row stuck
 * in-flight the way only the webhook used to clear it. A drift-recovery sweep that prunes
 * stale entries by joining against Actorum.findById would still catch a row from a
 * deployment predating this (or a write that threw past its `.catch`) — not built, since
 * the choke point above already closes the gap it would otherwise exist to cover.
 */
export interface ActumIndexStore {
  /** Record a new dispatched actum for this AuctorKey. Idempotent on actumId. */
  record(entry: ActumIndex): Promise<void>
  /** In-flight entries for an AuctorKey (settled AND released rows excluded). Looks up by
   *  `animaId` OR `commitment` depending on the union discriminant. Bounded to the owner's
   *  active runs — settled spend history lives behind `listSettled`/`sumSettledImpetus`,
   *  released history behind `listReleased`, never here (both `/status` and the GDPR export
   *  depend on this staying in-flight-only). */
  findFor(key: AuctorKey): Promise<ActumIndex[]>
  /** Drop the entry for a finished/failed actum. Idempotent. */
  remove(actumId: string): Promise<void>

  /**
   * Identity fallback (noema-044): look up the AuctorKey-bearing entry for a single
   * actumId, independent of the caller already knowing the AuctorKey. The completion
   * webhook uses this when `flowRouter` has no FlowContext for the actum (e.g. a run
   * fired directly via `POST /v1/runs`, which never creates one) — ActumIndex is the
   * sanctioned identity source for that case (see file doc). Optional so stores/doubles
   * that don't need the fallback (or predate it) aren't forced to implement it; the
   * webhook degrades to its pre-existing unindexed behavior when absent or null.
   */
  findByActumId?(actumId: string): Promise<ActumIndex | null>

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

  /**
   * Retain-on-release: mirrors `settle` for the OTHER terminal outcome. Stamps the EXISTING
   * row released (`releasedAt` + `modusLabel`) in place instead of removing it, so a failed/
   * cancelled run stays visible as "released, nothing charged" rather than vanishing. Keyed
   * by `actumId`; idempotent (the webhook is at-least-once). No-op if the row is already gone.
   * Optional, same as `settle` — a store that omits it keeps the pre-existing prune behaviour
   * (the fail path falls back to `remove`).
   */
  release?(actumId: string, patch: { releasedAt: Date; modusLabel: string }): Promise<void>
  /**
   * Owner-scoped, cursor-paginated, released-only listing (newest released first) — the
   * `listSettled` twin for the released half of terminal history. `[]` for a bursaToken key.
   */
  listReleased?(key: AuctorKey, opts: { limit: number; cursor?: string }): Promise<{ entries: ActumIndex[]; nextCursor?: string }>
}
