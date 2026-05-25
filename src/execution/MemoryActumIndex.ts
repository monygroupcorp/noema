import type { ActumIndex, ActumIndexStore } from '../types/actumIndex.js'
import type { AuctorKey } from '../flow/types.js'

/**
 * In-memory ActumIndex with dual secondary indexes: one keyed by animaId,
 * one keyed by commitment. Each entry sits in exactly one secondary index
 * (the AuctorKey union enforces that). Tests + dev-fake mode use this;
 * production wires MongoActumIndex.
 */
export class MemoryActumIndex implements ActumIndexStore {
  private readonly byActum      = new Map<string, ActumIndex>()
  private readonly byAnima      = new Map<string, Set<string>>()  // animaId    → Set<actumId>
  private readonly byCommitment = new Map<string, Set<string>>()  // commitment → Set<actumId>

  async record(entry: ActumIndex): Promise<void> {
    // If we're overwriting an existing entry, evict its old secondary slot
    // first — keeps the indexes consistent even if the entry's key changes
    // across a re-record (defensive; shouldn't happen in normal flow).
    const prev = this.byActum.get(entry.actumId)
    if (prev) {
      if (prev.animaId)    this.byAnima.get(prev.animaId)?.delete(entry.actumId)
      if (prev.commitment) this.byCommitment.get(prev.commitment)?.delete(entry.actumId)
    }

    this.byActum.set(entry.actumId, entry)

    if (entry.animaId) {
      let b = this.byAnima.get(entry.animaId)
      if (!b) { b = new Set(); this.byAnima.set(entry.animaId, b) }
      b.add(entry.actumId)
    }
    if (entry.commitment) {
      let b = this.byCommitment.get(entry.commitment)
      if (!b) { b = new Set(); this.byCommitment.set(entry.commitment, b) }
      b.add(entry.actumId)
    }
  }

  async findFor(key: AuctorKey): Promise<ActumIndex[]> {
    const ids = 'animaId' in key
      ? this.byAnima.get(key.animaId)
      : this.byCommitment.get(key.commitment)
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
    if (e.animaId)    this.byAnima.get(e.animaId)?.delete(actumId)
    if (e.commitment) this.byCommitment.get(e.commitment)?.delete(actumId)
  }
}
