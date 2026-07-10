import { Collection } from 'mongodb'
import { v4 as uuidv4 } from 'uuid'
import type { Depositum, Depositorum } from '../types/catena.js'

function toDoc(d: Partial<Depositum>): Record<string, unknown> {
  // `valor` and the receipt-time `usdFmv` are bigints; Mongo can't store bigint, so both are
  // serialized as decimal strings and revived with BigInt() on read (the same convention
  // MongoSignorum/MongoRedituum use). `token` is a plain string and passes through untouched.
  const { valor, usdFmv, ...rest } = d
  return {
    ...rest,
    ...(valor !== undefined ? { valor: valor.toString() } : {}),
    ...(usdFmv !== undefined ? { usdFmv: usdFmv.toString() } : {}),
  }
}

function fromDoc(doc: Record<string, unknown>): Depositum {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { _id, valor, usdFmv, ...rest } = doc as Record<string, unknown> & { _id: unknown; valor: string; usdFmv?: string }
  return {
    ...rest,
    valor: BigInt(valor),
    ...(usdFmv !== undefined ? { usdFmv: BigInt(usdFmv) } : {}),
  } as Depositum
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
