// =============================================================================
// stripePacks — the fiat credit-pack catalog (server-authoritative)
// =============================================================================
//
// The fiat funding rail sells DISCRETE credit packs, not a $-amount field. Each
// pack maps to a fixed impetus credit and a fixed USD price. These are ratified
// PLATFORM CONSTANTS (pricing-reconciliation 2026-07-08) — the credited impetus is
// a locked constant, NOT derived from `pointsPerUsd`/`IMPETUS_USD_RATE`. Fiat is
// USD with NO funding haircut (unlike the crypto deposit path): the buyer is
// credited the FULL pack amount.
//
// The impetus (`Signum.valor`) and the USD FMV (`Reditus.usdFmv`) are two distinct
// numbers per pack: impetus is what the user can spend; usdFmv (micro-USD) is the
// revenue recognized (ADR-0013 §2) — the charge amount directly for fiat.
//
// SECURITY: the credited amount is ALWAYS the server-side pack constant, keyed by a
// server-validated packId — NEVER a client-supplied figure. The webhook credits
// `PACKS[packId].impetus`, resolved from the Stripe session's server-set metadata.
// =============================================================================

import { USD } from '../types/reditus.js'

/** A sellable fiat credit pack — locked impetus + locked USD price. */
export interface CreditPack {
  /** Stable pack SKU (the `packId` the checkout + webhook agree on). */
  id: string
  /** Impetus credited on payment (`Signum.valor`, bigint). LOCKED constant — no haircut. */
  impetus: bigint
  /** Price in whole USD dollars (the Stripe charge amount). */
  usd: number
  /** USD price in micro-USD (`Reditus.usdFmv`; $1 = 1_000_000n). Derived from `usd`. */
  usdMicro: bigint
  /** Price in cents (Stripe `unit_amount`). Derived from `usd`. */
  amountCents: number
  /** Human label for the Stripe line item. */
  label: string
}

function pack(id: string, usd: number, impetus: bigint, label: string): CreditPack {
  return {
    id,
    impetus,
    usd,
    usdMicro: BigInt(usd) * USD,
    amountCents: usd * 100,
    label,
  }
}

/**
 * The ratified pack → impetus constant map (LOCKED 2026-07-08). Credit the FULL amount;
 * fiat is USD with NO funding haircut. Keyed by packId.
 */
export const PACKS: Record<string, CreditPack> = {
  starter_10:  pack('starter_10',  10,  30000n,  'Starter — 30,000 impetus'),
  standard_25: pack('standard_25', 25,  82500n,  'Standard — 82,500 impetus'),
  plus_50:     pack('plus_50',     50,  180000n, 'Plus — 180,000 impetus'),
  studio_100:  pack('studio_100',  100, 390000n, 'Studio — 390,000 impetus'),
}

/** Resolve a pack by id, or `undefined` for an unknown SKU (the caller rejects it). */
export function resolvePack(packId: string): CreditPack | undefined {
  return PACKS[packId]
}

/** All sellable pack ids (stable order: cheapest → dearest). */
export const PACK_IDS = ['starter_10', 'standard_25', 'plus_50', 'studio_100'] as const
