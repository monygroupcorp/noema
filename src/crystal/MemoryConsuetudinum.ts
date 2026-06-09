import type { AuctorKey } from '../flow/types.js'
import type { Consuetudinum } from '../types/consuetudo.js'

/** Owner discriminant → stable key (mirrors MongoConsuetudinum's flatten). */
function ownerToken(owner: AuctorKey): string {
  return 'animaId' in owner ? `a:${owner.animaId}` : `h:${owner.commitment}`
}

/**
 * MemoryConsuetudinum — in-memory Consuetudinum for tests/hermetic contexts.
 * Verb rebinds key on `${ownerToken}\0${verb}`; per-modus affines key on a disjoint
 * `${ownerToken}\0affines\0${modusId}` namespace so the two never collide.
 */
export class MemoryConsuetudinum implements Consuetudinum {
  private readonly store = new Map<string, string>()
  private readonly affinesStore = new Map<string, Record<string, unknown>>()

  async resolve(owner: AuctorKey, verb: string): Promise<string | undefined> {
    return this.store.get(`${ownerToken(owner)}\0${verb}`)
  }

  async bind(owner: AuctorKey, verb: string, modusId: string): Promise<void> {
    this.store.set(`${ownerToken(owner)}\0${verb}`, modusId)
  }

  async resolveAffines(owner: AuctorKey, modusId: string): Promise<Record<string, unknown> | undefined> {
    return this.affinesStore.get(`${ownerToken(owner)}\0affines\0${modusId}`)
  }

  async setAffines(owner: AuctorKey, modusId: string, affines: Record<string, unknown>): Promise<void> {
    this.affinesStore.set(`${ownerToken(owner)}\0affines\0${modusId}`, affines)
  }
}
