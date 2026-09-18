// =============================================================================
// PARTNER USAGE — the B2B meter: one row per API call, counted against the key
// =============================================================================
//
// A post-paid customer is billed from a meter or it is billed from a guess. This is the
// meter: one row per generation call admitted on a partner API key, written at the API
// edge where the key is known, stamped with what the run actually consumed when it lands.
//
// Two-phase, and deliberately so — shaped on `ActumIndex`, which solves the same problem
// for consumer spend history and for the same reason. At admission the edge knows WHO
// called, with WHICH key, and WHAT flow; it cannot know the units, because the run has not
// run. At completion the webhook knows the units and the models, and knows nothing about
// the credential. Neither end can write the whole row, so each writes its half, joined on
// `actumId`:
//
//   record()  — apiRouter POST /v1/runs, on a partner-key caller
//   settle()  — executionWebhook, COMPLETED: units, duration, models
//   void()    — executionWebhook, FAILED/CANCELLED: the call happened, nothing is owed
//
// A voided row is RETAINED, not removed. `ActumIndex` prunes a failed run because its
// question is "what did this user spend"; the meter's question is "what did this key do",
// and a customer disputing an invoice is entitled to see the calls that were not billed as
// well as the ones that were. `sumPeriod` counts settled rows only, so a void costs nothing.
//
// IDENTITY: the row carries `animaId` (the customer) and `keyPrefix` (the credential's
// first 12 chars — the non-secret half already stored on `ApiKeyEntry`, never the key and
// never its hash). Metering a B2B account is the opposite problem from the crystal's
// anonymous rails: the customer signed an agreement naming itself, and the invoice has to
// be attributable to it.
// =============================================================================

export interface PartnerUsage {
  /** FK -> Actum. The run this call started. One row per actum; the join key both halves use. */
  actumId: string
  /** FK -> Anima. The partner account billed for this call. */
  animaId: string
  /** The first 12 chars of the API key that made the call — the stored, non-secret prefix
   *  (`ApiKeyEntry.keyPrefix`). What "counted against the key" means. */
  keyPrefix: string
  /** FK -> Modus. Which flow was invoked. Carried so the invoice can itemize without a join. */
  modusId: string
  /** When the call was admitted. The key the billing period is computed over — a call belongs
   *  to the period it was MADE in, not the period its run happened to finish in. */
  calledAt: Date

  // ── Settled half — written by the completion webhook ──────────────────────
  /** When the run completed. Presence discriminates a settled (billable) row. */
  settledAt?: Date
  /** Impetus the run cost, as a string — JSON-safe, matching `ActumIndex.impetus`'s convention.
   *  The unit of account the invoice totals. */
  impetus?: string
  /** Wall-clock execution time in milliseconds (`Actum.duratio`) — the seconds half of
   *  "model, tokens or seconds", carried raw so the customer can check our arithmetic. */
  durationMs?: number
  /** The modus label at settle (`Modus.nomen`), so the invoice renders without a second join.
   *  Falls back to `modusId` when the modus cannot be resolved. */
  modusLabel?: string
  /** FK[] -> Intella. The weights the flow ran (`Modus.intellae`) — the model half. Empty when
   *  the flow declares none (an external-API flow that carries no weights of ours). */
  models?: string[]

  // ── Void half ─────────────────────────────────────────────────────────────
  /** Set when the run failed or was cancelled: the call is recorded and is NOT billable. A row
   *  is either settled or void, never both — the webhook reaches exactly one branch. */
  voidedAt?: Date
}

/** What a period rolls up to — the figure an invoice is drawn from. */
export interface PartnerUsageRollup {
  /** Settled (billable) calls in the period. */
  calls: number
  /** Total impetus across those calls, as a string. */
  impetus: string
  /** Per-flow breakdown, the invoice's line items. Newest flows are not privileged: ordered by
   *  impetus descending so the biggest line reads first. */
  lines: Array<{ modusId: string; modusLabel: string; calls: number; impetus: string }>
}

export interface PartnerUsageStore {
  /** Record an admitted call. Idempotent on `actumId` — a retried write must not double-count. */
  record(entry: Pick<PartnerUsage, 'actumId' | 'animaId' | 'keyPrefix' | 'modusId' | 'calledAt'>): Promise<void>
  /** Stamp a row billable. Idempotent (the completion webhook is at-least-once). No-op when no
   *  row exists — most runs are not partner runs, and the webhook does not know which are. */
  settle(actumId: string, patch: { settledAt: Date; impetus: string; durationMs?: number; modusLabel: string; models: string[] }): Promise<void>
  /** Stamp a row non-billable. Idempotent; no-op when no row exists. */
  void(actumId: string, at: Date): Promise<void>
  /** Every row for this partner in `[from, to)` by `calledAt`, newest first — the customer's own
   *  read of its meter, and the evidence behind a disputed line. */
  list(animaId: string, from: Date, to: Date): Promise<PartnerUsage[]>
  /** The billable rollup for `[from, to)` — settled rows only. The query the invoice reads. */
  sumPeriod(animaId: string, from: Date, to: Date): Promise<PartnerUsageRollup>
}
