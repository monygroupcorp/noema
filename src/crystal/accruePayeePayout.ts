// =============================================================================
// accruePayeePayout — the §4c payout gate (ADR-0013), + the x402 margin split.
// =============================================================================
//
// The one place a payout to a person is recognized. It replaces the old at-settle
// "auto-split" (a 5% reward-signa skim) with the tax-correct ACCRUE-AND-GATE model
// ADR-0013 §4c mandates: money OUT is booked to a per-payee, per-year Merces ledger,
// and HELD once the payee crosses the US $600/yr reporting line without tax docs on
// file (a 1099-NEC obligation). Nothing is sent on-chain here — disbursement is a
// separate, gated step. The agent's x402 cut is the first caller; creator royalties
// and referral commissions are meant to route through the SAME gate (§4c).
//
// Money model (the agent's cut of one pay-per-call, per the owner's margin rule):
//   price   = what the caller paid (USDC atomic == micro-USD)
//   serve   = OUR cost to serve = impetus × MICRO_USD_PER_IMPETUS
//   margin  = price − serve                         (0 if the price didn't clear cost)
//   fee     = margin × PLATFORM_FEE_ON_MARGIN_BPS   (our skim from the margin)
//   take    = margin − fee                          (the agent's earning → accrued)

import type { AnimaStore } from '../types/anima.js'
import type { Merces, Mercedum, MercesStatus } from '../types/merces.js'

/** Micro-USD per impetus point — the integer form of `IMPETUS_USD_RATE` (0.000337 × 1e6),
 *  kept local so this module is self-contained. $1 = 1_000_000 micro-USD. */
const MICRO_USD_PER_IMPETUS = 337n

/** US 1099-NEC reporting line — $600/payee/calendar-year (ADR-0013 §6b). */
export const REPORTABLE_THRESHOLD_MICRO_USD = 600_000_000n
/** Pre-crossing alert band — 90% of the line ($540), so ops can collect a W-9 early. */
export const WATCH_BAND_MICRO_USD = 540_000_000n
/** Our fee on the agent's margin (2000 = 20% to us, 80% to the agent). Config default. */
export const PLATFORM_FEE_ON_MARGIN_BPS = 2000n

export type PayeeBand = 'clear' | 'watch' | 'reportable'
export function bandFor(annualMicro: bigint): PayeeBand {
  if (annualMicro >= REPORTABLE_THRESHOLD_MICRO_USD) return 'reportable'
  if (annualMicro >= WATCH_BAND_MICRO_USD) return 'watch'
  return 'clear'
}

/** The agent's take of one settled pay-per-call, in micro-USD (0 if the price didn't clear cost). */
export function agentCutMicro(priceMicro: bigint, serveImpetus: bigint, feeBps: bigint = PLATFORM_FEE_ON_MARGIN_BPS): bigint {
  const serveMicro = serveImpetus * MICRO_USD_PER_IMPETUS
  const margin = priceMicro - serveMicro
  if (margin <= 0n) return 0n
  const fee = (margin * feeBps) / 10000n
  return margin - fee
}

export interface AccruePayeeDeps {
  mercedum: Mercedum
  animae: Pick<AnimaStore, 'findByCustos' | 'create'>
  /** Does the payee have a W-9/W-8BEN on file? Default: no one does (everything gates at $600). */
  hasTaxDocs?: (payeeAnimaId: string) => Promise<boolean>
  /** Fired when this accrual pushed the payee into a higher band (watch/reportable). Ops seam —
   *  wire to alerting / a W-9-request flow later; unset = no-op. */
  onBand?: (ev: { payeeAnimaId: string; payoutAddress: string; prev: bigint; next: bigint; band: PayeeBand; taxYear: number }) => void
}

export interface AccruePayeeInput {
  /** The on-chain payout target — `payoutPolicy.withdrawAddress ?? ownerAddress`, lowercased. */
  payoutAddress: string
  /** The amount owed the payee for this event, in micro-USD (> 0; ≤ 0 is skipped). */
  usdMicro: bigint
  /** Pricing source-of-record (audit). */
  fmvSource: string
  /** Idempotency key for the source event (e.g. `x402:<signatureHash>`). */
  sourceRef: string
  kind: Merces['kind']
  at?: Date
}

export type AccrueOutcome =
  | { status: 'accrued'; merces: Merces; gated: boolean; annualTotal: bigint }
  | { status: 'skipped'; reason: string }

/** Accrue one payout to a payee, applying the $600 gate + band tripwire (ADR-0013 §4c). */
export async function accruePayeePayout(deps: AccruePayeeDeps, input: AccruePayeeInput): Promise<AccrueOutcome> {
  if (input.usdMicro <= 0n) return { status: 'skipped', reason: 'non-positive take' }
  const addr = input.payoutAddress.toLowerCase()
  if (!/^0x[0-9a-f]{40}$/.test(addr)) return { status: 'skipped', reason: 'invalid payout address' }

  // Resolve (or mint) the payee's Anima by custos = payout wallet. Rewards accrue on a
  // wallet-keyed Anima and MERGE when the owner links it — the same find-or-create-by-custos
  // as the legacy split-ledger, so no separate "unclaimed" book (mirrors ownerReward's design).
  const anima = (await deps.animae.findByCustos(addr)) ?? (await deps.animae.create({ nomen: `payee:${addr}`, custos: addr }))
  const at = input.at ?? new Date()
  const taxYear = at.getUTCFullYear()

  const prev = await deps.mercedum.annualTotal(anima.id, taxYear)
  const next = prev + input.usdMicro

  // The §4c gate: at/over the reportable line with no tax docs → HOLD (gated); else payable.
  const hasDocs = deps.hasTaxDocs ? await deps.hasTaxDocs(anima.id) : false
  const gated = next >= REPORTABLE_THRESHOLD_MICRO_USD && !hasDocs
  const status: MercesStatus = gated ? 'gated' : 'payable'

  // Idempotent on sourceRef: a re-settled payment returns the existing row (no double-accrual).
  const merces = await deps.mercedum.accrue(
    { payeeAnimaId: anima.id, payoutAddress: addr, usdFmv: input.usdMicro, fmvSource: input.fmvSource, sourceRef: input.sourceRef, kind: input.kind, natum: at },
    status,
  )

  // Band-crossing alert — recompute the ACTUAL post-accrual total so an idempotent re-run
  // (which wrote nothing) does not re-fire the band.
  const annualTotal = await deps.mercedum.annualTotal(anima.id, taxYear)
  if (deps.onBand && annualTotal > prev && bandFor(annualTotal) !== bandFor(prev)) {
    deps.onBand({ payeeAnimaId: anima.id, payoutAddress: addr, prev, next: annualTotal, band: bandFor(annualTotal), taxYear })
  }

  return { status: 'accrued', merces, gated, annualTotal }
}
