import type { Collection, Document } from 'mongodb'
import type { Hospitium, HospitiumStore } from '../types/hospitium.js'

function fromDoc(doc: Document): Hospitium {
  const { _id: _omit, ...rest } = doc as Hospitium & { _id: unknown }
  return rest as Hospitium
}

/**
 * MongoHospitium — Mongo-backed HospitiumStore.
 *
 * One Hospitium per Materia (1:1, keyed by `materiaId`). Identity-bearing hosting
 * metadata that we deliberately keep OUT of the Materia row (see types/hospitium.ts
 * for the privacy rationale).
 */
export class MongoHospitium implements HospitiumStore {
  constructor(private readonly col: Collection) {}

  async create(input: Omit<Hospitium, 'id'>): Promise<Hospitium> {
    const { v4: uuidv4 } = await import('uuid')
    const hospitium: Hospitium = { ...input, id: uuidv4() }
    await this.col.insertOne(hospitium as unknown as Document)
    return hospitium
  }

  async findByMateriaId(materiaId: string): Promise<Hospitium | null> {
    const doc = await this.col.findOne({ materiaId })
    return doc ? fromDoc(doc) : null
  }

  async update(
    materiaId: string,
    patch: Partial<Pick<Hospitium, 'adminAnimaIds' | 'terminatum'>>,
  ): Promise<Hospitium> {
    const result = await this.col.findOneAndUpdate(
      { materiaId },
      { $set: patch },
      { returnDocument: 'after' },
    )
    if (!result) throw new Error(`Hospitium for materia ${materiaId} not found`)
    return fromDoc(result)
  }
}
