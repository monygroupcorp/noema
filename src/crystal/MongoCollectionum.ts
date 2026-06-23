import type { Collection, Document } from 'mongodb'
import { randomUUID } from 'node:crypto'
import type { Collectio, Collectiones, CollectioStatus, Collectionum } from '../types/collectio.js'

// bigint is not a BSON type — stored as decimal string, converted on read/write
type CollectioDoc = Omit<Collectio, 'impetusTotal'> & { impetusTotal: string }

function toDoc(c: Partial<Collectio>): Record<string, unknown> {
  const { impetusTotal, ...rest } = c
  return {
    ...rest,
    ...(impetusTotal !== undefined ? { impetusTotal: impetusTotal.toString() } : {}),
  }
}

function fromDoc(doc: Document): Collectio {
  const { _id, impetusTotal, reiectae, ...rest } = doc as CollectioDoc & { _id: unknown }
  // `reiectae` post-dates the first collections — default legacy docs to 0.
  return { ...rest, reiectae: reiectae ?? 0, impetusTotal: BigInt(impetusTotal ?? '0') } as Collectio
}

export class MongoCollectionum implements Collectionum {
  constructor(private readonly col: Collection) {}

  async create(
    input: Omit<Collectio, 'id' | 'natum' | 'acta' | 'completae' | 'fractae' | 'reiectae' | 'impetusTotal'>
  ): Promise<Collectio> {
    const collectio: Collectio = {
      ...input,
      id: randomUUID(),
      natum: new Date(),
      acta: [],
      completae: 0,
      fractae: 0,
      reiectae: 0,
      impetusTotal: 0n,
    }
    await this.col.insertOne(toDoc(collectio))
    return collectio
  }

  async find(id: string): Promise<Collectio | null> {
    const doc = await this.col.findOne({ id })
    return doc ? fromDoc(doc) : null
  }

  async list(filter?: Partial<Pick<Collectio, 'status'>>): Promise<Collectiones> {
    const docs = await this.col.find(filter ?? {}).toArray()
    return docs.map(fromDoc)
  }

  async listByStatus(status: CollectioStatus): Promise<Collectiones> {
    return this.list({ status })
  }

  async update(
    id: string,
    patch: Partial<Pick<Collectio, 'status' | 'acta' | 'completae' | 'fractae' | 'reiectae' | 'impetusTotal' | 'completum' | 'numerus'>>
  ): Promise<Collectio> {
    const result = await this.col.findOneAndUpdate(
      { id },
      { $set: toDoc(patch) },
      { returnDocument: 'after' }
    )
    if (!result) throw new Error(`Collectio '${id}' not found`)
    return fromDoc(result)
  }
}
