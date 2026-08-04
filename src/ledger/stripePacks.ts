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
 * The ratified pack → impetus constant map (LOCKED 2026-07-21 — R-1 ruling, supersedes the
 * 2026-07-08 map; see `internal notes`). Credit the FULL amount; fiat is USD with NO
 * funding haircut. Keyed by packId.
 */
export const PACKS: Record<string, CreditPack> = {
  starter_10:  pack('starter_10',  10,  20800n,  'Starter — 20,800 impetus'),
  standard_25: pack('standard_25', 25,  57200n,  'Standard — 57,200 impetus'),
  plus_50:     pack('plus_50',     50,  124800n, 'Plus — 124,800 impetus'),
  studio_100:  pack('studio_100',  100, 270400n, 'Studio — 270,400 impetus'),
}

/** Resolve a pack by id, or `undefined` for an unknown SKU (the caller rejects it). */
export function resolvePack(packId: string): CreditPack | undefined {
  return PACKS[packId]
}

/** All sellable pack ids (stable order: cheapest → dearest). */
export const PACK_IDS = ['starter_10', 'standard_25', 'plus_50', 'studio_100'] as const

/** The ordered catalog (cheapest → dearest) — the single source every DISPLAY surface reads. */
export function packCatalog(): CreditPack[] {
  return PACK_IDS.map((id) => PACKS[id])
}

/**
 * The PUBLIC, display-only projection of a credit pack — the shape the pricing/funding UI needs.
 * `credits` is the user-facing display unit = `impetus / 10` (pricing-reconciliation); `usd` is the
 * charge amount. This carries NO authority: the charged/credited amount is ALWAYS the server-side
 * `PACKS[packId]` constant keyed by `packId` — never any figure derived from this view.
 */
export interface PackView {
  /** Stable pack SKU (`packId`) — the only thing the buy flow sends back to the server. */
  id: string
  /** Price in whole USD dollars. */
  usd: number
  /** Display credits = `impetus / 10`. Display only — NOT the credited/charged figure. */
  credits: number
  /** Tier display name (e.g. "Starter") — derived from the pack label, no jargon/raw impetus. */
  label: string
  /** True for the single best credits-per-USD pack (highest `credits / usd`). */
  bestRate?: boolean
}

/**
 * Project the catalog to the PUBLIC display shape. `bestRate` is computed (argmax credits/usd) so a
 * change to any pack constant re-derives it automatically. Display-only — carries no pricing authority.
 */
export function packViews(): PackView[] {
  const cat = packCatalog()
  let bestId = cat[0]?.id
  let bestRatio = -Infinity
  for (const p of cat) {
    const ratio = Number(p.impetus) / 10 / p.usd
    if (ratio > bestRatio) { bestRatio = ratio; bestId = p.id }
  }
  return cat.map((p) => ({
    id: p.id,
    usd: p.usd,
    credits: Number(p.impetus) / 10,
    label: p.label.split('—')[0].trim(),   // "Starter — 20,800 impetus" → "Starter"
    ...(p.id === bestId ? { bestRate: true } : {}),
  }))
}
