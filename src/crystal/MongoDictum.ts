import { Collection } from 'mongodb'
import { v4 as uuidv4 } from 'uuid'
import type { Dictum, DictumStore } from '../types/colloquium.js'

function fromDoc(doc: Record<string, unknown>): Dictum {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { _id, ...rest } = doc as Record<string, unknown> & { _id: unknown }
  return rest as Dictum
}

export class MongoDictum implements DictumStore {
  constructor(private col: Collection) {}

  async create(input: Omit<Dictum, 'id' | 'natum'>): Promise<Dictum> {
    const d: Dictum = { ...input, id: uuidv4(), natum: new Date() }
    await this.col.insertOne({ ...d })
    return d
  }

  async findById(id: string): Promise<Dictum | null> {
    const doc = await this.col.findOne({ id })
    return doc ? fromDoc(doc as Record<string, unknown>) : null
  }

  async listByColloquium(colloquiumId: string): Promise<Dictum[]> {
    const docs = await this.col.find({ colloquiumId }).sort({ natum: 1 }).toArray()
    return docs.map(d => fromDoc(d as Record<string, unknown>))
  }

  async update(id: string, patch: Partial<Pick<Dictum, 'actumId' | 'signaIds'>>): Promise<Dictum> {
    const result = await this.col.findOneAndUpdate(
      { id },
      { $set: { ...patch } },
      { returnDocument: 'after' }
    )
    if (!result) throw new Error(`Dictum not found: ${id}`)
    return fromDoc(result as Record<string, unknown>)
  }
}
