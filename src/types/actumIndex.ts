// =============================================================================
// ActumIndex — per-anima aggregation of dispatched actums
// =============================================================================
//
// The crystal privacy invariant: actum/modo rows carry NO identity columns
// (modo → actum.nullifier → signum(arcanum) → signum(deposit) → anima is the
// only chain back to identity). That keeps the data layer clean, but it leaves
// `/status` with nothing to answer "what gens does THIS user have in flight?"
// without violating the invariant.
//
// ActumIndex is an explicit, separate aggregation collection — not metadata on
// the actum row. It writes from `ExecuteFlow` when the trace already carries
// an animaId (i.e. identified runs only). The `/status` aggregator queries it
// to populate the YOUR GENS section + wire per-row Cancel. Anonymous
// (commitment) runs are deliberately not indexed — anonymous queue browsing is
// a separate Phase concern that needs its own privacy story.

export interface ActumIndex {
  /** The runner — identified anima only. */
  animaId: string
  /** FK → Actum. The row in Actorum. */
  actumId: string
  /** FK → Modus.id. Carried for `/status`'s modusLabel display without a
   *  second join to Actorum from the read path. */
  modusId: string
  /** When the entry was recorded — typically actum.inceptum. */
  createdAt: Date
}

/**
 * ActumIndexStore — persistence for the per-anima aggregation.
 *
 * Append-on-dispatch + remove-on-terminal. The `remove` site is the completion
 * webhook (success and failure both clear). A drift-recovery sweep can prune
 * stale entries by joining against Actorum.findById — out of scope for v1.
 */
export interface ActumIndexStore {
  /** Record a new dispatched actum for this anima. Idempotent on actumId. */
  record(entry: ActumIndex): Promise<void>
  /** All entries for an anima — caller filters by Actum status if needed. */
  findFor(animaId: string): Promise<ActumIndex[]>
  /** Drop the entry for a finished/failed actum. Idempotent. */
  remove(actumId: string): Promise<void>
}
