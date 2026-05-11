import { Collection } from 'mongodb'
import { v4 as uuidv4 } from 'uuid'
import type { Depositum, Depositorum } from '../types/catena.js'

function toDoc(d: Partial<Depositum>): Record<string, unknown> {
  const { valor, ...rest } = d
  return { ...rest, ...(valor !== undefined ? { valor: valor.toString() } : {}) }
}

function fromDoc(doc: Record<string, unknown>): Depositum {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { _id, valor, ...rest } = doc as Record<string, unknown> & { _id: unknown; valor: string }
  return { ...rest, valor: BigInt(valor) } as Depositum
}

export class MongoDepositum implements Depositorum {
  constructor(private col: Collection) {}

  async create(input: Omit<Depositum, 'id' | 'natum'>): Promise<Depositum> {
    const d: Depositum = { ...input, id: uuidv4(), natum: new Date() }
    await this.col.insertOne(toDoc(d))
    return d
  }

  async find(id: string): Promise<Depositum | null> {
    const doc = await this.col.findOne({ id })
    return doc ? fromDoc(doc as Record<string, unknown>) : null
  }

  async findByHash(transactioHash: string, chainId: number | string): Promise<Depositum | null> {
    const doc = await this.col.findOne({ transactioHash, chainId })
    return doc ? fromDoc(doc as Record<string, unknown>) : null
  }

  async list(filter?: Partial<Pick<Depositum, 'status' | 'animaId'>>): Promise<Depositum[]> {
    const docs = await this.col.find(filter ?? {}).toArray()
    return docs.map(d => fromDoc(d as Record<string, unknown>))
  }

  async update(id: string, patch: Partial<Pick<Depositum, 'status' | 'confirmationes' | 'animaId' | 'signumId' | 'petitioId' | 'processatum'>>): Promise<Depositum> {
    const result = await this.col.findOneAndUpdate(
      { id },
      { $set: patch },
      { returnDocument: 'after' }
    )
    if (!result) throw new Error(`Depositum not found: ${id}`)
    return fromDoc(result as Record<string, unknown>)
  }
}
