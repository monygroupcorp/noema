import { Collection } from 'mongodb'
import { v4 as uuidv4 } from 'uuid'
import type { Testimonium, Testimonia, Testimoniorum } from '../types/catena.js'

function fromDoc(doc: Record<string, unknown>): Testimonium {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { _id, ...rest } = doc as Record<string, unknown> & { _id: unknown }
  return rest as Testimonium
}

export class MongoTestimoniorum implements Testimoniorum {
  constructor(private col: Collection) {}

  async create(input: Omit<Testimonium, 'id' | 'natum'>): Promise<Testimonium> {
    const t: Testimonium = { ...input, id: uuidv4(), natum: new Date() }
    await this.col.insertOne({ ...t })
    return t
  }

  async find(id: string): Promise<Testimonium | null> {
    const doc = await this.col.findOne({ id })
    return doc ? fromDoc(doc as Record<string, unknown>) : null
  }

  async findByPossessor(possessor: string, contractus: string): Promise<Testimonium | null> {
    const doc = await this.col.findOne({ possessor, contractus })
    return doc ? fromDoc(doc as Record<string, unknown>) : null
  }

  async listByAnima(animaId: string): Promise<Testimonia> {
    const docs = await this.col.find({ animaId, status: 'confirmatum' }).toArray()
    return docs.map(d => fromDoc(d as Record<string, unknown>))
  }

  async update(id: string, patch: Partial<Pick<Testimonium, 'status' | 'confirmatum'>>): Promise<Testimonium> {
    const result = await this.col.findOneAndUpdate(
      { id },
      { $set: patch },
      { returnDocument: 'after' }
    )
    if (!result) throw new Error(`Testimonium not found: ${id}`)
    return fromDoc(result as Record<string, unknown>)
  }
}
