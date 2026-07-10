// Browser port of the server-side Arcanum prover (src/arcanum/poseidon.ts + prover.ts).
//
// These functions run ENTIRELY in the browser. The nullifier and secret NEVER leave
// this tab — only the commitment (at issuance) and the Groth16 proof + public signals
// (at spend) are transmitted. This is the whole point of anonymous credit: the platform
// stores commitments, not identities, and cannot link what you spend to who you are.
//
// PARITY IS LOAD-BEARING. Every value produced here must be byte-for-byte identical to the
// server implementation it mirrors — a single mismatched decimal string makes a real proof
// verify `false` and burns the note. tests/unit/arcanum/ArcanumParity.test.ts direct-imports
// both this module and the server prover and asserts identical outputs on fixed vectors.
//
// Mirrors:
//   poseidon / computeCommitment / computeNullifierHash / computeLeaf → src/arcanum/poseidon.ts:15-43
//   computeRecipient (sha256, 31-byte truncation)                      → src/arcanum/prover.ts:86-93
//   generateNote / generateSpendProof                                  → src/arcanum/prover.ts:42-131

import { buildPoseidon } from 'circomlibjs'

// ── Poseidon (mirror poseidon.ts:1-18) ──────────────────────────────────────────
// Poseidon is expensive to initialize (~500ms) — build once, reuse everywhere.
let _poseidon: Awaited<ReturnType<typeof buildPoseidon>> | null = null

async function getPoseidon() {
  if (!_poseidon) _poseidon = await buildPoseidon()
  return _poseidon
}

/**
 * Poseidon hash of N field elements. Returns a decimal string.
 * Inputs can be bigint, number, or hex string — all normalized to field elements.
 * EXACT mirror of src/arcanum/poseidon.ts:15-18.
 */
export async function poseidon(inputs: Array<bigint | number | string>): Promise<string> {
  const p = await getPoseidon()
  return p.F.toString(p(inputs))
}

/**
 * commitment = poseidon(nullifier, secret). Both inputs are 64-char hex (32 bytes).
 * Mirror of poseidon.ts:24-26.
 */
export async function computeCommitment(nullifier: string, secret: string): Promise<string> {
  return poseidon([BigInt('0x' + nullifier), BigInt('0x' + secret)])
}

/**
 * nullifierHash = poseidon(nullifier). Revealed when a note is spent; not reversible.
 * Mirror of poseidon.ts:32-34.
 */
export async function computeNullifierHash(nullifier: string): Promise<string> {
  return poseidon([BigInt('0x' + nullifier)])
}

/**
 * leaf = poseidon(commitment, valor) — the value actually stored in the Merkle tree.
 * Mirror of poseidon.ts:41-43. Not needed to spend (the circuit derives it internally),
 * but exported for parity coverage.
 */
export async function computeLeaf(commitment: string, valor: bigint): Promise<string> {
  return poseidon([BigInt(commitment), valor])
}

// ── Recipient binding (mirror prover.ts:86-93) ──────────────────────────────────
//
// sha256(modusId + ':' + JSON.stringify(sortedAditus)), first 31 bytes as a BigInt
// decimal string. Binds a DIRECT-run proof to one execution so it can't be replayed.
// Byte-for-byte compat with the server is mandatory: Node's createHash('sha256')
// .update(payload) encodes the JS string as UTF-8, and TextEncoder here produces the
// same UTF-8 bytes; both slice the first 31 of 32 digest bytes and parse them the same.
export async function computeRecipient(
  modusId: string,
  aditus: Record<string, unknown>,
): Promise<string> {
  const sorted = Object.fromEntries(
    Object.entries(aditus).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
  )
  const payload = `${modusId}:${JSON.stringify(sorted)}`
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(payload)))
  const first31 = digest.slice(0, 31)
  let hex = ''
  for (const b of first31) hex += b.toString(16).padStart(2, '0')
  return BigInt('0x' + hex).toString()
}

// ── Note generation (mirror prover.ts:105-131) ──────────────────────────────────

/**
 * The full client-held note including private fields. NEVER transmitted in full.
 * Mirror of ArcanumNotePrivate (prover.ts:105-114).
 */
export interface ArcanumNotePrivate {
  /** Raw nullifier — 32 bytes hex (64 chars). NEVER send to server. */
  nullifier: string
  /** Raw secret — 32 bytes hex (64 chars). NEVER send to server. */
  secret: string
  /** Note valor (impetus points). */
  valor: bigint
  /** Leaf index in the Merkle tree (-1 until /arcanum/issue fills it in). */
  leafIndex: number
}

function randomHex(bytes: number): string {
  const b = new Uint8Array(bytes)
  crypto.getRandomValues(b)
  let hex = ''
  for (const x of b) hex += x.toString(16).padStart(2, '0')
  return hex
}

/**
 * Generate a fresh note client-side (32-byte nullifier + 32-byte secret).
 * Mirror of prover.ts:120-131 (Buffer.from(bytes).toString('hex') == this lowercase hex).
 */
export function generateNote(valor: bigint): ArcanumNotePrivate {
  return {
    nullifier: randomHex(32),
    secret: randomHex(32),
    valor,
    leafIndex: -1,
  }
}

// ── Spend proof (mirror prover.ts:42-78) ────────────────────────────────────────

/** A Merkle inclusion proof, as returned by GET /arcanum/tree/proof/:leafIndex. */
export interface ArcanumMerkleProof {
  root: string
  leafIndex: number
  pathElements: string[]
  pathIndices: number[]
}

/** The ZK spend proof submitted to POST /arcanum/purse (mirror src/arcanum/types.ts). */
export interface ArcanumSpendProof {
  proof: object
  publicSignals: {
    root: string
    nullifierHash: string
    valor: string
    recipient: string
  }
}

export interface SpendProofOpts {
  /** URL to arcanum.wasm (from GET /arcanum/config wasmUrl). */
  wasmUrl: string
  /** URL to arcanum_final.zkey (from GET /arcanum/config zkeyUrl). */
  zkeyUrl: string
}

/**
 * Generate a Groth16 spend proof for a note. snarkjs is lazy-imported (heavy, off the
 * main bundle — same pattern as lib/ceremony.ts:100). fullProve blocks ~seconds in-browser;
 * callers MUST show a busy state. Mirror of prover.ts:42-78.
 *
 * `recipient` binds the proof: for a DIRECT run it is computeRecipient(modusId, aditus);
 * for a purse MINT there is no execution to bind to, so callers pass "0" (the circuit only
 * constrains recipient*recipient to stop it being stripped, and POST /arcanum/purse's
 * verifier does not check its value — only ActumInceptor's direct-run path does).
 */
export async function generateSpendProof(
  note: ArcanumNotePrivate,
  merkleProof: ArcanumMerkleProof,
  recipient: string,
  opts: SpendProofOpts,
): Promise<ArcanumSpendProof> {
  const snarkjs = await import('snarkjs')

  const input = {
    // Private
    nullifier: BigInt('0x' + note.nullifier).toString(),
    secret: BigInt('0x' + note.secret).toString(),
    pathElements: merkleProof.pathElements,
    pathIndices: merkleProof.pathIndices,
    // Public
    root: merkleProof.root,
    nullifierHash: await computeNullifierHash(note.nullifier),
    valor: note.valor.toString(),
    recipient,
  }

  const { proof, publicSignals } = await snarkjs.groth16.fullProve(input, opts.wasmUrl, opts.zkeyUrl)

  // Public signals order from the circuit: [root, nullifierHash, valor, recipient].
  return {
    proof,
    publicSignals: {
      root: publicSignals[0],
      nullifierHash: publicSignals[1],
      valor: publicSignals[2],
      recipient: publicSignals[3],
    },
  }
}
