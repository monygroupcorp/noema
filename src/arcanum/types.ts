// =============================================================================
// ARCANUM — anonymous credit notes, ZK spend proofs
// =============================================================================
//
// A note is a bearer instrument: (nullifier, secret) is all you need to spend it.
// The platform stores commitments, not identities.
//
// NOTE LIFECYCLE:
//   issue:  ArcanumIssuer debits identified balance,
//           inserts commitment = poseidon(nullifier, secret) into Merkle tree,
//           returns note to client. Platform never stores nullifier or secret.
//
//   spend:  Client generates Groth16 proof of Merkle membership.
//           Server verifies proof, checks nullifierHash not spent, executes.
//           Platform learns nullifierHash but cannot reverse it to commitment.
//
// WHAT THE PLATFORM CAN KNOW:
//   At issuance:   animaId → deposit (no commitment pointer)
//                  commitment → leaf (no animaId pointer)
//                  Timing/valor correlation possible — this is the accepted tradeoff.
//
//   At spend:      nullifierHash is recorded (prevents replay).
//                  nullifierHash cannot be linked to commitment without nullifier.
//                  commitment cannot be linked to animaId.
//
//   RESULT: the platform cannot link what you generated to who you are.
// =============================================================================

/** Client-held note — never transmitted to the server in full. */
export interface ArcanumNote {
  /** poseidon(nullifier) — what's revealed when the note is spent */
  nullifierHash: string
  /** poseidon(nullifier, secret) — the commitment stored in the Merkle tree */
  commitment: string
  /** Position in the Merkle tree — needed to fetch the current Merkle proof */
  leafIndex: number
  /** Credit value in impetus points */
  valor: bigint
  /** Whether this note has been spent */
  spent: boolean
}

/** Server-side record for one Merkle leaf — no animaId. */
export interface ArcanumLeaf {
  /** poseidon(nullifier, secret) */
  commitment: string
  /** poseidon(commitment, valor) — the actual value hashed into the tree */
  leaf: string
  /** Credit value in impetus points */
  valor: bigint
  /** Index in the incremental Merkle tree */
  leafIndex: number
  /** When this commitment was inserted */
  insertedAt: Date
}

/** What ArcanumIssuer returns to the client. */
export interface ArcanumIssuance {
  /**
   * The full note — client must persist this locally.
   * The platform never stores nullifier or secret.
   * Losing the note = losing the credit. No recovery possible.
   */
  note: ArcanumNote
  /** Current Merkle root at time of issuance */
  merkleRoot: string
  /** Path elements for the leaf's Merkle proof (sibling hashes) */
  merklePathElements: string[]
  /** 0 = go left, 1 = go right at each level */
  merklePathIndices: number[]
}

/**
 * The ZK spend proof submitted to ActumInceptor.
 *
 * Proves: "I know (nullifier, secret) such that
 *   poseidon(poseidon(nullifier, secret), valor) is a leaf in the
 *   Merkle tree with root `root`, and nullifierHash = poseidon(nullifier)"
 */
export interface ArcanumSpendProof {
  /**
   * Groth16 proof object — as returned by snarkjs groth16.fullProve().
   * Contains { pi_a, pi_b, pi_c, protocol, curve }.
   */
  proof: object
  /**
   * Public signals in order: [root, nullifierHash, valor, recipient]
   * All as decimal strings (field elements).
   */
  publicSignals: {
    root: string
    nullifierHash: string
    /** Decimal string of impetus points (bigint serialized) */
    valor: string
    /** Hash of execution context — binds proof to this specific execution */
    recipient: string
  }
}
