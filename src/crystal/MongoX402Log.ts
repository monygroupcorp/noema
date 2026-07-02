import { Collection } from 'mongodb'
import type { X402LogEntry, X402LogStore } from '../types/x402.js'

function fromDoc(doc: Record<string, unknown>): X402LogEntry {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { _id, ...rest } = doc as Record<string, unknown> & { _id: unknown }
  return rest as unknown as X402LogEntry
}

/** Mongo-backed x402 payment audit trail. `signatureHash` MUST carry a unique index
 *  (ensureIndexes) — that unique constraint IS the replay guard. */
export class MongoX402Log implements X402LogStore {
  constructor(private col: Collection) {}

  async recordVerified(entry: Omit<X402LogEntry, 'status' | 'verifiedAt'>): Promise<boolean> {
    try {
      await this.col.insertOne({ ...entry, status: 'VERIFIED', verifiedAt: new Date() })
      return true
    } catch (err) {
      if ((err as { code?: number }).code === 11000) return false // replay — already recorded
      throw err
    }
  }

  async recordSettled(signatureHash: string, txHash: string, runId?: string): Promise<void> {
    await this.col.updateOne(
      { signatureHash },
      { $set: { status: 'SETTLED', txHash, settledAt: new Date(), ...(runId ? { runId } : {}) } },
    )
  }

  async recordFailed(signatureHash: string, reason: string): Promise<void> {
    await this.col.updateOne(
      { signatureHash },
      { $set: { status: 'FAILED', failureReason: reason, failedAt: new Date() } },
    )
  }

  async find(signatureHash: string): Promise<X402LogEntry | null> {
    const doc = await this.col.findOne({ signatureHash })
    return doc ? fromDoc(doc as Record<string, unknown>) : null
  }
}
