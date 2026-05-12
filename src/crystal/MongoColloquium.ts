import { Collection } from 'mongodb'
import { v4 as uuidv4 } from 'uuid'
import type { Colloquium, ColloquiumStore } from '../types/colloquium.js'

function fromDoc(doc: Record<string, unknown>): Colloquium {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { _id, ...rest } = doc as Record<string, unknown> & { _id: unknown }
  return rest as Colloquium
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

  async findByAnima(animaId: string, status?: 'active' | 'archived'): Promise<Colloquium[]> {
    const filter: Record<string, unknown> = { animaId }
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
}
