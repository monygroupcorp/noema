// =============================================================================
// REDITUS — the USD revenue book (inbound face of the ADR-0013 financial ledger)
// =============================================================================
//
// "reditus" = a return, income, revenue that flows back (Latin, 4th declension
// masculine: reditus, reditus, ... genitive plural reditŭum). One Reditus row is
// struck per confirmed inbound payment, denominated in USD.
//
// This is DISTINCT from Signum (the credit ledger). Credits ≠ dollars — ADR-0013 §1
// is explicit that the internal impetus balance is NOT USD revenue recognized. Signum
// answers "what can this user spend?"; Reditus answers "what USD revenue did we
// recognize, trailing twelve months?" — the number the Krea/Stability conditional-
// license caps (ADR-0012) and the tax posture (ADR-0013 §5) are measured against.
//
// SCOPE: this is only the INBOUND-REVENUE face (Book 1) of ADR-0013's USD financial
// ledger — no per-lot cost basis, no realized gain/loss (that is ADR-0013 §3, a
// separate book). When the full ledger is built, Reditus is its inbound projection,
// NOT a parallel store. See docs/spec/conditional-license-revenue.md.
//
// UNIT: usdFmv is MICRO-USD as bigint (1 unit = $0.000001), mirroring how Signum
// carries value in integer base units. A compliance tripwire summed against a $1M
// cap must not accumulate floating-point drift, so USD is an exact integer minor
// unit, never a float. $1 = 1_000_000n; the Krea $1M cap = 1_000_000_000_000n.
//
// FAIL-CLOSED (ADR-0013 §2, §consequences): no inbound payment is recorded without a
// priced usdFmv AND a logged fmvSource. A deposit whose FMV cannot be priced is a hard
// error on the deposit path — never a silent zero. Enforced in the store's record().
//
// WHERE IT IS WRITTEN (the real crystal seam): a Reditus is struck as a PEER of the Signum
// issuance at the deposit-confirmation boundary — today the Alchemy webhook handlers in
// `src/api/webhooks/alchemyWebhook.ts` (which already write a `Depositum` + issue the eth
// Signum + hold the `AssetPricer`), and any future fiat/Stripe handler. It is NOT a Nexus
// hook: Nexus hooks are pure (event in → signa out, no DB writes) and `deposit_confirmed`
// is currently emitted nowhere. Revenue is recognized at RECEIPT (deferred-revenue design,
// ADR-0013 §4) — so a Reditus is written even when the funder's Anima is not yet linked.
// It is NOT written for OFAC-quarantined (`fractum`) deposits — no value is recognized on
// funds we refuse to credit.
//
// RELATION TO Depositum: distinct books, not a merge (ADR-0013 §1 "two ledgers, not one").
// Depositum = on-chain deposit tracking (per-tx, wei, a credit-issuance status machine,
// crypto-only, mutable). Reditus = USD revenue recognized (append-only, USD, crypto AND
// fiat). A crypto Reditus carries `depositumId` back to its on-chain record for
// reconciliation and to make recording idempotent under webhook re-delivery; a fiat Reditus
// has none. usdFmv is derived from the deposit's wei × the FMV price (ADR-0013 §2), never
// the raw wei valor.
//
// ANONYMOUS-IN-AGGREGATE (ADR-0013 §7): anonymous ZK/Bursa deposits still write a
// Reditus. There is deliberately NO identity field — Reditus is a top-line aggregate;
// anonymity limits per-user reporting, never the revenue/cap/tax totals. Per-owner
// attribution for royalty payouts is a SEPARATE concern (ADR-0013 §6), not this book.
//
// GROSS, NOT NETTED (ADR-0013 §4b): usdFmv is the gross purchase amount. The referral
// 5% is a downstream commission EXPENSE, not a revenue reduction — the cap counts gross.
// =============================================================================

/** Where an inbound payment came from. Crypto is already reduced to USD FMV at the stamp. */
export type RevenueOrigo = 'crypto' | 'fiat'

/**
 * Reditus — one confirmed inbound payment, USD-denominated. Append-only, immutable
 * (like Signum, the store exposes no update). Revenue = sum of usdFmv over a window.
 */
export interface Reditus {
  id: string

  /**
   * "natum" = born — the RECEIPT time (crypto: block time; fiat: charge time). This is
   * the key the trailing-12-month window is computed over, so it is the moment of
   * economic receipt, NOT the moment the row was written.
   */
  natum: Date

  /**
   * USD fair-market-value AT RECEIPT, in MICRO-USD (bigint; $1 = 1_000_000n). For crypto
   * this is the FMV at block time (ADR-0013 §2) — the single number that doubles as the
   * revenue amount (Book 1) and, in the full ledger, the asset's cost basis (Book 2).
   * MUST be > 0n — a $0 stamp means "could not price", which is a fail-closed error.
   */
  usdFmv: bigint

  /**
   * The price oracle / source-of-record used to derive usdFmv, logged per event for
   * auditability (ADR-0013 §2, §consequences item 5). MUST be non-empty. Free-form id
   * of the chosen source (e.g. a named oracle + block, a Stripe charge id for fiat).
   */
  fmvSource: string

  /** crypto (ETH/token deposit, incl. anon ZK/Bursa) vs fiat (Stripe, etc.). */
  origo: RevenueOrigo

  /**
   * FK → Depositum. Present on crypto rows — links this recognized-revenue row back to its
   * on-chain deposit record for reconciliation, and is the IDEMPOTENCY key: at-most-one
   * Reditus per Depositum, so a re-delivered webhook does not double-count revenue. Absent
   * on fiat rows (which have no Depositum; use their own provider charge id in fmvSource).
   */
  depositumId?: string
}

/** The fields a caller supplies to record a Reditus; id is struck by the store. natum defaults to now. */
export type ReditusDraft = Omit<Reditus, 'id' | 'natum'> & { natum?: Date }

/**
 * Redituum ("of the revenues" — genitive plural, matching Signorum) — the USD revenue
 * book store. Append-only: the only write is record(); the only read the cap needs is
 * the trailing-12-month rollup (ADR-0013 §5).
 */
export interface Redituum {
  /**
   * Strike one revenue row for a confirmed inbound payment. FAIL-CLOSED: throws if usdFmv
   * is not a positive priced amount or fmvSource is empty — no deposit is recorded without
   * both (ADR-0013 §2). Anonymous deposits are recorded normally (no identity is carried).
   * IDEMPOTENT on `depositumId`: if a row already exists for that Depositum, the existing row
   * is returned unchanged (webhook re-delivery must not double-count). Draws with no
   * depositumId (fiat) are always appended.
   */
  record(draft: ReditusDraft): Promise<Reditus>

  /**
   * Total USD revenue (micro-USD) over the trailing twelve months ending at `now` — the
   * window (now − 12 months, now]. The Krea-cap tripwire and a tax primitive (ADR-0013 §5).
   * A real range-sum, not a manual reconstruction.
   */
  trailingUsdRevenue(now: Date): Promise<bigint>
}

/** One US dollar in the micro-USD base unit. Multiply human dollars by this to get usdFmv. */
export const USD = 1_000_000n
