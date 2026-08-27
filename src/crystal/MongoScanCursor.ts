// =============================================================================
// MongoScanCursor — where the deposit reconciler's block scan resumes from
// =============================================================================
//
// One document per chain in its own small operational collection. Deliberately NOT a money
// record: it holds no amount, no account and no attribution, and losing it costs a re-scan from
// the vault's deployment block — which is idempotent, and re-credits nothing.
// =============================================================================

import { Collection } from 'mongodb'
import type { ScanCursor } from './DepositReconciler.js'

interface ScanCursorDoc {
  chainId: string
  lastScannedBlock: number
  updated: Date
}

export class MongoScanCursor implements ScanCursor {
  constructor(private col: Collection) {}

  async ensureIndexes(): Promise<void> {
    await this.col.createIndex({ chainId: 1 }, { unique: true })
  }

  async get(chainId: string): Promise<number | null> {
    const doc = await this.col.findOne({ chainId }) as ScanCursorDoc | null
    return typeof doc?.lastScannedBlock === 'number' ? doc.lastScannedBlock : null
  }

  async set(chainId: string, block: number): Promise<void> {
    await this.col.updateOne(
      { chainId },
      { $set: { chainId, lastScannedBlock: block, updated: new Date() } },
      { upsert: true },
    )
  }
}
