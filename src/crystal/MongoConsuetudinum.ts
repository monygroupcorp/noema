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
 * MongoConsuetudinum — owner-keyed verb→flow bindings, keyed by AuctorKey.
 *
 * One document per (owner, verb). `bind` upserts; `resolve` reads. The shape
 * leaves room to later re-home `Anima.affines` onto the same owner-keyed bag
 * (future — not built now).
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
}
