// Client for the Arcanum trusted-setup ceremony surface.
//
// The ceremony is the one-time Groth16 Phase-2 setup that makes anonymous credits
// trustless: every contributor folds in secret randomness ("toxic waste"); if even
// ONE contributor destroys theirs, no one can ever forge notes. See the contributor
// guide in docs/arcanum-ceremony.md and scripts/arcanum-trusted-setup.sh.
//
// The multi-party coordinator (R2-hosted zkey chain + transcript endpoints) is being
// scoped — until it answers, status() degrades to the `announced` state so the page
// is a live announcement that already shows people how to take part.
// TODO(backend: ceremony coordinator) — serve GET /v1/ceremony, POST /v1/ceremony/slots.

export type CeremonyPhase = 'announced' | 'open' | 'finalized';

export interface CeremonyContribution {
  /** 1-based position in the hash chain. */
  index: number;
  /** Contributor's chosen name/handle. */
  name: string;
  /** sha256 of the .zkey they produced (the public attestation anchor). */
  outputHash: string;
}

export interface CeremonyStatus {
  phase: CeremonyPhase;
  /** Hash of arcanum_0000.zkey — the chain's root, published at init. */
  rootHash: string | null;
  /** Contributions collected so far, in order. */
  chain: CeremonyContribution[];
  /** Final proving-key hash once the beacon is applied (finalized only). */
  finalHash: string | null;
  /** Coordinator's open slots for new contributors, if accepting. */
  openSlots: number | null;
}

// Pre-coordinator default: announced, empty chain. Not fabricated data — the honest
// "we haven't started collecting yet" state.
const ANNOUNCED: CeremonyStatus = {
  phase: 'announced',
  rootHash: null,
  chain: [],
  finalHash: null,
  openSlots: null,
};

export const ceremony = {
  /** Live ceremony state, or the announced fallback when the coordinator is absent. */
  async status(): Promise<CeremonyStatus> {
    try {
      const res = await fetch('/v1/ceremony');
      if (!res.ok) return ANNOUNCED;
      return (await res.json()) as CeremonyStatus;
    } catch {
      return ANNOUNCED;
    }
  },

  /** Register interest in a contributor slot. Returns false until the coordinator is live. */
  async claimSlot(contact: string): Promise<boolean> {
    try {
      const res = await fetch('/v1/ceremony/slots', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ contact }),
      });
      return res.ok;
    } catch {
      return false;
    }
  },
};
