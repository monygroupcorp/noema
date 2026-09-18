// =============================================================================
// partnerInvoicing — draw a B2B invoice from the meter, and price it
// =============================================================================
//
// The seam between `PartnerUsageStore` (what the keys did) and `PartnerInvoiceStore` (what
// is owed for it). Two functions and no state:
//
//   priceImpetus  — impetus → micro-USD, at the platform's canonical rate
//   draftInvoice  — (partner, period) → an issued invoice, drawn from the meter
//
// PRICE. `MICRO_USD_PER_IMPETUS` is the rate the consumer side buys credits at, and a B2B
// customer is billed the same list price for the same compute. It is READ from
// `ledger/rates.ts`, not restated here: a rate typed twice is a rate that will disagree with
// itself, and this is the multiplication that decides what a customer owes. Exact bigint
// throughout — impetus × 337 has no rounding step, and is why both figures are integers in
// their minor unit rather than floats (the same discipline `Reditus.usdFmv` follows).
//
// A discount, a committed-volume tier, or a per-customer rate is not modelled and is not
// smuggled in as a default: today every partner is billed at list, and the invoice says so
// by carrying the rate's own output rather than a number somebody typed.
// =============================================================================

import type { PartnerBilling } from '../types/partner.js'
import type { PartnerInvoice, PartnerInvoiceStore } from '../types/partnerInvoice.js'
import type { PartnerUsageStore } from '../types/partnerUsage.js'
import { MICRO_USD_PER_IMPETUS } from './rates.js'

/** Micro-USD in one cent. Not a dial — it is what "micro" and "cent" mean. */
const MICRO_USD_PER_CENT = 10_000n

/**
 * Impetus → micro-USD at the platform's canonical list rate, rounded UP to the whole cent.
 *
 * The multiplication is exact; the rounding is there because an invoice is settled in cents. An
 * amount stated in sub-cent micro-USD cannot be charged, and charging a rounded figure while
 * booking the unrounded one would make recognized revenue differ from cash received by a
 * fraction of a cent per invoice — a reconciliation problem that grows a row at a time. So the
 * invoice IS whole cents, and revenue and cash are the same number by construction.
 *
 * Ceil rather than nearest, following `impetusForPodMs`'s discipline in `rates.ts`: the rounding
 * step is the platform's, and it does not round in the platform's disfavour. The most it can add
 * to any one invoice is one cent.
 */
export function priceImpetus(impetus: bigint): bigint {
  const exact = impetus * MICRO_USD_PER_IMPETUS
  const remainder = exact % MICRO_USD_PER_CENT
  return remainder === 0n ? exact : exact + (MICRO_USD_PER_CENT - remainder)
}

/** Micro-USD → the whole cents Stripe charges. Exact for any `priceImpetus` output. */
export function usdMicroToCents(usdMicro: bigint): number {
  return Number(usdMicro / MICRO_USD_PER_CENT)
}

export interface DraftInvoiceDeps {
  usage: PartnerUsageStore
  invoices: PartnerInvoiceStore
}

export interface DraftInvoiceInput {
  animaId: string
  billing: PartnerBilling
  /** Half-open `[periodStart, periodEnd)` over `PartnerUsage.calledAt`. */
  periodStart: Date
  periodEnd: Date
  /** Defaults to now. Explicit in tests, and the base `dueAt` is computed from. */
  issuedAt?: Date
}

/**
 * Issue one invoice for one partner's one period, drawn from the meter.
 *
 * Issues even when the rollup is EMPTY. A zero invoice is a statement that the period was
 * billed and came to nothing, which is a different fact from a period nobody has billed yet —
 * and the store's once-per-period refusal is what makes the distinction hold. A caller that
 * does not want to send a customer a $0 invoice can check `usage.calls` on the result; that is
 * a decision about what to mail, not about what the books say.
 */
export async function draftInvoice(deps: DraftInvoiceDeps, input: DraftInvoiceInput): Promise<PartnerInvoice> {
  const issuedAt = input.issuedAt ?? new Date()
  const usage = await deps.usage.sumPeriod(input.animaId, input.periodStart, input.periodEnd)
  const dueAt = new Date(issuedAt.getTime() + input.billing.netDays * 24 * 60 * 60 * 1000)
  return deps.invoices.issue({
    animaId: input.animaId,
    billedTo: input.billing.billedTo,
    billingEmail: input.billing.billingEmail,
    periodStart: input.periodStart,
    periodEnd: input.periodEnd,
    usage,
    usdMicro: priceImpetus(BigInt(usage.impetus)).toString(),
    issuedAt,
    dueAt,
  })
}
