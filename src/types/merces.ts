// =============================================================================
// MERCES — the payee-payout book (ADR-0013 §4c / §6b · money OUT).
// =============================================================================
//
// "Merces" (mercedis, f.) = pay / wages / reward for service rendered. Where
// `Reditus` is the inbound-revenue face (Book 1, money IN, one company-wide
// scalar, NO identity), Merces is its mirror on the OUT side: one accrued USD
// payout WE owe a specific payee for value they produced — the agent's cut of an
// x402 pay-per-call, a creator's royalty, a referrer's commission.
//
// Two properties Reditus deliberately lacks, and this book requires:
//   • IDENTITY — every Merces names its payee (the person we pay), because the
//     tax obligation is PER PAYEE, PER YEAR (ADR-0013 §6b: ≥ $600/yr → 1099-NEC).
//   • A GATE — ADR-0013 §4c is emphatic that you cannot withhold from a payment
//     already sent to a wallet, so payouts ACCRUE INTERNALLY and are GATED: under
//     the reportable threshold they are `payable`; at/over it, without tax docs on
//     file, they are `gated` (held) until a W-9/W-8BEN is collected. The at-settle
//     on-chain split is exactly what we do NOT do.
//
// UNIT: `usdFmv` is MICRO-USD as bigint ($1 = 1_000_000n), the SAME base unit as
// Reditus — an exact integer stamped at accrual, never a float. This is the
// gross amount owed the payee for one event (the margin-minus-fee of one run).

/** The lifecycle of one payout accrual. */
export type MercesStatus =
  /** Under the reportable threshold — free to pay out. */
  | 'payable'
  /** At/over the threshold with no tax docs on file — HELD until W-9/W-8BEN (§4c). */
  | 'gated'
  /** Paid out (on-chain USDC / off-ramp). The actual disbursement is a later step. */
  | 'paid'

/**
 * Merces — one accrued payout to one payee, USD-denominated, append-only (the only
 * mutation is `status` on release/pay). The per-payee, per-tax-year sum of these is
 * what the $600 reporting gate compares against.
 */
export interface Merces {
  id: string

  /**
   * The payee's crystal identity — the owner `Anima` (resolved/minted by `custos` =
   * the payout wallet). This is the stable legal-person key the annual rollup groups
   * by; it MERGES with the person the day they link that wallet, exactly like the
   * legacy split-ledger's find-or-create-by-address, so no separate "unclaimed" book.
   */
  payeeAnimaId: string

  /** The on-chain payout target (lowercased) the accrual was keyed to — for reference
   *  and eventual disbursement (`payoutPolicy.withdrawAddress ?? ownerAddress`). */
  payoutAddress?: string

  /** USD owed the payee for this event, in MICRO-USD (bigint; $1 = 1_000_000n). MUST be
   *  > 0n (a non-positive take is never accrued — see `accruePayeePayout`). */
  usdFmv: bigint

  /** The pricing source-of-record, logged per event for auditability (mirrors Reditus). */
  fmvSource: string

  /** The calendar tax year of `natum` — the reset window for the per-payee gate (§4c). */
  taxYear: number

  /**
   * What produced this payout — e.g. `x402:<signatureHash>` (the settled payment),
   * `royalty:<actumId>`, `referral:<...>`. The IDEMPOTENCY key: at most one Merces per
   * source event, so a re-run settle / re-delivered hook never double-accrues.
   */
  sourceRef: string

  /** The kind of earning, for expense categorization + the 1099 line. */
  kind: 'agent' | 'royalty' | 'referral'

  status: MercesStatus

  /** "natum" = born — the moment the payout was earned (the settlement time). */
  natum: Date
}

/** The fields a caller supplies to accrue a Merces; id/status/taxYear struck by the accrual. */
export type MercesDraft = Omit<Merces, 'id' | 'status' | 'taxYear' | 'natum'> & { natum?: Date }

/**
 * Mercedum ("of the wages" — genitive plural, matching Signorum / Redituum) — the
 * payee-payout book store. Append-mostly: `accrue` writes a row; `setStatus` is the
 * only mutation (release a gated row once docs land, mark paid on disbursement).
 */
export interface Mercedum {
  /**
   * Accrue one payout row. FAIL-CLOSED: throws if usdFmv ≤ 0 or fmvSource empty.
   * IDEMPOTENT on `sourceRef`: a second accrual for the same source event returns the
   * existing row unchanged (a re-settled x402 payment must not double-pay the agent).
   * The caller (`accruePayeePayout`) sets `status` from the gate; the store persists it.
   */
  accrue(draft: MercesDraft, status: MercesStatus): Promise<Merces>

  /** One row by id. */
  find(id: string): Promise<Merces | null>

  /**
   * The payee's cumulative accrued payout (micro-USD) for one calendar tax year — the
   * scalar the $600 reporting gate compares against (ADR-0013 §6b). Sums ALL statuses
   * (payable + gated + paid): the reporting obligation is on total earnings, not on what
   * has been disbursed. A real grouped range-sum.
   */
  annualTotal(payeeAnimaId: string, taxYear: number): Promise<bigint>

  /** Release a gated row (docs collected) or mark one paid (disbursed). */
  setStatus(id: string, status: MercesStatus): Promise<void>

  /** The payee's rows for one year, newest first — the per-payee statement / 1099 backing. */
  listByPayee(payeeAnimaId: string, taxYear: number): Promise<Merces[]>
}
