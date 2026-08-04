import { Collection, type Document, type UpdateFilter } from 'mongodb'
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
   * GDPR erasure (noema-025) — sever THIS `animaId`'s login mapping without collaterally
   * orphaning a co-linked, un-erased anima. A single persona (one platform login) can link
   * MULTIPLE animae (the "create additional Anima and switch between them" feature; credit
   * lives per-anima). `DELETE /v1/me` erases only the caller's active animaId, so a blanket
   * `deleteMany({ animaIds })` would wipe the whole persona row — including its link to the
   * user's OTHER anima — and on next sign-in `resolveOrCreateAnima` would find no persona and
   * MINT A NEW soul, permanently orphaning the second profile's credit/content.
   *
   * Instead: `$pull` the erased animaId from every persona's `animaIds`; repoint any persona
   * whose `activeAnimaId` was the erased soul to a surviving anima; then delete only the
   * personas left with no animae at all (this login served the erased soul exclusively).
   * Idempotent — a re-run matches nothing, deletes nothing, returns 0. Returns the count of
   * persona login-mappings severed (pulled), the meaningful "how many masks unlinked".
   */
  async deleteByAnima(animaId: string): Promise<number> {
    const pulled = await this.col.updateMany(
      { animaIds: animaId },
      { $pull: { animaIds: animaId } } as unknown as UpdateFilter<Document>
    )
    // Repoint survivors whose active pointer was the (now-removed) erased anima to a
    // remaining anima so `activeAnimaId` never dangles at an erased soul.
    await this.col.updateMany(
      { activeAnimaId: animaId, animaIds: { $not: { $size: 0 } } },
      [{ $set: { activeAnimaId: { $arrayElemAt: ['$animaIds', 0] } } }]
    )
    // Delete only personas that served the erased soul exclusively (now empty).
    await this.col.deleteMany({ animaIds: { $size: 0 } })
    return pulled.modifiedCount ?? 0
  }
}
