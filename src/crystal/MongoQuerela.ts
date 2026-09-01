import { Collection } from 'mongodb'
import { v4 as uuidv4 } from 'uuid'
import type { Querela, QuerelaStore } from '../types/Querela.js'

function fromDoc(doc: Record<string, unknown>): Querela {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { _id, ...rest } = doc as Record<string, unknown> & { _id: unknown }
  return rest as unknown as Querela
}

export class MongoQuerela implements QuerelaStore {
  constructor(private col: Collection) {}

  async create(input: Omit<Querela, 'id' | 'natum' | 'mutatum'>): Promise<Querela> {
    const now = new Date()
    const q: Querela = { ...input, id: uuidv4(), natum: now, mutatum: now }
    await this.col.insertOne({ ...q })
    return q
  }

  async find(id: string): Promise<Querela | null> {
    const doc = await this.col.findOne({ id })
    return doc ? fromDoc(doc as Record<string, unknown>) : null
  }

  async findByOwner(ownerKey: string, status?: 'new' | 'closed'): Promise<Querela[]> {
    const filter: Record<string, unknown> = { ownerKey }
    if (status !== undefined) filter.status = status
    const docs = await this.col.find(filter).toArray()
    return docs.map(d => fromDoc(d as Record<string, unknown>))
  }

  async update(id: string, patch: Partial<Pick<Querela, 'status'>>): Promise<Querela> {
    const result = await this.col.findOneAndUpdate(
      { id },
      { $set: { ...patch, mutatum: new Date() } },
      { returnDocument: 'after' }
    )
    if (!result) throw new Error(`Querela not found: ${id}`)
    return fromDoc(result as Record<string, unknown>)
  }

  async findByOwnerAndHash(ownerKey: string, contentHash: string): Promise<Querela | null> {
    const doc = await this.col.findOne({ ownerKey, contentHash })
    return doc ? fromDoc(doc as Record<string, unknown>) : null
  }

  async list(filter?: { kind?: Querela['kind']; status?: Querela['status'] }): Promise<Querela[]> {
    const f: Record<string, unknown> = {}
    if (filter?.kind !== undefined) f.kind = filter.kind
    if (filter?.status !== undefined) f.status = filter.status
    const docs = await this.col.find(f).sort({ natum: -1 }).toArray()
    return docs.map(d => fromDoc(d as Record<string, unknown>))
  }
}
