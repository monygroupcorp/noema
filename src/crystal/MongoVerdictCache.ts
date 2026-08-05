// =============================================================================
// MongoVerdictCache — durable content-addressed verdict cache (spec §7)
// =============================================================================
//
// Mongo backing for `VerdictCache`: one document per content key, upserted. Its own
// 'verdict_cache' collection, decoupled from the publish store.
// =============================================================================

import { Collection } from 'mongodb'
import type { CachedVerdict, VerdictCache } from './VerdictCache.js'

export class MongoVerdictCache implements VerdictCache {
  constructor(private col: Collection) {}

  async ensureIndexes(): Promise<void> {
    await this.col.createIndex({ key: 1 }, { unique: true })
  }

  async get(key: string): Promise<CachedVerdict | null> {
    const doc = await this.col.findOne({ key })
    if (!doc) return null
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { _id, ...rest } = doc as Record<string, unknown> & { _id: unknown }
    return rest as unknown as CachedVerdict
  }

  async put(v: CachedVerdict): Promise<void> {
    await this.col.updateOne({ key: v.key }, { $set: { ...v } }, { upsert: true })
  }
}
