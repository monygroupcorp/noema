import { Collection } from 'mongodb'
import { v4 as uuidv4 } from 'uuid'
import type { Scholium, Scholiorum, ScholiumTargetType } from '../types/scholium.js'

function fromDoc(doc: Record<string, unknown>): Scholium {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { _id, ...rest } = doc as Record<string, unknown> & { _id: unknown }
  return rest as unknown as Scholium
}

export class MongoScholium implements Scholiorum {
  constructor(private col: Collection) {}

  async create(input: Omit<Scholium, 'id' | 'natum'>): Promise<Scholium> {
    const s: Scholium = { ...input, id: uuidv4(), natum: new Date() }
    await this.col.insertOne({ ...s })
    return s
  }

  async find(id: string): Promise<Scholium | null> {
    const doc = await this.col.findOne({ id })
    return doc ? fromDoc(doc as Record<string, unknown>) : null
  }

  async listByTarget(targetType: ScholiumTargetType, targetId: string): Promise<Scholium[]> {
    const docs = await this.col.find({ targetType, targetId }).toArray()
    return docs.map(d => fromDoc(d as Record<string, unknown>))
  }

  async listUnresolvedBugs(targetType: ScholiumTargetType, targetId: string): Promise<Scholium[]> {
    const docs = await this.col.find({
      targetType,
      targetId,
      tag: 'bug',
      $or: [{ resoluta: { $exists: false } }, { resoluta: null }],
    }).toArray()
    return docs.map(d => fromDoc(d as Record<string, unknown>))
  }

  async resolve(id: string, at: Date): Promise<Scholium> {
    const result = await this.col.findOneAndUpdate(
      { id },
      { $set: { resoluta: at } },
      { returnDocument: 'after' }
    )
    if (!result) throw new Error(`Scholium not found: ${id}`)
    return fromDoc(result as Record<string, unknown>)
  }
}
