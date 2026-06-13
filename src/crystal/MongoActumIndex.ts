import type { Collection } from 'mongodb'
import type { ActumIndex, ActumIndexStore } from '../types/actumIndex.js'
import type { AuctorKey } from '../flow/types.js'

/**
 * MongoActumIndex — Mongo-backed ActumIndexStore. One document per actumId
 * (unique). Either `animaId` OR `commitment` is set on each document; queries
 * filter by whichever the AuctorKey carries. Recommended indexes on both
 * (sparse) fields for hot `/status` reads.
 */
export class MongoActumIndex implements ActumIndexStore {
  constructor(private readonly col: Collection) {}

  async record(entry: ActumIndex): Promise<void> {
    await this.col.replaceOne({ actumId: entry.actumId }, entry, { upsert: true })
  }

  async findFor(key: AuctorKey): Promise<ActumIndex[]> {
    // bursaToken runs are not indexed — dispatchInceptio skips the record() call for them.
    // The index exists for identified (animaId) and arcanum commitment runs only.
    if ('bursaToken' in key) return []
    const filter = 'animaId' in key
      ? { animaId: key.animaId }
      : { commitment: key.commitment }
    const docs = await this.col.find(filter).toArray()
    return docs.map(d => {
      const { _id: _omit, ...rest } = d as ActumIndex & { _id: unknown }
      return rest as ActumIndex
    })
  }

  async remove(actumId: string): Promise<void> {
    await this.col.deleteOne({ actumId })
  }
}
