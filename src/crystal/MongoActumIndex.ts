import type { Collection } from 'mongodb'
import type { ActumIndex, ActumIndexStore } from '../types/actumIndex.js'

/**
 * MongoActumIndex — Mongo-backed ActumIndexStore. One document per actumId.
 * `animaId` indexed for the /status hot path; `actumId` is the unique key.
 */
export class MongoActumIndex implements ActumIndexStore {
  constructor(private readonly col: Collection) {}

  async record(entry: ActumIndex): Promise<void> {
    await this.col.replaceOne({ actumId: entry.actumId }, entry, { upsert: true })
  }

  async findFor(animaId: string): Promise<ActumIndex[]> {
    const docs = await this.col.find({ animaId }).toArray()
    return docs.map(d => {
      const { _id: _omit, ...rest } = d as ActumIndex & { _id: unknown }
      return rest as ActumIndex
    })
  }

  async remove(actumId: string): Promise<void> {
    await this.col.deleteOne({ actumId })
  }
}
