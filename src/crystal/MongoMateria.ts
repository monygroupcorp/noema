import type { Collection, Document } from 'mongodb'
import type { Materia, MateriaStore, PodPolicy } from '../types/materia.js'

// bigint is not a BSON type — stored as decimal string, converted on read/write
type MateriaDoc = Omit<Materia, 'impetusPerSecond'> & { impetusPerSecond: string }

function toDoc(m: Partial<Materia>): Record<string, unknown> {
  const { impetusPerSecond, ...rest } = m
  return {
    ...rest,
    ...(impetusPerSecond !== undefined ? { impetusPerSecond: impetusPerSecond.toString() } : {}),
  }
}

function fromDoc(doc: Document): Materia {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { _id, impetusPerSecond, ...rest } = doc as MateriaDoc & { _id: unknown }
  return { ...rest, impetusPerSecond: BigInt(impetusPerSecond) } as Materia
}

export class MongoMateria implements MateriaStore {
  constructor(private readonly col: Collection) {}

  async create(input: Omit<Materia, 'id'>): Promise<Materia> {
    const { v4: uuidv4 } = await import('uuid')
    const materia: Materia = { ...input, id: uuidv4() }
    await this.col.insertOne(toDoc(materia))
    return materia
  }

  async findById(id: string): Promise<Materia | null> {
    const doc = await this.col.findOne({ id })
    return doc ? fromDoc(doc) : null
  }

  async update(
    id: string,
    patch: Partial<Pick<Materia, 'status' | 'sshHost' | 'sshPort' | 'imageRef' | 'terminatum' | 'podPolicy' | 'shareToken'>>
  ): Promise<Materia> {
    const result = await this.col.findOneAndUpdate(
      { id },
      { $set: toDoc(patch) },
      { returnDocument: 'after' }
    )
    if (!result) throw new Error(`Materia ${id} not found`)
    return fromDoc(result)
  }

  async findWarm(spec: { imageRef?: string; podPolicy?: PodPolicy; shareToken?: string }): Promise<Materia | null> {
    const filter: Record<string, unknown> = { status: 'idle' }
    if (spec.imageRef) filter.imageRef = spec.imageRef
    if (spec.podPolicy) filter.podPolicy = spec.podPolicy
    if (spec.shareToken) filter.shareToken = spec.shareToken
    // Atomic claim: only matches idle pods and transitions to active in one operation.
    // Prevents two concurrent requests from dispatching to the same warm pod.
    const doc = await this.col.findOneAndUpdate(
      filter,
      { $set: { status: 'active' } },
      { returnDocument: 'after' }
    )
    return doc ? fromDoc(doc) : null
  }

  async findActive(): Promise<Materia[]> {
    const docs = await this.col.find({ status: { $ne: 'terminated' } }).toArray()
    return docs.map(fromDoc)
  }
}
