import { Collection } from 'mongodb'
import { v4 as uuidv4 } from 'uuid'
import type { Anima, AnimaStore } from '../types/anima.js'

function fromDoc(doc: Record<string, unknown>): Anima {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { _id, ...rest } = doc as Record<string, unknown> & { _id: unknown }
  return rest as unknown as Anima
}

export class MongoAnima implements AnimaStore {
  constructor(private col: Collection) {}

  async create(input: Omit<Anima, 'id' | 'natum' | 'mutatum'>): Promise<Anima> {
    const now = new Date()
    const anima: Anima = { ...input, id: uuidv4(), natum: now, mutatum: now }
    const { custos, ...rest } = anima
    const doc = custos !== undefined ? { ...rest, custos } : rest
    await this.col.insertOne(doc)
    return anima
  }

  async find(id: string): Promise<Anima | null> {
    const doc = await this.col.findOne({ id })
    return doc ? fromDoc(doc as Record<string, unknown>) : null
  }

  async findByCustos(custos: string): Promise<Anima | null> {
    const doc = await this.col.findOne({ custos })
    return doc ? fromDoc(doc as Record<string, unknown>) : null
  }

  async update(
    id: string,
    patch: Partial<Pick<Anima, 'nomen' | 'memoriaRef' | 'custos'>>
  ): Promise<Anima> {
    const mutatum = new Date()
    const result = await this.col.findOneAndUpdate(
      { id },
      { $set: { ...patch, mutatum } },
      { returnDocument: 'after' }
    )
    if (!result) throw new Error(`Anima not found: ${id}`)
    return fromDoc(result as Record<string, unknown>)
  }
}
