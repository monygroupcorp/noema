import type { Collection, Document } from 'mongodb'
import type { Modus, Modi, Modorum } from '../types/modus.js'

// bigint impetusFixum stored as decimal string, absent when undefined
type ModusDoc = Omit<Modus, 'impetusFixum'> & { impetusFixum?: string }

function toDoc(m: Modus): Omit<ModusDoc, never> {
  const { impetusFixum, ...rest } = m
  const doc: Record<string, unknown> = { ...rest }
  if (impetusFixum !== undefined) doc.impetusFixum = impetusFixum.toString()
  return doc as ModusDoc
}

function fromDoc(doc: Document): Modus {
  const { _id, impetusFixum, ...rest } = doc as ModusDoc & { _id: unknown }
  const m: Record<string, unknown> = { ...rest }
  if (impetusFixum !== undefined) m.impetusFixum = BigInt(impetusFixum)
  return m as unknown as Modus
}

export class MongoModorum implements Modorum {
  constructor(private readonly col: Collection) {}

  async register(modus: Modus): Promise<void> {
    const doc = toDoc(modus)
    await this.col.updateOne(
      { id: modus.id, versio: modus.versio },
      { $set: doc },
      { upsert: true },
    )
  }

  async find(id: string, versio?: string): Promise<Modus | null> {
    const query: Record<string, unknown> = { id }
    if (versio) query.versio = versio

    const doc = versio
      ? await this.col.findOne(query)
      : await this.col.findOne(query, { sort: { natum: -1 } })

    return doc ? fromDoc(doc) : null
  }

  async list(filter?: Partial<Pick<Modus, 'genus' | 'canonica' | 'auctor'>>): Promise<Modi> {
    const query: Record<string, unknown> = {}
    if (filter?.genus !== undefined) query.genus = filter.genus
    if (filter?.canonica !== undefined) query.canonica = filter.canonica
    // `auctor` is the `{ animaId } | { commitment }` owner union — stored as a nested
    // object. Query the discriminant field directly so `list({ auctor })` matches by
    // owner regardless of which side of the union is set.
    if (filter?.auctor !== undefined) {
      if ('animaId' in filter.auctor) query['auctor.animaId'] = filter.auctor.animaId
      else if ('commitment' in filter.auctor) query['auctor.commitment'] = filter.auctor.commitment
      else query['auctor.bursaToken'] = filter.auctor.bursaToken
    }

    const docs = await this.col.find(query).toArray()
    return docs.map(fromDoc)
  }

  async update(id: string, patch: Partial<Pick<Modus, 'computeStrategy' | 'gpuClass' | 'podPolicy'>>): Promise<Modus> {
    const result = await this.col.findOneAndUpdate(
      { id },
      { $set: { ...patch, mutatum: new Date() } },
      { returnDocument: 'after', sort: { natum: -1 } },
    )
    if (!result) throw new Error(`Modus not found: ${id}`)
    return fromDoc(result)
  }
}
