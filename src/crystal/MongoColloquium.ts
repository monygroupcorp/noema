import { Collection } from 'mongodb'
import { v4 as uuidv4 } from 'uuid'
import type { Colloquium, ColloquiumStore } from '../types/colloquium.js'

function fromDoc(doc: Record<string, unknown>): Colloquium {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { _id, ...rest } = doc as Record<string, unknown> & { _id: unknown }
  return rest as unknown as Colloquium
}

export class MongoColloquium implements ColloquiumStore {
  constructor(private col: Collection) {}

  async create(input: Omit<Colloquium, 'id' | 'natum' | 'mutatum'>): Promise<Colloquium> {
    const now = new Date()
    const c: Colloquium = { ...input, id: uuidv4(), natum: now, mutatum: now }
    await this.col.insertOne({ ...c })
    return c
  }

  async find(id: string): Promise<Colloquium | null> {
    const doc = await this.col.findOne({ id })
    return doc ? fromDoc(doc as Record<string, unknown>) : null
  }

  async findByOwner(ownerKey: string, status?: 'active' | 'archived'): Promise<Colloquium[]> {
    const filter: Record<string, unknown> = { ownerKey }
    if (status !== undefined) filter.status = status
    const docs = await this.col.find(filter).toArray()
    return docs.map(d => fromDoc(d as Record<string, unknown>))
  }

  async update(id: string, patch: Partial<Pick<Colloquium, 'status' | 'modoId' | 'titulus'>>): Promise<Colloquium> {
    const result = await this.col.findOneAndUpdate(
      { id },
      { $set: { ...patch, mutatum: new Date() } },
      { returnDocument: 'after' }
    )
    if (!result) throw new Error(`Colloquium not found: ${id}`)
    return fromDoc(result as Record<string, unknown>)
  }

  async archive(id: string): Promise<Colloquium> {
    return this.update(id, { status: 'archived' })
  }

  /**
   * GDPR erasure (noema-025) — the caller's OWN colloquium ids (by `ownerKey`), gathered BEFORE
   * deletion so the eraser can cascade-delete their `Dictum` messages (keyed by `colloquiumId`)
   * first, then delete the colloquia. Read-only; safe to call on an already-erased soul (→ []).
   */
  async listIdsByOwner(ownerKey: string): Promise<string[]> {
    const docs = await this.col.find({ ownerKey }, { projection: { id: 1, _id: 0 } }).toArray()
    return docs.map(d => String((d as Record<string, unknown>).id))
  }

  /**
   * GDPR erasure (noema-025) — hard-delete every conversation (Colloquium) owned by `ownerKey`.
   * Delete the child `Dictum` rows via `MongoDictum.deleteByColloquia(listIdsByOwner(...))` FIRST,
   * then call this. Idempotent — a re-run deletes nothing and returns 0.
   */
  async deleteByOwner(ownerKey: string): Promise<number> {
    const r = await this.col.deleteMany({ ownerKey })
    return r.deletedCount ?? 0
  }
}
