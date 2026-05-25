import type { ActumIndex, ActumIndexStore } from '../types/actumIndex.js'

/**
 * In-memory ActumIndex. Keyed by actumId; secondary index on animaId. Tests
 * and dev-fake mode use this; production wires MongoActumIndex.
 */
export class MemoryActumIndex implements ActumIndexStore {
  private readonly byActum = new Map<string, ActumIndex>()
  private readonly byAnima = new Map<string, Set<string>>()  // animaId → Set<actumId>

  async record(entry: ActumIndex): Promise<void> {
    this.byActum.set(entry.actumId, entry)
    let bucket = this.byAnima.get(entry.animaId)
    if (!bucket) { bucket = new Set(); this.byAnima.set(entry.animaId, bucket) }
    bucket.add(entry.actumId)
  }

  async findFor(animaId: string): Promise<ActumIndex[]> {
    const ids = this.byAnima.get(animaId)
    if (!ids) return []
    const out: ActumIndex[] = []
    for (const id of ids) {
      const e = this.byActum.get(id)
      if (e) out.push(e)
    }
    return out
  }

  async remove(actumId: string): Promise<void> {
    const e = this.byActum.get(actumId)
    if (!e) return
    this.byActum.delete(actumId)
    this.byAnima.get(e.animaId)?.delete(actumId)
  }
}
