import { Collection } from 'mongodb'
import { v4 as uuidv4 } from 'uuid'
import type { Memoria, MemoriaStore } from '../types/anima.js'

function fromDoc(doc: Record<string, unknown>): Memoria {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { _id, ...rest } = doc as Record<string, unknown> & { _id: unknown }
  return rest as unknown as Memoria
}

export class MongoMemoria implements MemoriaStore {
  constructor(private col: Collection) {}

  async upsert(input: Omit<Memoria, 'id' | 'natum' | 'mutatum'>): Promise<Memoria> {
    const now = new Date()
    const result = await this.col.findOneAndUpdate(
      { animaId: input.animaId },
      {
        $set: {
          summarium: input.summarium,
          affines: input.affines,
          praeferentia: input.praeferentia,
          mutatum: now,
        },
        $setOnInsert: {
          id: uuidv4(),
          animaId: input.animaId,
          natum: now,
        },
      },
      { upsert: true, returnDocument: 'after' }
    )
    if (!result) throw new Error(`Memoria upsert failed for animaId: ${input.animaId}`)
    return fromDoc(result as Record<string, unknown>)
  }

  async findByAnima(animaId: string): Promise<Memoria | null> {
    const doc = await this.col.findOne({ animaId })
    return doc ? fromDoc(doc as Record<string, unknown>) : null
  }
}
