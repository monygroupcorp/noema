import type { Collection, Document } from 'mongodb'
import { randomUUID } from 'node:crypto'
import type { Sodalitas, Sodalitates, Sodalitatum } from '../types/sodalitas.js'

// =============================================================================
// MongoSodalitatum — the team store (no bigint fields → plain marshalling)
// =============================================================================

function fromDoc(doc: Document): Sodalitas {
  const { _id, ...rest } = doc as Sodalitas & { _id: unknown }
  return rest as Sodalitas
}

export class MongoSodalitatum implements Sodalitatum {
  constructor(private readonly col: Collection) {}

  async find(id: string): Promise<Sodalitas | null> {
    const doc = await this.col.findOne({ id })
    return doc ? fromDoc(doc) : null
  }

  async create(input: Omit<Sodalitas, 'id' | 'natum'>): Promise<Sodalitas> {
    const sodalitas: Sodalitas = { ...input, id: randomUUID(), natum: new Date() }
    await this.col.insertOne({ ...sodalitas })
    return sodalitas
  }

  async update(id: string, patch: Partial<Pick<Sodalitas, 'membra' | 'nomen'>>): Promise<Sodalitas> {
    const result = await this.col.findOneAndUpdate({ id }, { $set: patch }, { returnDocument: 'after' })
    if (!result) throw new Error(`Sodalitas '${id}' not found`)
    return fromDoc(result)
  }

  async listByMember(animaId: string): Promise<Sodalitates> {
    const docs = await this.col.find({ membra: animaId }).toArray()
    return docs.map(fromDoc)
  }
}
