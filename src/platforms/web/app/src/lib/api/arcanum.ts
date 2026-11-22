import { j } from './core';
import { authHeaders } from './session';

// ── Arcanum wire shapes (GET /arcanum/config, POST /arcanum/issue, /tree/proof) ──
// Prover discovery. ready=false when wasm or zkey isn't configured server-side — the
// Vault mint path stays disabled and links to the ceremony rather than faking readiness.
/** `enabled` is ANON_PURSE_ENABLED (noema-131) — false until the trusted-setup ceremony runs.
 *  Optional because an older server omits it; read it as `=== true`, never as a truthy default,
 *  so a page never promises the purse to a visitor the server will refuse. */
/** `zkeyHash` is the sha256 of the proving key this server serves, and `zkeySource` says where
    it came from ('ceremony' once the trusted setup is finalized). Compare zkeyHash with the
    ceremony transcript's finalHash (GET /v1/ceremony) to confirm the key is the one the public
    record names. Both optional: an older server omits them, and zkeyHash is null when zkeyUrl
    points at a host the API does not serve from. */
export interface ArcanumConfig { wasmUrl: string; zkeyUrl: string | null; depth: number; ready: boolean; enabled?: boolean;
  zkeyHash?: string | null; zkeySource?: 'ceremony' | 'repo' | 'external' | 'none' }
// What POST /arcanum/issue returns (mirror src/arcanum/types.ts ArcanumIssuance). We
// already hold valor locally; the load-bearing fields here are leafIndex + the Merkle path.
export interface ArcanumIssuance {
  note: { nullifierHash: string; commitment: string; leafIndex: number; valor: string; spent: boolean };
  merkleRoot: string;
  merklePathElements: string[];
  merklePathIndices: number[];
}
// A fresh Merkle inclusion proof (mirror src/arcanum/ArcanumTree.ts ArcanumMerkleProof).
export interface ArcanumMerkleProofView {
  root: string;
  leafIndex: number;
  pathElements: string[];
  pathIndices: number[];
}

// ── Arcanum (anonymous ZK credit rail) — mounted at /arcanum, NOT /v1 ────────
// The client holds the note SECRET (never transmitted). NOTE: the signed-in issue path
// below currently also sends the raw nullifier — see its comment. The bearer token and
// Groth16 proof are the only other things these calls carry. See lib/arcanum.ts.
const arcanumApi = {
  // Prover discovery: where to fetch wasm/zkey + whether the ceremony is finalized.
  // ready:false → the whole mint path stays disabled (no fiction), link to /ceremony.
  config: () => fetch('/arcanum/config').then(j<ArcanumConfig>),
  // Convert identified balance → anonymous note. Signed-in path only (authHeaders →
  // Bearer). Client generates (nullifier, secret); the SECRET stays local, but the
  // server route requires commitment+nullifier TOGETHER, so the raw nullifier IS sent
  // here. That lets the server compute nullifierHash and link this authenticated funder
  // to the note's eventual spend — a known privacy limitation of the signed-in path,
  // tracked for a commitment-only (blind) issuance change (money-code spec gate). The
  // server inserts the leaf and returns the Merkle path. 501 if it can't resolve an
  // identity (anon caller). valor is a decimal-bigint string.
  issue: (body: { valor: string; commitment: string; nullifier: string }) =>
    fetch('/arcanum/issue', { method: 'POST', headers: authHeaders(), body: JSON.stringify(body) })
      .then(j<ArcanumIssuance>),
  // Fresh Merkle inclusion proof for a leaf (root moves as the tree grows — re-fetch
  // right before proving so the proof's root matches the current tree root).
  treeProof: (leafIndex: number) =>
    fetch(`/arcanum/tree/proof/${leafIndex}`).then(j<{ proof: ArcanumMerkleProofView }>),
  // Look up a leaf by its commitment. Used to RECOVER a note's leafIndex when the /issue
  // response was lost after the server already settled the debit and inserted the leaf —
  // without this the note (secret held locally) would be stuck at leafIndex -1. 404 until
  // the commitment is in the tree (e.g. issuance actually failed before settling).
  getLeaf: (commitment: string) =>
    fetch(`/arcanum/tree/leaf/${encodeURIComponent(commitment)}`)
      .then(j<{ leaf: { commitment: string; leafIndex: number; valor: string; insertedAt?: string } }>),
  // Redeem a spend proof once → mint an anonymous bearer purse. The note's nullifier is
  // burned server-side; 409 if it was already spent (idempotent — treat as already-minted).
  mintPurse: (arcanumProof: unknown) =>
    fetch('/arcanum/purse', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ arcanumProof }) })
      .then(j<{ token: string; credits: string }>),
  // Live balance for a purse token. 404 once it doesn't exist / was never minted.
  getPurse: (token: string) =>
    fetch(`/arcanum/purse/${encodeURIComponent(token)}`).then(j<{ token: string; credits: string; createdAt?: string }>),
};

export default arcanumApi;
