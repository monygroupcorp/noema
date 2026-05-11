import { Collection } from 'mongodb'
import { v4 as uuidv4 } from 'uuid'
import type { Persona, Personae, PersonaGenus, PersonaStore } from '../types/persona.js'

function fromDoc(doc: Record<string, unknown>): Persona {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { _id, ...rest } = doc as Record<string, unknown> & { _id: unknown }
  return rest as Persona
}

export class MongoPersona implements PersonaStore {
  constructor(private col: Collection) {}

  async findOrCreate(
    genus: PersonaGenus,
    externusId: string,
    defaults?: { animaId: string; nomen?: string }
  ): Promise<Persona> {
    const visum = new Date()
    const existing = await this.col.findOneAndUpdate(
      { genus, externusId },
      { $set: { visum } },
      { returnDocument: 'after' }
    )
    if (existing) return fromDoc(existing as Record<string, unknown>)

    const now = new Date()
    const persona: Persona = {
      id: uuidv4(),
      animaId: defaults?.animaId ?? '',
      genus,
      externusId,
      nomen: defaults?.nomen,
      status: 'active',
      natum: now,
      visum: now,
    }
    await this.col.insertOne({ ...persona })
    return persona
  }

  async findByAnimaId(animaId: string): Promise<Personae> {
    const docs = await this.col.find({ animaId }).toArray()
    return docs.map(d => fromDoc(d as Record<string, unknown>))
  }

  async findByExternus(genus: PersonaGenus, externusId: string): Promise<Persona | null> {
    const doc = await this.col.findOne({ genus, externusId })
    return doc ? fromDoc(doc as Record<string, unknown>) : null
  }
}
