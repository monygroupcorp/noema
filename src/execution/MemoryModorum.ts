import type { Modus, Modi, Modorum } from '../types/modus.js'

export class MemoryModorum implements Modorum {
  // id → versio → Modus
  private readonly store = new Map<string, Map<string, Modus>>()

  async register(modus: Modus): Promise<void> {
    if (!this.store.has(modus.id)) this.store.set(modus.id, new Map())
    this.store.get(modus.id)!.set(modus.versio, modus)
  }

  async find(id: string, versio?: string): Promise<Modus | null> {
    const versions = this.store.get(id)
    if (!versions || versions.size === 0) return null
    if (versio) return versions.get(versio) ?? null
    // Latest = highest semver — sort lexicographically (works for semver with same structure)
    const sorted = Array.from(versions.keys()).sort((a, b) => b.localeCompare(a, undefined, { numeric: true }))
    return versions.get(sorted[0]) ?? null
  }

  async list(filter?: Partial<Pick<Modus, 'genus' | 'canonica' | 'auctor'>>): Promise<Modi> {
    const all: Modus[] = []
    for (const versions of this.store.values()) {
      for (const modus of versions.values()) {
        all.push(modus)
      }
    }
    if (!filter) return all
    return all.filter(m =>
      (filter.genus === undefined || m.genus === filter.genus) &&
      (filter.canonica === undefined || m.canonica === filter.canonica) &&
      (filter.auctor === undefined || m.auctor === filter.auctor)
    )
  }
}
