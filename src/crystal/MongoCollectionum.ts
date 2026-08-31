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
  const { _id, impetusTotal, reiectae, pendentes, ...rest } = doc as CollectioDoc & { _id: unknown }
  // `reiectae` and `pendentes` post-date the first collections — default legacy docs to 0. Both
  // are arithmetic (the dispatch budget, and the piece-count identity), so undefined is not an
  // option: it would poison every sum they take part in.
  return { ...rest, reiectae: reiectae ?? 0, pendentes: pendentes ?? 0, impetusTotal: BigInt(impetusTotal ?? '0') } as Collectio
}

export class MongoCollectionum implements Collectionum {
  constructor(private readonly col: Collection) {}

  async create(
    input: Omit<Collectio, 'id' | 'natum' | 'acta' | 'completae' | 'fractae' | 'pendentes' | 'reiectae' | 'impetusTotal'>
  ): Promise<Collectio> {
    const collectio: Collectio = {
      ...input,
      id: randomUUID(),
      natum: new Date(),
      acta: [],
      completae: 0,
      fractae: 0,
      pendentes: 0,
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
    patch: Partial<Pick<Collectio, 'status' | 'acta' | 'completae' | 'fractae' | 'pendentes' | 'reiectae' | 'impetusTotal' | 'completum' | 'numerus' | 'tractus' | 'provenanceHash' | 'pausatum'>>
  ): Promise<Collectio> {
    // `pausatum: undefined` means "clear the pause" (resume) — $unset it rather
    // than $set-ing an undefined value (which Mongo would otherwise reject/drop).
    const { pausatum, ...rest } = patch
    const update: Record<string, unknown> = {}
    const setDoc = toDoc(rest)
    if (Object.keys(setDoc).length) update.$set = setDoc
    if ('pausatum' in patch) {
      if (pausatum === undefined) update.$unset = { pausatum: '' }
      else update.$set = { ...(update.$set as Record<string, unknown> | undefined), pausatum }
    }
    const result = await this.col.findOneAndUpdate(
      { id },
      update,
      { returnDocument: 'after' }
    )
    if (!result) throw new Error(`Collectio '${id}' not found`)
    return fromDoc(result)
  }
}
