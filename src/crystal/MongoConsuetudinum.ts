import { Collection } from 'mongodb'
import type { AuctorKey } from '../flow/types.js'
import type { Consuetudinum, Appearance, Generatio, Binding } from '../types/consuetudo.js'

/** Flatten the AuctorKey discriminant for storage (mirrors MongoVestigiorum). */
function auctorKeyDoc(owner: AuctorKey): { animaId?: string; commitment?: string; bursaToken?: string } {
  if ('animaId' in owner)    return { animaId: owner.animaId }
  if ('commitment' in owner) return { commitment: owner.commitment }
  return { bursaToken: owner.bursaToken }
}

/** Query by the present discriminant only (mirrors MongoVestigiorum.auctorKeyQuery). */
function auctorKeyQuery(owner: AuctorKey): Record<string, unknown> {
  if ('animaId' in owner)    return { 'auctorKey.animaId': owner.animaId }
  if ('commitment' in owner) return { 'auctorKey.commitment': owner.commitment }
  return { 'auctorKey.bursaToken': owner.bursaToken }
}

/**
 * MongoConsuetudinum — owner-keyed established defaults, keyed by AuctorKey.
 *
 * Two doc kinds share the collection, disambiguated by `verb`:
 *   - verb→flow rebind: `{ auctorKey, verb: <string>, modusId }` — one per (owner, verb).
 *   - per-modus affines: `{ auctorKey, verb: null, modusId, affines }` — one per (owner, modus).
 * `verb: null` matches both null and missing in Mongo, so the affines query never
 * collides with a verb-rebind doc (which carries a string `verb`), and vice-versa.
 */
export class MongoConsuetudinum implements Consuetudinum {
  constructor(private col: Collection) {}

  async resolve(owner: AuctorKey, verb: string): Promise<string | undefined> {
    const doc = await this.col.findOne({ ...auctorKeyQuery(owner), verb })
    return doc ? (doc.modusId as string) : undefined
  }

  async bind(owner: AuctorKey, verb: string, modusId: string): Promise<void> {
    await this.col.updateOne(
      { ...auctorKeyQuery(owner), verb },
      { $set: { auctorKey: auctorKeyDoc(owner), verb, modusId, mutatum: new Date() } },
      { upsert: true },
    )
  }

  async resolveAffines(owner: AuctorKey, modusId: string): Promise<Record<string, unknown> | undefined> {
    const doc = await this.col.findOne({ ...auctorKeyQuery(owner), modusId, verb: null })
    return doc ? (doc.affines as Record<string, unknown>) : undefined
  }

  async setAffines(owner: AuctorKey, modusId: string, affines: Record<string, unknown>): Promise<void> {
    await this.col.updateOne(
      { ...auctorKeyQuery(owner), modusId, verb: null },
      { $set: { auctorKey: auctorKeyDoc(owner), verb: null, modusId, affines, mutatum: new Date() } },
      { upsert: true },
    )
  }

  // Verb-rebind docs carry a string `verb`; the affines/appearance/generatio docs do not.
  async listBindings(owner: AuctorKey): Promise<Binding[]> {
    const docs = await this.col.find({ ...auctorKeyQuery(owner), verb: { $type: 'string' } }).toArray()
    return docs.map((d) => ({ verb: d.verb as string, modusId: d.modusId as string }))
  }

  // Appearance + generatio are singleton docs per owner, discriminated by `kind`
  // (affines docs have no `kind`, so the queries never collide).
  async resolveAppearance(owner: AuctorKey): Promise<Appearance | undefined> {
    const doc = await this.col.findOne({ ...auctorKeyQuery(owner), kind: 'appearance' })
    return doc ? (doc.appearance as Appearance) : undefined
  }

  async setAppearance(owner: AuctorKey, appearance: Appearance): Promise<void> {
    await this.col.updateOne(
      { ...auctorKeyQuery(owner), kind: 'appearance' },
      { $set: { auctorKey: auctorKeyDoc(owner), kind: 'appearance', appearance, mutatum: new Date() } },
      { upsert: true },
    )
  }

  async resolveGeneratio(owner: AuctorKey): Promise<Generatio | undefined> {
    const doc = await this.col.findOne({ ...auctorKeyQuery(owner), kind: 'generatio' })
    return doc ? (doc.generatio as Generatio) : undefined
  }

  async setGeneratio(owner: AuctorKey, generatio: Generatio): Promise<void> {
    await this.col.updateOne(
      { ...auctorKeyQuery(owner), kind: 'generatio' },
      { $set: { auctorKey: auctorKeyDoc(owner), kind: 'generatio', generatio, mutatum: new Date() } },
      { upsert: true },
    )
  }

  /**
   * GDPR erasure (noema-025) — hard-delete ALL of this soul's established defaults (verb rebinds,
   * per-modus affines, appearance, generatio) in one sweep. Every doc kind carries the flattened
   * `auctorKey.animaId`, so a single filter clears them. Idempotent — a re-run returns 0.
   */
  async deleteByAnima(animaId: string): Promise<number> {
    const r = await this.col.deleteMany({ 'auctorKey.animaId': animaId })
    return r.deletedCount ?? 0
  }
}
