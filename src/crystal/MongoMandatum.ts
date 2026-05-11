import { Collection } from 'mongodb'
import { v4 as uuidv4 } from 'uuid'
import type { Mandatum, Mandata, Mandatorum } from '../types/mandatum.js'

function fromDoc(doc: Record<string, unknown>): Mandatum {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { _id, _nextFire, ...rest } = doc as Record<string, unknown> & { _id: unknown; _nextFire: unknown }
  return rest as Mandatum
}

export class MongoMandatum implements Mandatorum {
  constructor(private col: Collection) {}

  async create(input: Omit<Mandatum, 'id' | 'natum' | 'mutatum' | 'acta' | 'ignitions'>): Promise<Mandatum> {
    const now = new Date()
    const m: Mandatum = { ...input, id: uuidv4(), acta: [], ignitions: 0, natum: now, mutatum: now }
    await this.col.insertOne({ ...m })
    return m
  }

  async find(id: string): Promise<Mandatum | null> {
    const doc = await this.col.findOne({ id })
    return doc ? fromDoc(doc as Record<string, unknown>) : null
  }

  async list(filter?: Partial<Pick<Mandatum, 'status' | 'triggerGenus'>>): Promise<Mandata> {
    const docs = await this.col.find(filter ?? {}).toArray()
    return docs.map(d => fromDoc(d as Record<string, unknown>))
  }

  async update(id: string, patch: Partial<Pick<Mandatum, 'status' | 'acta' | 'ignitions' | 'ignitum' | 'mutatum'>>): Promise<Mandatum> {
    const result = await this.col.findOneAndUpdate(
      { id },
      { $set: { ...patch, mutatum: new Date() } },
      { returnDocument: 'after' }
    )
    if (!result) throw new Error(`Mandatum not found: ${id}`)
    return fromDoc(result as Record<string, unknown>)
  }

  async due(at: Date): Promise<Mandata> {
    const docs = await this.col.find({ status: 'active', _nextFire: { $lte: at } }).toArray()
    return docs.map(d => fromDoc(d as Record<string, unknown>))
  }

  /** Internal helper: set the computed next-fire time for schedula mandata */
  async setNextFire(id: string, nextFire: Date): Promise<void> {
    await this.col.updateOne({ id }, { $set: { _nextFire: nextFire } })
  }
}
