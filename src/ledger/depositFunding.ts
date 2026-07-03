// =============================================================================
// depositFunding — the per-asset "buy" funding rate (deposit → credits economics)
// =============================================================================
//
// When a deposit is converted to credits, only a FRACTION of its USD FMV becomes spendable
// impetus — the "funding rate". It is NOT a fee; it is the discount for turning a volatile
// external asset into closed-loop credits (the platform takes the price risk), and it doubles
// as a brand/economic lever (favored assets convert at par). The gap between gross FMV and the
// funded amount is retained margin, booked as gross revenue (ADR-0013 §4b) — revenue is the
// GROSS FMV, the user is credited the NET.
//
// POLICY (decided 2026-07-02): OPEN ACCEPTANCE — any asset the AssetPricer can price is accepted,
// at DEFAULT_FUNDING_BPS, with a small per-asset OVERRIDE table for favored assets (ported from
// the legacy tokenConfig curation). Rates are integer basis points (of 10_000) so the haircut is
// exact bigint. See docs/spec/conditional-license-revenue.md + memory project_deposit_pricing_parity.
// =============================================================================

/** Default funding rate for any accepted asset: 0.70 → 7000 bps. */
export const DEFAULT_FUNDING_BPS = 7000n

/**
 * Per-asset overrides (lowercase token/collection address → bps). Favored assets convert at (or
 * near) par as a community/brand lever. Ported from legacy `tokenConfig.js`; extend deliberately.
 */
export const FUNDING_OVERRIDES: Record<string, bigint> = {
  '0x524cab2ec69124574082676e6f654a18df49a048': 10000n, // MiladyStation — par
  '0xd3d9ddd0cf0a5f0bfb8f7fc9e046c5318a33c168': 10000n, // Remilio — par
  '0x7bd29408f11d2bfc23c34f18275bbf23cf646e9c': 10000n, // Milady — par
  '0x139a67691b353f1d3a5b82f0223707e4a81571db': 10000n, // Kagami — par
  '0x892972989e5a1b24d61f1c75908da684e27f46e5': 8500n,  // Fumo
  '0x42069055135d56221123495f5cff5bac4115b136': 8500n,  // CultExec
  '0x88f253ab39797375a025e64a1324792c3a9de35d': 6500n,  // Bonkler
}

/** The funding rate (bps) for a token, falling back to the open-acceptance default. */
export function fundingBps(tokenAddress: string): bigint {
  return FUNDING_OVERRIDES[tokenAddress.toLowerCase()] ?? DEFAULT_FUNDING_BPS
}

/** Apply a funding rate to a gross micro-USD amount → the net (funded) micro-USD. Floors. */
export function applyFundingBps(grossMicroUsd: bigint, bps: bigint): bigint {
  return (grossMicroUsd * bps) / 10_000n
}
