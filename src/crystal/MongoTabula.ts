import type { Collection, Document } from 'mongodb'
import { v4 as uuidv4 } from 'uuid'
import type { AuctorKey, Tabula, Tabulae, Tabularum } from '../types/tabula.js'

// =============================================================================
// MongoTabula — the workspace store (no bigint fields → plain marshalling,
// mirrors MongoModorum/MongoProvinciarum conventions).
// =============================================================================

function toDoc(t: Tabula): Document {
  return { ...t }
}

function fromDoc(doc: Document): Tabula {
  const { _id, ...rest } = doc as Tabula & { _id: unknown }
  return rest as Tabula
}

export class MongoTabula implements Tabularum {
  constructor(private readonly col: Collection) {}

  async create(input: Omit<Tabula, 'id' | 'natum' | 'mutatum' | 'nodi' | 'vincula'>): Promise<Tabula> {
    const now = new Date()
    const t: Tabula = { ...input, id: uuidv4(), nodi: [], vincula: [], natum: now, mutatum: now }
    await this.col.insertOne(toDoc(t))
    return t
  }

  async find(id: string): Promise<Tabula | null> {
    const doc = await this.col.findOne({ id })
    return doc ? fromDoc(doc) : null
  }

  async list(filter?: Partial<Pick<Tabula, 'auctor' | 'status' | 'visibilitas'>>): Promise<Tabulae> {
    const query: Record<string, unknown> = {}
    if (filter?.status !== undefined) query.status = filter.status
    if (filter?.visibilitas !== undefined) query.visibilitas = filter.visibilitas
    // `auctor` is the `{ animaId } | { commitment } | { bursaToken }` owner union — stored as
    // a nested object. Query the discriminant field directly (same discipline as
    // MongoModorum.list) so `list({ auctor })` matches by owner regardless of which side of
    // the union is set.
    if (filter?.auctor !== undefined) {
      if ('animaId' in filter.auctor) query['auctor.animaId'] = filter.auctor.animaId
      else if ('commitment' in filter.auctor) query['auctor.commitment'] = filter.auctor.commitment
      else query['auctor.bursaToken'] = filter.auctor.bursaToken
    }
    const docs = await this.col.find(query).toArray()
    return docs.map(fromDoc)
  }

  async update(id: string, patch: Partial<Pick<Tabula, 'nomen' | 'descriptio' | 'nodi' | 'vincula' | 'status' | 'visibilitas' | 'modusId' | 'mutatum'>>): Promise<Tabula> {
    const result = await this.col.findOneAndUpdate(
      { id },
      { $set: { ...patch, mutatum: new Date() } },
      { returnDocument: 'after' },
    )
    if (!result) throw new Error(`Tabula not found: ${id}`)
    return fromDoc(result)
  }

  async remove(id: string): Promise<void> {
    await this.col.deleteOne({ id })
  }

  async fork(id: string, newAuctor: AuctorKey): Promise<Tabula> {
    const original = await this.find(id)
    if (!original) throw new Error(`Tabula not found: ${id}`)
    const now = new Date()
    const forked: Tabula = {
      ...original,
      id: uuidv4(),
      auctor: newAuctor,
      status: 'draft',
      fonteId: original.id,
      modusId: undefined,
      natum: now,
      mutatum: now,
    }
    await this.col.insertOne(toDoc(forked))
    return forked
  }

  async listDerived(templateId: string): Promise<Tabulae> {
    const docs = await this.col.find({ templateId }).toArray()
    return docs.map(fromDoc)
  }
}
