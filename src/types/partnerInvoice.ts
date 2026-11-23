// =============================================================================
// PARTNER INVOICE — a billing period's meter, priced, issued, and paid
// =============================================================================
//
// One row per (partner, period). It is drawn from `PartnerUsageStore.sumPeriod` and carries
// its own copy of that rollup: an invoice is a statement of what was owed WHEN IT WAS
// ISSUED, and re-deriving it later from a meter that has since been stamped by late-landing
// runs would quietly restate a bill the customer already paid. So the meter is the source
// and the invoice is the receipt, and `lines` is the receipt's evidence.
//
// WHERE THE MONEY LANDS. Paying an invoice books a `Reditus` — USD revenue recognized at
// receipt (ADR-0013 §2) — and issues NO `Signum`. That is the whole of "apart from consumer
// credits": a consumer's Stripe payment buys a credit pack and lands as impetus the buyer
// can spend; a B2B customer's payment settles a debt for compute already delivered and lands
// as revenue only. The two rails share the Stripe boundary and nothing else, and
// `stripeWebhook.ts` is where that fork is enforced.
//
// `chargeRef` (the Stripe payment_intent) is the idempotency key on both sides: the same key
// that makes the `Reditus` at-most-once also makes marking this invoice paid at-most-once,
// so a redelivered webhook cannot double-book revenue or double-stamp the invoice.
// =============================================================================

import type { PartnerUsageRollup } from './partnerUsage.js'

export type PartnerInvoiceStatus =
  /** Issued, unpaid. */
  | 'open'
  /** Paid in full; `paidAt` and `chargeRef` are set. */
  | 'paid'
  /** Withdrawn without payment (issued in error, or written off). Never becomes 'paid'. */
  | 'void'

export interface PartnerInvoice {
  id: string
  /** FK -> Anima. The partner billed. */
  animaId: string
  /** The legal entity billed, copied from `Partner.billing.billedTo` at issue — the invoice
   *  states who was billed at the time, which a later edit to the billing account must not
   *  rewrite. Same reasoning for `billingEmail`. */
  billedTo: string
  billingEmail: string

  /** The period billed, half-open: `[periodStart, periodEnd)` over `PartnerUsage.calledAt`. */
  periodStart: Date
  periodEnd: Date

  /** The meter rollup this invoice was drawn from, frozen at issue. */
  usage: PartnerUsageRollup
  /** Amount due in MICRO-USD as a string (bigint through JSON), priced from `usage.impetus`
   *  at `MICRO_USD_PER_IMPETUS` — the platform's canonical rate, read from code, never typed
   *  here. A string for the same reason `impetus` is one. */
  usdMicro: string

  status: PartnerInvoiceStatus
  issuedAt: Date
  /** When payment is due — `issuedAt` + `Partner.billing.netDays`, frozen at issue. */
  dueAt: Date
  /** When payment landed. Set only with `status: 'paid'`. */
  paidAt?: Date
  /** The Stripe payment_intent that paid it — the idempotency key shared with the `Reditus`
   *  this payment booked. Set only with `status: 'paid'`. */
  chargeRef?: string
}

export interface PartnerInvoiceStore {
  /** Issue an invoice. Refuses a second OPEN OR PAID invoice for the same (animaId, period) —
   *  a period is billed once, and a re-issue after a mistake goes through `setStatus('void')`
   *  first. Throws on the collision rather than returning the existing row: issuing is a
   *  deliberate act and silently handing back an older bill hides the mistake. */
  issue(input: Omit<PartnerInvoice, 'id' | 'status' | 'issuedAt'> & { issuedAt?: Date }): Promise<PartnerInvoice>
  find(id: string): Promise<PartnerInvoice | null>
  /** This partner's invoices, newest issued first. */
  list(animaId: string, filter?: { status?: PartnerInvoiceStatus }): Promise<PartnerInvoice[]>
  /**
   * Mark an invoice paid. IDEMPOTENT ON `chargeRef`: called again with the same charge it is a
   * no-op returning the already-paid row, which is what makes a redelivered Stripe webhook
   * safe. Called with a DIFFERENT charge against an already-paid invoice it throws — two
   * distinct payments for one invoice is a fact someone has to look at, not a fact to absorb.
   * Refuses a voided invoice.
   */
  markPaid(id: string, paidAt: Date, chargeRef: string): Promise<PartnerInvoice>
  /** Withdraw an unpaid invoice. Refuses a paid one. */
  setStatus(id: string, status: Extract<PartnerInvoiceStatus, 'void'>): Promise<PartnerInvoice>
}
