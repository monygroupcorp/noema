import { Collection } from 'mongodb'
import { v4 as uuidv4 } from 'uuid'
import type { Collectio, Collectiones, CollectioStatus, Collectionum } from '../types/collectio.js'

function toDoc(c: Partial<Collectio>): Record<string, unknown> {
  const { impetusTotal, ...rest } = c
  return { ...rest, ...(impetusTotal !== undefined ? { impetusTotal: impetusTotal.toString() } : {}) }
}

function fromDoc(doc: Record<string, unknown>): Collectio {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { _id, impetusTotal, ...rest } = doc as Record<string, unknown> & { _id: unknown; impetusTotal: string }
  return { ...rest, impetusTotal: BigInt(impetusTotal ?? '0') } as Collectio
}

export class MongoCollectio implements Collectionum {
  constructor(private col: Collection) {}

  async create(input: Omit<Collectio, 'id' | 'natum' | 'acta' | 'completae' | 'fractae' | 'impetusTotal'>): Promise<Collectio> {
    const now = new Date()
    const c: Collectio = { ...input, id: uuidv4(), acta: [], completae: 0, fractae: 0, impetusTotal: 0n, natum: now }
    await this.col.insertOne(toDoc(c))
    return c
  }

  async find(id: string): Promise<Collectio | null> {
    const doc = await this.col.findOne({ id })
    return doc ? fromDoc(doc as Record<string, unknown>) : null
  }

  async list(filter?: Partial<Pick<Collectio, 'status'>>): Promise<Collectiones> {
    const docs = await this.col.find(filter ?? {}).toArray()
    return docs.map(d => fromDoc(d as Record<string, unknown>))
  }

  async listByStatus(status: CollectioStatus): Promise<Collectiones> {
    return this.list({ status })
  }

  async update(id: string, patch: Partial<Pick<Collectio, 'status' | 'acta' | 'completae' | 'fractae' | 'reiectae' | 'impetusTotal' | 'completum' | 'numerus' | 'tractus' | 'provenanceHash'>>): Promise<Collectio> {
    const result = await this.col.findOneAndUpdate(
      { id },
      { $set: toDoc(patch) },
      { returnDocument: 'after' }
    )
    if (!result) throw new Error(`Collectio not found: ${id}`)
    return fromDoc(result as Record<string, unknown>)
  }
}
