import { Collection } from 'mongodb'
import { v4 as uuidv4 } from 'uuid'
import type { Modo, ModoStore } from '../types/modo.js'

const LIVE_STATUSES = ['claiming', 'warming', 'active', 'idle']

function toDoc(m: Partial<Modo>): Record<string, unknown> {
  const { impetusAccrued, ...rest } = m
  return {
    ...rest,
    ...(impetusAccrued !== undefined ? { impetusAccrued: impetusAccrued.toString() } : {}),
  }
}

function fromDoc(doc: Record<string, unknown>): Modo {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { _id, impetusAccrued, ...rest } = doc as Record<string, unknown> & { _id: unknown; impetusAccrued: string }
  return { ...rest, impetusAccrued: BigInt(impetusAccrued) } as Modo
}

export class MongoModo implements ModoStore {
  constructor(private col: Collection) {}

  async create(input: Omit<Modo, 'id' | 'inceptum'>): Promise<Modo> {
    const inceptum = new Date()
    const modo: Modo = { ...input, id: uuidv4(), inceptum }
    await this.col.insertOne(toDoc(modo))
    return modo
  }

  async findById(id: string): Promise<Modo | null> {
    const doc = await this.col.findOne({ id })
    return doc ? fromDoc(doc as Record<string, unknown>) : null
  }

  async update(
    id: string,
    patch: Partial<Pick<Modo, 'status' | 'materiamId' | 'impetusAccrued' | 'acta' | 'terminatum'>>
  ): Promise<Modo> {
    const result = await this.col.findOneAndUpdate(
      { id },
      { $set: toDoc(patch) },
      { returnDocument: 'after' }
    )
    if (!result) throw new Error(`Modo not found: ${id}`)
    return fromDoc(result as Record<string, unknown>)
  }

  async findActive(): Promise<Modo[]> {
    const docs = await this.col.find({ status: { $in: LIVE_STATUSES } }).toArray()
    return docs.map(d => fromDoc(d as Record<string, unknown>))
  }
}
