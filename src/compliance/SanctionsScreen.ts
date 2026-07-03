// =============================================================================
// SanctionsScreen — the OFAC trust-boundary gate for on-chain deposits
// =============================================================================
//
// Every value-bearing deposit to CreditVault MUST pass this gate at the DEPOSIT
// boundary — before any credit (Signum) or anonymous note (Arcanum leaf) is
// issued. The deposit transaction is public on-chain (a normal ETH/token send),
// so the funding wallet address is always observable here; the Arcanum note only
// makes the *spend* unlinkable. Screening at deposit is therefore fully
// compatible with the privacy model: we check the sender once, at the one moment
// the address is visible, and never need it again.
//
// OFAC compliance: do not process value transfers for wallets on the SDN list.
//
// This PUBLIC file ships only the PORT + the permissive stub. The real Set-backed
// screen (`makeBlocklistScreen`) + the SDN list loader are the compliance abuse
// surface and are therefore PRIVATE (ADR-0012 §49 — not published): they live in
// the gitignored `src/private/compliance` module, injected at deploy. `src/index.ts`
// loads the private `configureSanctionsScreen` via a guarded dynamic import and
// falls back to `permissiveSanctionsScreen` when it is absent (a public build).
//
// Mirrors the ModerationGate seam (src/crystal/ModerationGate.ts): a public port +
// public stub, with the real impl injected privately behind it.
// =============================================================================

/** A screening verdict: clear, or blocked with a reason. */
export type SanctionsVerdict = { ok: true } | { ok: false; reason: string }

/** Screens a single wallet address at the deposit boundary. */
export interface SanctionsScreen {
  /**
   * @param address 0x-prefixed wallet address (case-insensitive). Implementations
   *   normalize to lowercase before comparison.
   */
  screen(address: string): Promise<SanctionsVerdict>
}

/**
 * PLACEHOLDER screen — clears everything. Used ONLY when no blocklist is
 * configured (dev/test). The container wires this with a LOUD warning so an
 * unconfigured production never silently runs unscreened. Do NOT treat its
 * `ok:true` as a real compliance guarantee — it is a structural no-op, flagged
 * here on purpose, replaced by makeBlocklistScreen once a list is loaded.
 *
 * PLACEHOLDER(compliance#ofac): inert stand-in active only when OFAC_BLOCKLIST_PATH
 * is unset. MUST NOT be the active screen before real deposits flow at go-live.
 */
export const permissiveSanctionsScreen: SanctionsScreen = {
  async screen(): Promise<SanctionsVerdict> {
    return { ok: true }
  },
}
