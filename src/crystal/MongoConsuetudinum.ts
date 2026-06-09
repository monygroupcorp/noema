import { Collection } from 'mongodb'
import type { AuctorKey } from '../flow/types.js'
import type { Consuetudinum } from '../types/consuetudo.js'

/** Flatten the AuctorKey discriminant for storage (mirrors MongoVestigiorum). */
function auctorKeyDoc(owner: AuctorKey): { animaId?: string; commitment?: string } {
  return 'animaId' in owner ? { animaId: owner.animaId } : { commitment: owner.commitment }
}

/** Query by the present discriminant only (mirrors MongoVestigiorum.auctorKeyQuery). */
function auctorKeyQuery(owner: AuctorKey): Record<string, unknown> {
  if ('animaId' in owner) return { 'auctorKey.animaId': owner.animaId }
  return { 'auctorKey.commitment': owner.commitment }
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
}
