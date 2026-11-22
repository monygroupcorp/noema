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
    // bursaToken runs are not indexed (dispatchInceptio skips record() for them).
    if ('bursaToken' in key) return []
    const ids = 'animaId' in key
      ? this.byAnima.get(key.animaId)
      : this.byCommitment.get(key.commitment)
    if (!ids) return []
    const out: ActumIndex[] = []
    for (const id of ids) {
      const e = this.byActum.get(id)
      // IN-FLIGHT ONLY — mirror MongoActumIndex: never surface settled/released rows via
      // findFor (the /status + GDPR-export surface). Terminal history is listSettled/listReleased-only.
      if (e && !e.settledAt && !e.releasedAt) out.push(e)
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

  async findByActumId(actumId: string): Promise<ActumIndex | null> {
    return this.byActum.get(actumId) ?? null
  }

  async settle(actumId: string, patch: { settledAt: Date; impetus: string; modusLabel: string }): Promise<void> {
    const e = this.byActum.get(actumId)
    if (!e) return
    this.byActum.set(actumId, { ...e, ...patch })
  }

  async listSettled(key: AuctorKey, opts: { limit: number; cursor?: string }): Promise<{ entries: ActumIndex[]; nextCursor?: string }> {
    return this._listTerminal(key, 'settledAt', opts)
  }

  async sumSettledImpetus(key: AuctorKey): Promise<string> {
    return this._sumTerminal(key, 'settledAt')
  }

  async release(actumId: string, patch: { releasedAt: Date; modusLabel: string }): Promise<void> {
    const e = this.byActum.get(actumId)
    if (!e) return
    this.byActum.set(actumId, { ...e, ...patch })
  }

  async listReleased(key: AuctorKey, opts: { limit: number; cursor?: string }): Promise<{ entries: ActumIndex[]; nextCursor?: string }> {
    return this._listTerminal(key, 'releasedAt', opts)
  }

  /** Shared newest-first, cursor-paginated listing over whichever terminal stamp
   *  (`settledAt` or `releasedAt`) the caller asks for — same shape both callers need. */
  private _listTerminal(
    key: AuctorKey,
    stamp: 'settledAt' | 'releasedAt',
    opts: { limit: number; cursor?: string },
  ): { entries: ActumIndex[]; nextCursor?: string } {
    if ('bursaToken' in key) return { entries: [] }
    const ids = 'animaId' in key
      ? this.byAnima.get(key.animaId)
      : this.byCommitment.get(key.commitment)
    const limit = Math.min(Math.max(Math.trunc(opts.limit) || 0, 1), 100)
    const all = [...(ids ?? [])]
      .map(id => this.byActum.get(id))
      .filter((e): e is ActumIndex => !!e && !!e[stamp])
      .sort((a, b) => (b[stamp] as Date).getTime() - (a[stamp] as Date).getTime())
    const startIdx = opts.cursor ? all.findIndex(e => e.actumId === opts.cursor) + 1 : 0
    const page = all.slice(startIdx, startIdx + limit)
    const nextCursor = startIdx + limit < all.length ? page[page.length - 1]?.actumId : undefined
    return { entries: page, ...(nextCursor ? { nextCursor } : {}) }
  }

  private _sumTerminal(key: AuctorKey, stamp: 'settledAt' | 'releasedAt'): string {
    if ('bursaToken' in key) return '0'
    const ids = 'animaId' in key
      ? this.byAnima.get(key.animaId)
      : this.byCommitment.get(key.commitment)
    let total = 0n
    for (const id of ids ?? []) {
      const e = this.byActum.get(id)
      if (e?.[stamp] && e.impetus) total += BigInt(e.impetus)
    }
    return total.toString()
  }
}
