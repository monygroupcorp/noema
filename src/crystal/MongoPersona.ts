import { Collection } from 'mongodb'
import { v4 as uuidv4 } from 'uuid'
import type { Persona, Personae, PersonaGenus, PersonaStore } from '../types/persona.js'

function fromDoc(doc: Record<string, unknown>): Persona {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { _id, ...rest } = doc as Record<string, unknown> & { _id: unknown }
  return rest as unknown as Persona
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
    const initialAnimaId = defaults?.animaId ?? ''
    const persona: Persona = {
      id: uuidv4(),
      activeAnimaId: initialAnimaId,
      animaIds: [initialAnimaId],
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
    const docs = await this.col.find({ animaIds: animaId }).toArray()
    return docs.map(d => fromDoc(d as Record<string, unknown>))
  }

  async findByExternus(genus: PersonaGenus, externusId: string): Promise<Persona | null> {
    const doc = await this.col.findOne({ genus, externusId })
    return doc ? fromDoc(doc as Record<string, unknown>) : null
  }

  async linkAnima(personaId: string, animaId: string): Promise<Persona> {
    const result = await this.col.findOneAndUpdate(
      { id: personaId },
      { $addToSet: { animaIds: animaId } },
      { returnDocument: 'after' }
    )
    if (!result) throw new Error(`Persona not found: ${personaId}`)
    return fromDoc(result as Record<string, unknown>)
  }

  async switchAnima(personaId: string, animaId: string): Promise<Persona> {
    const result = await this.col.findOneAndUpdate(
      { id: personaId, animaIds: animaId },
      { $set: { activeAnimaId: animaId } },
      { returnDocument: 'after' }
    )
    if (!result) throw new Error(`Persona not found or animaId not linked: ${personaId}`)
    return fromDoc(result as Record<string, unknown>)
  }

  /**
   * GDPR erasure (noema-025) — hard-delete every persona (platform mask) that maps to this
   * `animaId`. Severing the persona rows drops the login mapping so the erased soul can no
   * longer be re-resolved on a fresh sign-in. Idempotent — a re-run deletes nothing, returns 0.
   */
  async deleteByAnima(animaId: string): Promise<number> {
    const r = await this.col.deleteMany({ animaIds: animaId })
    return r.deletedCount ?? 0
  }
}
