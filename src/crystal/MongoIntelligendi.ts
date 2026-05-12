import type { Collection, Document } from 'mongodb'
import { v4 as uuidv4 } from 'uuid'
import type {
  Intelligens,
  Intelligentia,
  IntelligentiumStore,
  IntelligensGenus,
  IntelligensPrivacy,
} from '../types/intelligendi.js'

function fromDoc(doc: Document): Intelligens {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { _id, ...rest } = doc as Document & { _id: unknown }
  return rest as Intelligens
}

export class MongoIntelligendi implements IntelligentiumStore {
  constructor(private readonly col: Collection) {}

  async create(
    input: Omit<Intelligens, 'id' | 'natum' | 'mutatum' | 'stellae'>
  ): Promise<Intelligens> {
    const now = new Date()
    const intelligens: Intelligens = {
      ...input,
      id: uuidv4(),
      stellae: 0,
      natum: now,
      mutatum: now,
    }
    await this.col.insertOne({ ...intelligens })
    return intelligens
  }

  async find(id: string): Promise<Intelligens | null> {
    const doc = await this.col.findOne({ id })
    return doc ? fromDoc(doc) : null
  }

  async list(filter?: {
    genus?: IntelligensGenus
    basis?: string
    auctor?: string
    canonica?: boolean
    privacy?: IntelligensPrivacy
  }): Promise<Intelligentia> {
    const query: Record<string, unknown> = {}
    if (filter?.genus !== undefined) query.genus = filter.genus
    if (filter?.basis !== undefined) query.basis = filter.basis
    if (filter?.auctor !== undefined) query.auctor = filter.auctor
    if (filter?.canonica !== undefined) query.canonica = filter.canonica
    if (filter?.privacy !== undefined) query.privacy = filter.privacy

    const docs = await this.col.find(query).toArray()
    return docs.map(fromDoc)
  }

  async update(
    id: string,
    patch: Partial<Pick<Intelligens, 'nomen' | 'descriptio' | 'notae' | 'verba' | 'privacy' | 'stellae' | 'contentHash'>>
  ): Promise<Intelligens> {
    const result = await this.col.findOneAndUpdate(
      { id },
      { $set: { ...patch, mutatum: new Date() } },
      { returnDocument: 'after' }
    )
    if (!result) throw new Error(`Intelligens not found: ${id}`)
    return fromDoc(result)
  }

  async search(query: string): Promise<Intelligentia> {
    const pattern = new RegExp(query, 'i')
    const docs = await this.col.find({
      $or: [
        { nomen: { $regex: pattern } },
        { descriptio: { $regex: pattern } },
        { notae: { $elemMatch: { $regex: pattern } } },
      ],
    }).toArray()
    return docs.map(fromDoc)
  }
}
