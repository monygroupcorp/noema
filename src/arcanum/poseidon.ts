import { buildPoseidon } from 'circomlibjs'

// Poseidon is expensive to initialize (~500ms) — build once, reuse everywhere.
let _poseidon: Awaited<ReturnType<typeof buildPoseidon>> | null = null

async function getPoseidon() {
  if (!_poseidon) _poseidon = await buildPoseidon()
  return _poseidon
}

/**
 * Poseidon hash of N field elements. Returns a decimal string.
 * Inputs can be bigint, number, or hex string — all normalized to field elements.
 */
export async function poseidon(inputs: Array<bigint | number | string>): Promise<string> {
  const p = await getPoseidon()
  return p.F.toString(p(inputs))
}

/**
 * Compute commitment = poseidon(nullifier, secret).
 * Both inputs are hex strings (64 chars = 32 bytes).
 */
export async function computeCommitment(nullifier: string, secret: string): Promise<string> {
  return poseidon([BigInt('0x' + nullifier), BigInt('0x' + secret)])
}

/**
 * Compute nullifierHash = poseidon(nullifier).
 * This is what's revealed when a note is spent — cannot be reversed to commitment.
 */
export async function computeNullifierHash(nullifier: string): Promise<string> {
  return poseidon([BigInt('0x' + nullifier)])
}

/**
 * Compute leaf = poseidon(commitment, valor).
 * This is the value actually stored in the Merkle tree.
 * Including valor in the leaf means the proof certifies the credit amount.
 */
export async function computeLeaf(commitment: string, valor: bigint): Promise<string> {
  return poseidon([BigInt(commitment), valor])
}
