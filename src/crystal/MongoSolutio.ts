import { Collection } from 'mongodb'
import { v4 as uuidv4 } from 'uuid'
import type { Solutio, Solutionum } from '../types/catena.js'

function toDoc(s: Partial<Solutio>): Record<string, unknown> {
  const { valor, ...rest } = s
  return { ...rest, ...(valor !== undefined ? { valor: valor.toString() } : {}) }
}

function fromDoc(doc: Record<string, unknown>): Solutio {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { _id, valor, ...rest } = doc as Record<string, unknown> & { _id: unknown; valor: string }
  return { ...rest, valor: BigInt(valor) } as Solutio
}

export class MongoSolutio implements Solutionum {
  constructor(private col: Collection) {}

  async create(input: Omit<Solutio, 'id' | 'natum'>): Promise<Solutio> {
    const s: Solutio = { ...input, id: uuidv4(), natum: new Date() }
    await this.col.insertOne(toDoc(s))
    return s
  }

  async find(id: string): Promise<Solutio | null> {
    const doc = await this.col.findOne({ id })
    return doc ? fromDoc(doc as Record<string, unknown>) : null
  }

  async update(id: string, patch: Partial<Pick<Solutio, 'status' | 'signumId' | 'processata'>>): Promise<Solutio> {
    const result = await this.col.findOneAndUpdate(
      { id },
      { $set: patch },
      { returnDocument: 'after' }
    )
    if (!result) throw new Error(`Solutio not found: ${id}`)
    return fromDoc(result as Record<string, unknown>)
  }
}
