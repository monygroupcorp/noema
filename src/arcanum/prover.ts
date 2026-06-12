import { createHash } from 'node:crypto'
import { computeNullifierHash } from './poseidon.js'
import type { ArcanumMerkleProof } from './ArcanumTree.js'
import type { ArcanumSpendProof } from './types.js'

// =============================================================================
// generateSpendProof — client-side Groth16 proof generation
// =============================================================================
//
// The prover runs client-side (browser WASM or Node). The server never sees
// nullifier or secret — only the proof and public signals.
//
// PROOF GENERATION TAKES ~10-30s in browser WASM, ~2s in Node.
// Warn users before triggering this in a UI.
//
// WASM + zkey paths:
//   In Node (tests/scripts): absolute filesystem paths.
//   In browser: URLs (fetch from /arcanum/circuit/wasm and the zkey CDN URL).
//   snarkjs handles both transparently via its own fetch abstraction.
//
// RECIPIENT:
//   sha256(modusId + ':' + JSON.stringify(sortedAditus)), first 31 bytes as BigInt.
//   Binds the proof to one specific execution — cannot be replayed on a different run.
//   Compute it server-side in the quote step and return it to the client.
// =============================================================================

export interface SpendProofOpts {
  /** Path or URL to arcanum.wasm (the compiled circuit). */
  wasmPath: string
  /** Path or URL to arcanum_final.zkey (the proving key, ~300MB). */
  zkeyPath: string
}

/**
 * Generate a Groth16 spend proof for an arcanum note.
 *
 * @param note      The full ArcanumNote (nullifier + secret required, never sent to server).
 * @param proof     The current Merkle inclusion proof for the note's leaf.
 * @param recipient poseidon(modoId, aditusId) — binds proof to this execution.
 * @param opts      Paths/URLs to the wasm and zkey artifacts.
 */
export async function generateSpendProof(
  note: ArcanumNotePrivate,
  merkleProof: ArcanumMerkleProof,
  recipient: string,
  opts: SpendProofOpts,
): Promise<ArcanumSpendProof> {
  const snarkjs = await import('snarkjs')

  const nullifierBig = BigInt('0x' + note.nullifier)
  const secretBig    = BigInt('0x' + note.secret)

  const input = {
    // Private
    nullifier:    nullifierBig.toString(),
    secret:       secretBig.toString(),
    pathElements: merkleProof.pathElements,
    pathIndices:  merkleProof.pathIndices,
    // Public
    root:         merkleProof.root,
    nullifierHash: await computeNullifierHash(note.nullifier),
    valor:        note.valor.toString(),
    recipient,
  }

  const { proof, publicSignals } = await snarkjs.groth16.fullProve(input, opts.wasmPath, opts.zkeyPath)

  // Public signals order from circuit: [root, nullifierHash, valor, recipient]
  return {
    proof,
    publicSignals: {
      root:          publicSignals[0],
      nullifierHash: publicSignals[1],
      valor:         publicSignals[2],
      recipient:     publicSignals[3],
    },
  }
}

/**
 * Compute the recipient field for a spend proof.
 * sha256(modusId + ':' + JSON.stringify(sortedAditus)), first 31 bytes as BigInt decimal.
 * The server returns this from POST /v1/runs/quote so clients don't need to reimplement it.
 * This is the canonical implementation — ActumInceptor delegates here.
 */
export function computeRecipient(modusId: string, aditus: Record<string, unknown>): string {
  const sorted = Object.fromEntries(
    Object.entries(aditus).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
  )
  const payload = `${modusId}:${JSON.stringify(sorted)}`
  const hash = createHash('sha256').update(payload).digest()
  return BigInt('0x' + hash.slice(0, 31).toString('hex')).toString()
}

// =============================================================================
// ArcanumNotePrivate — the full client-held note including private fields.
//
// ArcanumNote (src/arcanum/types.ts) is the server-safe shape — it has
// nullifierHash and commitment but NOT nullifier or secret (those are
// client-only). The prover needs the raw nullifier and secret.
//
// Clients store this locally (localStorage, keychain, etc). Losing it =
// losing the credit. No recovery.
// =============================================================================
export interface ArcanumNotePrivate {
  /** Raw nullifier — 32 bytes hex (64 chars). NEVER send to server. */
  nullifier: string
  /** Raw secret — 32 bytes hex (64 chars). NEVER send to server. */
  secret: string
  /** Note valor (impetus points). */
  valor: bigint
  /** Leaf index in the Merkle tree. */
  leafIndex: number
}

/**
 * Generate a fresh note client-side.
 * Uses crypto.getRandomValues (works in browser and Node >= 18).
 */
export function generateNote(valor: bigint): ArcanumNotePrivate {
  const nullifierBytes = new Uint8Array(32)
  const secretBytes    = new Uint8Array(32)
  crypto.getRandomValues(nullifierBytes)
  crypto.getRandomValues(secretBytes)
  return {
    nullifier: Buffer.from(nullifierBytes).toString('hex'),
    secret:    Buffer.from(secretBytes).toString('hex'),
    valor,
    leafIndex: -1, // filled in after /arcanum/issue
  }
}
