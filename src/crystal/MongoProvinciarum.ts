import type { Collection, Document } from 'mongodb'
import { randomUUID } from 'node:crypto'
import type { Provincia, Provinciae, ProvinciaPatch, ProvinciaRes, Provinciarum } from '../types/provincia.js'

// =============================================================================
// MongoProvinciarum — the project store (no bigint fields → plain marshalling)
// =============================================================================

function fromDoc(doc: Document): Provincia {
  const { _id, ...rest } = doc as Provincia & { _id: unknown }
  return rest as Provincia
}

export class MongoProvinciarum implements Provinciarum {
  constructor(private readonly col: Collection) {}

  async find(id: string): Promise<Provincia | null> {
    const doc = await this.col.findOne({ id })
    return doc ? fromDoc(doc) : null
  }

  async create(input: Omit<Provincia, 'id' | 'natum' | 'mutatum'>): Promise<Provincia> {
    const now = new Date()
    const provincia: Provincia = { ...input, id: randomUUID(), natum: now, mutatum: now }
    await this.col.insertOne({ ...provincia })
    return provincia
  }

  async update(id: string, patch: ProvinciaPatch): Promise<Provincia> {
    // Split the patch: defined fields → $set, undefined fields → $unset (so clearing an
    // optional field like `sodalitasId` REMOVES it, not stores a null the projection would
    // then emit as teamId:null). $set always carries the mutatum bump.
    const set: Record<string, unknown> = { mutatum: new Date() }
    const unset: Record<string, ''> = {}
    for (const [k, v] of Object.entries(patch)) {
      if (v === undefined) unset[k] = ''
      else set[k] = v
    }
    const update: Record<string, unknown> = { $set: set }
    if (Object.keys(unset).length) update.$unset = unset
    const result = await this.col.findOneAndUpdate({ id }, update, { returnDocument: 'after' })
    if (!result) throw new Error(`Provincia '${id}' not found`)
    return fromDoc(result)
  }

  async setRes(id: string, res: ProvinciaRes): Promise<Provincia> {
    const result = await this.col.findOneAndUpdate(
      { id },
      { $set: { res, mutatum: new Date() } },
      { returnDocument: 'after' },
    )
    if (!result) throw new Error(`Provincia '${id}' not found`)
    return fromDoc(result)
  }

  async remove(id: string): Promise<void> {
    await this.col.deleteOne({ id })
  }

  async listByOwner(animaId: string): Promise<Provinciae> {
    const docs = await this.col.find({ animaId }).toArray()
    return docs.map(fromDoc)
  }
}
