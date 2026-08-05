// =============================================================================
// MongoTriageStore — the durable offline-triage store (spec §5)
// =============================================================================
//
// Mongo backing for `TriageStore`. One document per scored media item, keyed by the
// content-addressed `id` (SHA-256 of the url) so a re-scan upserts in place. Kept in
// its OWN collection ('triage'), decoupled from the live `editiones` publish store.
// =============================================================================

import { Collection } from 'mongodb'
import type { TriageScore, TriageStats, TriageStore } from '../types/triage.js'

function fromDoc(doc: Record<string, unknown>): TriageScore {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { _id, ...rest } = doc as Record<string, unknown> & { _id: unknown }
  return rest as unknown as TriageScore
}

export class MongoTriageStore implements TriageStore {
  constructor(private col: Collection) {}

  /** Indexes: unique on the content id (upsert key); flagged-review read; per-Actum. */
  async ensureIndexes(): Promise<void> {
    await this.col.createIndex({ id: 1 }, { unique: true })
    await this.col.createIndex({ sexual: 1, confidence: -1 })
    await this.col.createIndex({ actumId: 1 })
  }

  async put(score: TriageScore): Promise<void> {
    await this.col.updateOne({ id: score.id }, { $set: { ...score } }, { upsert: true })
  }

  async getByUrl(url: string): Promise<TriageScore | null> {
    const doc = await this.col.findOne({ url })
    return doc ? fromDoc(doc as Record<string, unknown>) : null
  }

  async listByActum(actumId: string): Promise<TriageScore[]> {
    const docs = await this.col.find({ actumId }).toArray()
    return docs.map((d) => fromDoc(d as Record<string, unknown>))
  }

  async listFlagged(opts?: { limit?: number; pendingOnly?: boolean }): Promise<TriageScore[]> {
    const query: Record<string, unknown> = { sexual: true }
    if (opts?.pendingOnly) {
      // Not yet adjudicated: reviewOutcome unset or still 'pending'.
      query.$or = [{ reviewOutcome: { $exists: false } }, { reviewOutcome: 'pending' }]
    }
    let cursor = this.col.find(query).sort({ confidence: -1, scannedAt: 1 })
    if (opts?.limit !== undefined) cursor = cursor.limit(opts.limit)
    const docs = await cursor.toArray()
    return docs.map((d) => fromDoc(d as Record<string, unknown>))
  }

  async stats(): Promise<TriageStats> {
    const scanned = await this.col.countDocuments({})
    const flagged = await this.col.countDocuments({ sexual: true })
    return { scanned, flagged, flagRate: scanned === 0 ? 0 : flagged / scanned }
  }
}
