import { Collection } from 'mongodb'
import { v4 as uuidv4 } from 'uuid'
import type { Petitio, Petitionum } from '../types/catena.js'

function toDoc(p: Partial<Petitio>): Record<string, unknown> {
  const { valuta, ...rest } = p
  return { ...rest, ...(valuta !== undefined ? { valuta: valuta.toString() } : {}) }
}

function fromDoc(doc: Record<string, unknown>): Petitio {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { _id, valuta, ...rest } = doc as Record<string, unknown> & { _id: unknown; valuta: string }
  return { ...rest, valuta: BigInt(valuta) } as Petitio
}

export class MongoPetitio implements Petitionum {
  constructor(private col: Collection) {}

  async create(input: Omit<Petitio, 'id' | 'natum'>): Promise<Petitio> {
    const p: Petitio = { ...input, id: uuidv4(), natum: new Date() }
    await this.col.insertOne(toDoc(p))
    return p
  }

  async find(id: string): Promise<Petitio | null> {
    const doc = await this.col.findOne({ id })
    return doc ? fromDoc(doc as Record<string, unknown>) : null
  }

  async findExpectans(animaId: string): Promise<Petitio | null> {
    const doc = await this.col.findOne({ animaId, status: 'expectans' })
    return doc ? fromDoc(doc as Record<string, unknown>) : null
  }

  async update(id: string, patch: Partial<Pick<Petitio, 'status' | 'depositumId' | 'walletAddress' | 'confirmata'>>): Promise<Petitio> {
    const result = await this.col.findOneAndUpdate(
      { id },
      { $set: patch },
      { returnDocument: 'after' }
    )
    if (!result) throw new Error(`Petitio not found: ${id}`)
    return fromDoc(result as Record<string, unknown>)
  }

  async expireStale(at: Date): Promise<number> {
    const result = await this.col.updateMany(
      { status: 'expectans', expirat: { $lte: at } },
      { $set: { status: 'expirata' } }
    )
    return result.modifiedCount
  }
}
