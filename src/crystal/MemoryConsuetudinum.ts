import type { AuctorKey } from '../flow/types.js'
import type { Consuetudinum } from '../types/consuetudo.js'

/** Owner discriminant → stable key (mirrors MongoConsuetudinum's flatten). */
function ownerToken(owner: AuctorKey): string {
  return 'animaId' in owner ? `a:${owner.animaId}` : `h:${owner.commitment}`
}

/**
 * MemoryConsuetudinum — in-memory Consuetudinum for tests/hermetic contexts.
 * Keyed by `${ownerToken}\0${verb}` so distinct owners never collide.
 */
export class MemoryConsuetudinum implements Consuetudinum {
  private readonly store = new Map<string, string>()

  async resolve(owner: AuctorKey, verb: string): Promise<string | undefined> {
    return this.store.get(`${ownerToken(owner)}\0${verb}`)
  }

  async bind(owner: AuctorKey, verb: string, modusId: string): Promise<void> {
    this.store.set(`${ownerToken(owner)}\0${verb}`, modusId)
  }
}
