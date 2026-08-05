import type { Collection } from 'mongodb'
import type { ArcanumSpendProof } from './types.js'
import type { ArcanumTreeStore } from './ArcanumTree.js'
import { makeLogger } from '../lib/logger.js'

const log = makeLogger('arcanum:verifier')

// ---------------------------------------------------------------------------
// ArcanumVerifier — verifies ZK spend proofs and manages the nullifier set
// ---------------------------------------------------------------------------
//
// The verifier answers one question: "Is this proof valid and unspent?"
//
// It does NOT know which commitment was spent — that's the privacy guarantee.
// It only records nullifierHash (= poseidon(nullifier)) to prevent replay.
//
// INJECTABLE VERIFY FUNCTION:
//   In production: wraps snarkjs groth16.verify() with the bundled verification key.
//   In tests: a mock that returns true/false deterministically.
//   This follows the same pattern as `fetchFn` in SecurePodClient.
//
// NULLIFIER STORE:
//   MemoryNullifierStore — for tests. In-memory, gone on restart.
//   MongoNullifierStore  — for production. Persists to arcanum_nullifiers.
//   Always pass MongoNullifierStore in production or double-spend is possible.
// ---------------------------------------------------------------------------

export type VerifyFn = (
  proof: object,
  publicSignals: string[],
) => Promise<boolean>

/** Make a production verify function from a snarkjs verification key JSON. */
export function makeSnarkjsVerifier(verificationKey: object): VerifyFn {
  return async (proof, publicSignals) => {
    // Dynamic import so snarkjs doesn't load unless actually used
    const snarkjs = await import('snarkjs')
    return snarkjs.groth16.verify(verificationKey, publicSignals, proof)
  }
}

// ---------------------------------------------------------------------------
// NullifierStore — injectable to allow in-memory (tests) or MongoDB (prod)
// ---------------------------------------------------------------------------

export interface NullifierStore {
  /** Returns true if this nullifierHash has already been spent. */
  has(nullifierHash: string): Promise<boolean>
  /** Persist the nullifierHash as spent. */
  add(nullifierHash: string): Promise<void>
}

/** In-memory store — correct for tests and single-process toy deployments. */
export class MemoryNullifierStore implements NullifierStore {
  private readonly set = new Set<string>()
  async has(h: string): Promise<boolean> { return this.set.has(h) }
  async add(h: string): Promise<void> { this.set.add(h) }
}

type NullifierDoc = { nullifierHash: string; spentAt: Date }

/**
 * MongoDB-backed nullifier store. Persists to `arcanum_nullifiers`.
 * On startup, loads all spent nullifiers into memory for O(1) checks.
 * ensureIndexes.ts must create a unique index on nullifierHash.
 */
export class MongoNullifierStore implements NullifierStore {
  private readonly mem = new Set<string>()
  private loaded = false

  constructor(private readonly col: Collection) {}

  private async load(): Promise<void> {
    if (this.loaded) return
    const docs = await this.col.find({}, { projection: { nullifierHash: 1 } }).toArray() as unknown as NullifierDoc[]
    for (const doc of docs) this.mem.add(doc.nullifierHash)
    this.loaded = true
  }

  async has(nullifierHash: string): Promise<boolean> {
    await this.load()
    return this.mem.has(nullifierHash)
  }

  async add(nullifierHash: string): Promise<void> {
    await this.load()
    if (this.mem.has(nullifierHash)) return
    await this.col.insertOne({ nullifierHash, spentAt: new Date() } satisfies NullifierDoc)
    this.mem.add(nullifierHash)
  }
}

interface Deps {
  tree: ArcanumTreeStore
  verify: VerifyFn
  nullifiers?: NullifierStore
}

export class ArcanumVerifier {
  private readonly nullifiers: NullifierStore

  constructor(private readonly deps: Deps) {
    this.nullifiers = deps.nullifiers ?? new MemoryNullifierStore()
  }

  /**
   * Verify a spend proof end to end:
   *  1. nullifierHash has not been spent before.
   *  2. merkleRoot matches current tree root.
   *  3. Groth16 proof is valid against the verification key.
   *  4. valor > 0.
   *
   * Returns the valor (as bigint) on success — caller uses it for balance check.
   * Throws a descriptive error on any failure.
   */
  async verify(spend: ArcanumSpendProof): Promise<{ nullifierHash: string; valor: bigint }> {
    const { proof, publicSignals } = spend
    const { root, nullifierHash, valor: valorStr, recipient } = publicSignals

    // 1. Nullifier not already spent (fast path — before any crypto)
    if (await this.nullifiers.has(nullifierHash)) {
      throw new Error(`Arcanum double-spend: nullifierHash ${nullifierHash} already spent`)
    }

    // 2. Merkle root matches current tree
    const currentRoot = await this.deps.tree.getRoot()
    if (root !== currentRoot) {
      throw new Error(`Arcanum stale root: proof root ${root} !== current root ${currentRoot}`)
    }

    // 3. Groth16 proof is valid
    // Public signals order must match circuit: [root, nullifierHash, valor, recipient]
    const signals = [root, nullifierHash, valorStr, recipient]
    const valid = await this.deps.verify(proof, signals)
    if (!valid) {
      throw new Error('Arcanum proof invalid: Groth16 verification failed')
    }

    const valor = BigInt(valorStr)
    if (valor <= 0n) throw new Error('Arcanum valor must be positive')

    return { nullifierHash, valor }
  }

  /**
   * Mark a nullifier as spent. Call this after the actum is successfully created.
   * If the actum creation fails, do NOT call this — the nullifier stays unspent.
   */
  async markSpent(nullifierHash: string): Promise<void> {
    await this.nullifiers.add(nullifierHash)
  }

  /** Check without spending — for informational queries. */
  async isSpent(nullifierHash: string): Promise<boolean> {
    return this.nullifiers.has(nullifierHash)
  }
}
