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
  /** sha256 of the zkey the next contributor must build on (server-computed). */
  headHash?: string | null;
}

/** Progress phases for an in-browser contribution. */
export type ContributePhase = 'downloading' | 'contributing' | 'uploading' | 'done';

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

  /**
   * Contribute to the ceremony entirely in the browser:
   *   download the head zkey → fold in your entropy via snarkjs (WASM) → upload.
   * The proving key (~5MB) and your toxic waste never leave this tab except as the
   * resulting zkey, which carries no recoverable trace of your entropy. Returns the
   * updated ceremony status on success; throws with the server's reason on rejection.
   */
  async contribute(opts: {
    name: string;
    entropy: string;
    onPhase?: (p: ContributePhase) => void;
  }): Promise<CeremonyStatus> {
    const { onPhase } = opts;

    // 1 — download the current head (the exact zkey the transcript names).
    onPhase?.('downloading');
    const res = await fetch('/v1/ceremony/current.zkey');
    if (!res.ok) throw new Error(`couldn't fetch the current key (${res.status}) — is the ceremony open?`);
    const basedOn = res.headers.get('x-zkey-hash') ?? '';
    const head = new Uint8Array(await res.arrayBuffer());

    // 2 — fold in entropy (snarkjs in WASM, lazy-loaded — heavy, off the main bundle).
    onPhase?.('contributing');
    const snarkjs = await import('snarkjs');
    const out: { type: 'mem'; data?: Uint8Array } = { type: 'mem' };
    await snarkjs.zKey.contribute(head, out, opts.name || 'anonymous', opts.entropy);
    if (!out.data) throw new Error('contribution produced no output');

    // 3 — upload. The server verifies it's a valid continuation and appends it live.
    onPhase?.('uploading');
    const up = await fetch('/v1/ceremony/contributions', {
      method: 'POST',
      headers: {
        'content-type': 'application/octet-stream',
        'x-based-on': basedOn,
        'x-contributor-name': opts.name || 'anonymous',
      },
      body: out.data as BodyInit,
    });
    if (!up.ok) {
      let reason = up.statusText;
      try { reason = (await up.json()).error ?? reason; } catch { /* keep statusText */ }
      throw new Error(reason);
    }
    onPhase?.('done');
    return up.json();
  },
};
