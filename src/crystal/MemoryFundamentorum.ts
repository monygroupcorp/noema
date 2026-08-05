import type { Fundamentum, Fundamenta, Fundamentorum } from '../types/fundamentum.js'

/**
 * MemoryFundamentorum — in-memory Fundamentorum for tests/hermetic contexts.
 * Keyed by `${id}\0${versio}`; `find` without a versio returns the latest by `natum`.
 */
export class MemoryFundamentorum implements Fundamentorum {
  private readonly store = new Map<string, Fundamentum>()

  constructor(seed: Fundamentum[] = []) {
    for (const f of seed) void this.register(f)
  }

  async register(fundamentum: Fundamentum): Promise<void> {
    this.store.set(`${fundamentum.id}\0${fundamentum.versio}`, fundamentum)
  }

  async find(id: string, versio?: string): Promise<Fundamentum | null> {
    if (versio) return this.store.get(`${id}\0${versio}`) ?? null
    const matches = [...this.store.values()].filter(f => f.id === id)
    if (!matches.length) return null
    return matches.sort((a, b) => b.natum.getTime() - a.natum.getTime())[0]
  }

  async list(filter?: Partial<Pick<Fundamentum, 'canonica' | 'auctor'>>): Promise<Fundamenta> {
    let out = [...this.store.values()]
    if (filter?.canonica !== undefined) out = out.filter(f => f.canonica === filter.canonica)
    if (filter?.auctor !== undefined) {
      const a = filter.auctor
      out = out.filter(f => f.auctor && (
        'animaId' in a    ? (f.auctor as { animaId?: string }).animaId === a.animaId
        : 'commitment' in a ? (f.auctor as { commitment?: string }).commitment === a.commitment
                            : (f.auctor as { bursaToken?: string }).bursaToken === a.bursaToken
      ))
    }
    return out
  }
}
