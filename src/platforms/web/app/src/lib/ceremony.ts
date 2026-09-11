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

  /**
   * The proving key this site serves, per GET /arcanum/config. Null when the request
   * fails or the server predates `zkeyHash` — in which case the page says it cannot
   * check rather than implying the key is right. See `checkServedKey`.
   */
  async servedKey(): Promise<ServedKey | null> {
    try {
      const res = await fetch('/arcanum/config');
      if (!res.ok) return null;
      const cfg = (await res.json()) as {
        zkeyHash?: string | null;
        zkeySource?: ServedKey['source'];
        verifierPaired?: boolean | null;
      };
      if (cfg.zkeySource === undefined) return null;
      return {
        hash: cfg.zkeyHash ?? null,
        source: cfg.zkeySource ?? null,
        paired: cfg.verifierPaired ?? null,
      };
    } catch {
      return null;
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

// ── Does the site serve the key its own transcript names? ─────────────────────────
//
// A finished transcript names a final key by hash. That is only half a guarantee: the
// key clients download for proving is served by a different route, and nothing on the
// page ever compared the two. So "ceremony complete, final key dd96…" could sit above a
// /arcanum/circuit/zkey handing out something else entirely, and a visitor had no way to
// tell. GET /arcanum/config now names the served key's sha256, so the page can make that
// comparison in the open and say what it found.

/** The proving key the site actually serves, as `GET /arcanum/config` reports it. */
export interface ServedKey {
  /** sha256 of the bytes at /arcanum/circuit/zkey. Null when the API does not serve them. */
  hash: string | null;
  /** Where that key came from: the finalized ceremony, the repo, another host, or nowhere. */
  source: 'ceremony' | 'repo' | 'external' | 'none' | null;
  /**
   * Whether the verification key the site judges proofs with is the served key's own
   * half. null when the site cannot say — an older server, or a key hosted elsewhere.
   */
  paired?: boolean | null;
}

export type ServedKeyVerdict =
  /** The served key is the one the transcript names. */
  | 'match'
  /** The site serves a key the transcript does not name. */
  | 'mismatch'
  /** The transcript names a final key the site has not got. */
  | 'absent'
  /** The key is hosted elsewhere, so the API has not seen those bytes and cannot name them. */
  | 'external'
  /**
   * The served key IS the one the transcript names, and the site cannot verify proofs
   * made with it — its verification key is from a different setup. A hash match is only
   * half the claim, and this is the half that decides whether a proof is worth making.
   */
  | 'unverifiable'
  /** Nothing to compare yet: the ceremony is unfinished, or this server predates the check. */
  | 'unknown';

/**
 * Compare the transcript's final key against the key the site serves. Pure so it can be
 * tested without a server, and so the page renders one verdict rather than re-deriving it.
 */
export function checkServedKey(
  status: CeremonyStatus | null,
  served: ServedKey | null,
): ServedKeyVerdict {
  if (!status || status.phase !== 'finalized' || !status.finalHash) return 'unknown';
  if (!served || served.source === null) return 'unknown';
  if (served.source === 'external') return 'external';
  if (served.source === 'none' || !served.hash) return 'absent';
  if (served.hash.toLowerCase() !== status.finalHash.toLowerCase()) return 'mismatch';
  // Only an explicit false downgrades the verdict: a server that does not report the
  // pairing is the older build, and 'match' is what it was always able to say.
  return served.paired === false ? 'unverifiable' : 'match';
}
