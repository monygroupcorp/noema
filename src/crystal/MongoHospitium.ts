import type { Collection, Document } from 'mongodb'
import type { Hospitium, HospitiumStore } from '../types/hospitium.js'

// bigint isn't a BSON type — costAccrued stored as a decimal string, converted
// on read/write. Same pattern as MongoMateria's impetusPerSecond / MongoActorum's
// executio.finalImpetus.
function toDoc(h: Omit<Hospitium, 'id'> | Hospitium): Document {
  const { costAccrued, ...rest } = h as Hospitium
  return {
    ...rest,
    ...(costAccrued !== undefined ? { costAccrued: costAccrued.toString() } : {}),
  }
}

function fromDoc(doc: Document): Hospitium {
  const { _id: _omit, costAccrued, ...rest } = doc as Hospitium & { _id: unknown; costAccrued?: string | bigint }
  return {
    ...rest,
    ...(typeof costAccrued === 'string' ? { costAccrued: BigInt(costAccrued) } : costAccrued !== undefined ? { costAccrued } : {}),
  } as Hospitium
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
    await this.col.insertOne(toDoc(hospitium))
    return hospitium
  }

  async findByMateriaId(materiaId: string): Promise<Hospitium | null> {
    const doc = await this.col.findOne({ materiaId })
    return doc ? fromDoc(doc) : null
  }

  async update(
    materiaId: string,
    patch: Partial<Pick<Hospitium, 'adminAnimaIds' | 'terminatum' | 'costAccrued' | 'lastBilledAt'>>,
  ): Promise<Hospitium> {
    const { costAccrued, ...rest } = patch
    const $set: Record<string, unknown> = { ...rest }
    if (costAccrued !== undefined) $set.costAccrued = costAccrued.toString()

    const result = await this.col.findOneAndUpdate(
      { materiaId },
      { $set },
      { returnDocument: 'after' },
    )
    if (!result) throw new Error(`Hospitium for materia ${materiaId} not found`)
    return fromDoc(result)
  }

  async findActive(): Promise<Hospitium[]> {
    const docs = await this.col.find({ terminatum: { $exists: false } }).toArray()
    return docs.map(fromDoc)
  }
}
