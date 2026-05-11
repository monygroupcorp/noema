import { Collection } from 'mongodb'
import { v4 as uuidv4 } from 'uuid'
import type { Tabula, Tabulae, Tabularum } from '../types/tabula.js'

function fromDoc(doc: Record<string, unknown>): Tabula {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { _id, ...rest } = doc as Record<string, unknown> & { _id: unknown }
  return rest as Tabula
}

export class MongoTabula implements Tabularum {
  constructor(private col: Collection) {}

  async create(input: Omit<Tabula, 'id' | 'natum' | 'mutatum' | 'nodi' | 'vincula'>): Promise<Tabula> {
    const now = new Date()
    const t: Tabula = { ...input, id: uuidv4(), nodi: [], vincula: [], natum: now, mutatum: now }
    await this.col.insertOne({ ...t })
    return t
  }

  async find(id: string): Promise<Tabula | null> {
    const doc = await this.col.findOne({ id })
    return doc ? fromDoc(doc as Record<string, unknown>) : null
  }

  async list(filter?: Partial<Pick<Tabula, 'auctor' | 'status' | 'visibilitas'>>): Promise<Tabulae> {
    const docs = await this.col.find(filter ?? {}).toArray()
    return docs.map(d => fromDoc(d as Record<string, unknown>))
  }

  async update(id: string, patch: Partial<Pick<Tabula, 'nomen' | 'descriptio' | 'nodi' | 'vincula' | 'status' | 'visibilitas' | 'modusId' | 'mutatum'>>): Promise<Tabula> {
    const result = await this.col.findOneAndUpdate(
      { id },
      { $set: { ...patch, mutatum: new Date() } },
      { returnDocument: 'after' }
    )
    if (!result) throw new Error(`Tabula not found: ${id}`)
    return fromDoc(result as Record<string, unknown>)
  }

  async fork(id: string, newAuctor: string): Promise<Tabula> {
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
    await this.col.insertOne({ ...forked })
    return forked
  }

  async listDerived(templateId: string): Promise<Tabulae> {
    const docs = await this.col.find({ templateId }).toArray()
    return docs.map(d => fromDoc(d as Record<string, unknown>))
  }
}
