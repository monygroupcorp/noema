import type { Collection, Document } from 'mongodb'
import type { Fundamentum, Fundamenta, Fundamentorum } from '../types/fundamentum.js'

function fromDoc(doc: Document): Fundamentum {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { _id, ...rest } = doc as Document & { _id: unknown }
  return rest as unknown as Fundamentum
}

/**
 * MongoFundamentorum — the compute-substrate registry, keyed by (id, versio).
 * Mirrors MongoModorum: `register` upserts a versioned doc; `find` resolves a pinned
 * version or the latest; `list` filters by canonical/owner.
 */
export class MongoFundamentorum implements Fundamentorum {
  constructor(private readonly col: Collection) {}

  async register(fundamentum: Fundamentum): Promise<void> {
    await this.col.updateOne(
      { id: fundamentum.id, versio: fundamentum.versio },
      { $set: { ...fundamentum } },
      { upsert: true },
    )
  }

  async find(id: string, versio?: string): Promise<Fundamentum | null> {
    const query: Record<string, unknown> = { id }
    if (versio) query.versio = versio
    const doc = versio
      ? await this.col.findOne(query)
      : await this.col.findOne(query, { sort: { natum: -1 } })
    return doc ? fromDoc(doc) : null
  }

  async list(filter?: Partial<Pick<Fundamentum, 'canonica' | 'auctor'>>): Promise<Fundamenta> {
    const query: Record<string, unknown> = {}
    if (filter?.canonica !== undefined) query.canonica = filter.canonica
    if (filter?.auctor !== undefined) {
      if ('animaId' in filter.auctor) query['auctor.animaId'] = filter.auctor.animaId
      else query['auctor.commitment'] = filter.auctor.commitment
    }
    const docs = await this.col.find(query).toArray()
    return docs.map(fromDoc)
  }
}
