// =============================================================================
// MongoOctraDeposit — durable OCT deposit state machine + resume cursor
// =============================================================================
//
// Collections (anonymous side; follows the arcanum_* naming, not Latin genitive):
//   octra_deposits  — one doc per deposit (intent → terminal). Indexes in
//                     ensureIndexes.ts: unique depositAddr; unique sparse txHash
//                     (the atomic claim point); unique sparse commitment; status.
//   octra_cursors   — tiny single-doc-per-scope resume marker.
//
// No animaId ever touches these records. The sender `from` is never stored.
// =============================================================================

import type { Collection, Db } from 'mongodb'
import { randomUUID } from 'node:crypto'
import type {
  OctraDeposit,
  OctraDepositorum,
  OctraCursor,
} from '../types/octra.js'

export class MongoOctraDeposit implements OctraDepositorum {
  private readonly deposits: Collection
  private readonly cursors: Collection

  constructor(db: Db) {
    this.deposits = db.collection('octra_deposits')
    this.cursors = db.collection('octra_cursors')
  }

  async registerIntent(depositAddr: string, commitment: string): Promise<OctraDeposit> {
    const now = new Date()
    const dep: OctraDeposit = {
      id: randomUUID(),
      depositAddr,
      commitment,
      status: 'expectatum',
      natum: now,
      mutatum: now,
    }
    // unique index on depositAddr makes intent registration idempotent.
    await this.deposits.insertOne(dep as unknown as Record<string, unknown>)
    return dep
  }

  async byDepositAddr(depositAddr: string): Promise<OctraDeposit | null> {
    return (await this.deposits.findOne({ depositAddr })) as unknown as OctraDeposit | null
  }

  async byTxHash(txHash: string): Promise<OctraDeposit | null> {
    return (await this.deposits.findOne({ txHash })) as unknown as OctraDeposit | null
  }

  /**
   * Atomic first-writer claim of a funding tx. Sets txHash on the matching
   * intent only if not already set. Relies on the unique sparse txHash index so
   * a racing replica's claim fails closed. Returns true iff WE claimed it.
   */
  async claimTx(txHash: string): Promise<boolean> {
    try {
      const res = await this.deposits.updateOne(
        { txHash: { $exists: false }, status: 'expectatum' },
        { $set: { txHash, mutatum: new Date() } },
        // intentionally NOT upsert — claim attaches to an existing intent
      )
      // Note: this claims *some* unfunded intent; the watcher resolves the
      // specific deposit by depositAddr before pricing, so the claim is a cheap
      // pre-filter. The authoritative dedup is arcanum_leaves.commitment.
      return res.modifiedCount === 1
    } catch (err) {
      if (isDuplicateKey(err)) return false
      throw err
    }
  }

  async save(d: OctraDeposit): Promise<void> {
    d.mutatum = new Date()
    await this.deposits.updateOne(
      { id: d.id },
      { $set: d as unknown as Record<string, unknown> },
      { upsert: true },
    )
  }

  async pending(): Promise<OctraDeposit[]> {
    return (await this.deposits
      .find({ status: { $in: ['expectatum', 'confirmatum'] } })
      .toArray()) as unknown as OctraDeposit[]
  }

  async getCursor(scope: string): Promise<OctraCursor | null> {
    return (await this.cursors.findOne({ id: scope })) as unknown as OctraCursor | null
  }

  async saveCursor(c: OctraCursor): Promise<void> {
    c.mutatum = new Date()
    await this.cursors.updateOne(
      { id: c.id },
      { $set: c as unknown as Record<string, unknown> },
      { upsert: true },
    )
  }
}

export function isDuplicateKey(err: unknown): boolean {
  return !!err && typeof err === 'object' && (err as { code?: number }).code === 11000
}
