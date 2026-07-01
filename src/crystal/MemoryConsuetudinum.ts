import type { AuctorKey } from '../flow/types.js'
import type { Consuetudinum, Appearance, Generatio, Binding } from '../types/consuetudo.js'

/** Owner discriminant → stable key (mirrors MongoConsuetudinum's flatten). */
function ownerToken(owner: AuctorKey): string {
  return 'animaId' in owner ? `a:${owner.animaId}` : 'commitment' in owner ? `h:${owner.commitment}` : `b:${owner.bursaToken}`
}

/**
 * MemoryConsuetudinum — in-memory Consuetudinum for tests/hermetic contexts.
 * Verb rebinds key on `${ownerToken}\0${verb}`; per-modus affines key on a disjoint
 * `${ownerToken}\0affines\0${modusId}` namespace so the two never collide.
 */
export class MemoryConsuetudinum implements Consuetudinum {
  private readonly store = new Map<string, string>()
  private readonly affinesStore = new Map<string, Record<string, unknown>>()
  private readonly appearanceStore = new Map<string, Appearance>()
  private readonly generatioStore = new Map<string, Generatio>()

  async resolve(owner: AuctorKey, verb: string): Promise<string | undefined> {
    return this.store.get(`${ownerToken(owner)}\0${verb}`)
  }

  async bind(owner: AuctorKey, verb: string, modusId: string): Promise<void> {
    this.store.set(`${ownerToken(owner)}\0${verb}`, modusId)
  }

  async listBindings(owner: AuctorKey): Promise<Binding[]> {
    const prefix = `${ownerToken(owner)}\0`
    const out: Binding[] = []
    for (const [k, modusId] of this.store) {
      if (k.startsWith(prefix)) out.push({ verb: k.slice(prefix.length), modusId })
    }
    return out
  }

  async resolveAffines(owner: AuctorKey, modusId: string): Promise<Record<string, unknown> | undefined> {
    return this.affinesStore.get(`${ownerToken(owner)}\0affines\0${modusId}`)
  }

  async setAffines(owner: AuctorKey, modusId: string, affines: Record<string, unknown>): Promise<void> {
    this.affinesStore.set(`${ownerToken(owner)}\0affines\0${modusId}`, affines)
  }

  async resolveAppearance(owner: AuctorKey): Promise<Appearance | undefined> {
    return this.appearanceStore.get(ownerToken(owner))
  }

  async setAppearance(owner: AuctorKey, appearance: Appearance): Promise<void> {
    this.appearanceStore.set(ownerToken(owner), appearance)
  }

  async resolveGeneratio(owner: AuctorKey): Promise<Generatio | undefined> {
    return this.generatioStore.get(ownerToken(owner))
  }

  async setGeneratio(owner: AuctorKey, generatio: Generatio): Promise<void> {
    this.generatioStore.set(ownerToken(owner), generatio)
  }
}
