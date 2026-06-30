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
// OFAC publishes specific sanctioned crypto addresses (the Tornado Cash
// designations are the governing precedent). The screenable list is a finite,
// published dataset — so this ships a REAL Set-backed implementation, not a
// stub. The seam that remains is keeping the list FRESH: the authoritative SDN
// set must be synced (see scripts/refresh-ofac-blocklist.ts) before go-live and
// on a schedule after. See docs/legal + memory project_compliance_posture.
//
// Mirrors the ModerationGate seam (src/crystal/ModerationGate.ts): an interface
// injected like the deterministic engines, with a real impl behind it.
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
 * Real Set-backed screen over an explicit blocklist (the OFAC SDN crypto-address
 * set). Addresses are normalized to lowercase 0x-hex on construction, so callers
 * may pass them in any case. Lookup is O(1); the async signature leaves room for
 * a future live oracle/API without a call-site change.
 */
export function makeBlocklistScreen(addresses: Iterable<string>): SanctionsScreen {
  const blocked = new Set<string>()
  for (const a of addresses) {
    const norm = a.trim().toLowerCase()
    if (norm) blocked.add(norm)
  }
  return {
    async screen(address: string): Promise<SanctionsVerdict> {
      const norm = address.trim().toLowerCase()
      if (blocked.has(norm)) {
        return { ok: false, reason: `address ${norm} is on the OFAC SDN blocklist` }
      }
      return { ok: true }
    },
  }
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
