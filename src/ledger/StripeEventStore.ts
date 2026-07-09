// =============================================================================
// StripeEventStore — the fiat webhook idempotency guard (dedup on the payment key)
// =============================================================================
//
// Stripe redelivers webhooks (at-least-once). Crediting impetus is NOT idempotent on
// its own (a fiat `Reditus` carries no `depositumId`, so the revenue book appends every
// call), so a naive handler double-credits on redelivery. This store is the fiat analogue
// of the crypto `Depositum` status machine — SELF-CONTAINED, keyed on the PAYMENT KEY:
// at-most-one credit per payment, and a redelivery returns the ORIGINAL recorded outcome.
//
// KEY CHOICE — the payment_intent id, NOT the event id. One purchase emits TWO webhook
// events (`checkout.session.completed` AND `payment_intent.succeeded`) that share one
// payment_intent; keying on that id collapses both to a SINGLE credit. Keying on the event
// id would credit a single purchase twice. (This memory claim is the fast, atomic in-process
// gate; the durable cross-instance backstop is the `Signum.testis` unique-per-payment value —
// the handler checks the ledger for an existing `stripe:<paymentKey>` signum before issuing.)
//
// PROTOCOL (three-phase, so a mid-credit crash is retryable, never double-credited):
//   1. `claim(key)` — atomically stake the payment.
//        · 'claimed'          → first delivery; the caller proceeds to credit.
//        · { done: outcome }  → already fully processed; the caller returns the outcome (no-op).
//        · 'in_flight'        → a concurrent delivery staked it but has not finished; decline
//                               to re-credit (the other delivery is crediting).
//   2. `finish(key, outcome)` — mark done + persist the outcome (idempotent replay source).
//   3. `abort(key)` — release the claim so a redelivery can retry (call on credit failure).
//
// The claim/finish/abort trio is the analogue of Depositum's confirmatum→processatum
// transition. This memory impl proves the contract: node's single-writer event loop makes
// `claim` atomic (no `await` precedes the Map write, so two concurrent claims can't both win).
// A durable multi-instance deployment hardens `claim` with a unique index on the payment key
// (an atomic insert-or-conflict) — a go-live persistence step, mirrored on this interface.
// =============================================================================

/** The recorded result of a fully-processed payment — replayed verbatim on redelivery. */
export interface StripeEventOutcome {
  /** The impetus credited (0n if the event was an ignorable/no-credit type). */
  credited: bigint
  /** The Signum id struck for the credit (absent for a no-credit event). */
  signumId?: string
  /** The packId that was credited (absent for a no-credit event). */
  packId?: string
}

/** The result of staking a claim on a payment key. */
export type StripeClaim =
  | 'claimed'
  | 'in_flight'
  | { done: StripeEventOutcome }

/** The idempotency dedup store for Stripe payments (keyed on the payment_intent id). */
export interface StripeEventStore {
  /** Atomically stake a claim on the payment `key` (see PROTOCOL). */
  claim(key: string): Promise<StripeClaim>
  /** Mark the payment `key` fully processed and persist its outcome (idempotent replay source). */
  finish(key: string, outcome: StripeEventOutcome): Promise<void>
  /** Release a claimed-but-unfinished `key` so a redelivery can retry (call on failure). */
  abort(key: string): Promise<void>
}

interface Row {
  status: 'in_flight' | 'done'
  outcome?: StripeEventOutcome
}

/**
 * In-memory `StripeEventStore`. The single-writer node event loop makes `claim` atomic
 * (the check-and-set never interleaves), exactly as `MemorySignorum`/`MemoryRedituum`
 * prove their contracts. The real store is Mongo (a unique index on the payment key makes the
 * insert atomic across instances) — this Map impl is the contract of record.
 */
export class MemoryStripeEventStore implements StripeEventStore {
  private readonly rows = new Map<string, Row>()

  async claim(key: string): Promise<StripeClaim> {
    const existing = this.rows.get(key)
    if (existing) {
      if (existing.status === 'done') return { done: existing.outcome! }
      return 'in_flight'
    }
    this.rows.set(key, { status: 'in_flight' })
    return 'claimed'
  }

  async finish(key: string, outcome: StripeEventOutcome): Promise<void> {
    this.rows.set(key, { status: 'done', outcome })
  }

  async abort(key: string): Promise<void> {
    const existing = this.rows.get(key)
    // Only release a still-in-flight claim; never un-finish a completed (credited) payment.
    if (existing && existing.status === 'in_flight') this.rows.delete(key)
  }
}
