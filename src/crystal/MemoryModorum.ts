import type { Modus, Modi, Modorum } from '../types/modus.js'

/** Phase 1 stub — replaced by MongoModorum in Phase 2. */
export class MemoryModorum implements Modorum {
  private readonly store = new Map<string, Modus>()

  async find(id: string, versio?: string): Promise<Modus | null> {
    const key = versio ? `${id}@${versio}` : id
    return this.store.get(key) ?? this.store.get(id) ?? null
  }

  async register(modus: Modus): Promise<void> {
    this.store.set(modus.id, modus)
    this.store.set(`${modus.id}@${modus.versio}`, modus)
  }

  async update(id: string, patch: Partial<Pick<Modus, 'computeStrategy' | 'gpuClass' | 'podPolicy'>>): Promise<Modus> {
    const modus = this.store.get(id)
    if (!modus) throw new Error(`Modus '${id}' not found`)
    const updated = { ...modus, ...patch }
    this.store.set(id, updated)
    this.store.set(`${id}@${updated.versio}`, updated)
    return updated
  }

  async list(filter?: Partial<Pick<Modus, 'genus' | 'canonica' | 'auctor'>>): Promise<Modi> {
    const all = [...new Set(this.store.values())]
    if (!filter) return all
    return all.filter(m =>
      (filter.genus === undefined || m.genus === filter.genus) &&
      (filter.canonica === undefined || m.canonica === filter.canonica) &&
      (filter.auctor === undefined || m.auctor === filter.auctor)
    )
  }
}
