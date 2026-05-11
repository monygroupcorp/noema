import { randomUUID } from 'crypto'
import type { Signum, Signa, Signorum } from '../types/significandi.js'

/** Phase 1 stub — replaced by MongoSignorum in Phase 3. */
export class MemorySignorum implements Signorum {
  private readonly store = new Map<string, Signum>()

  async balance(by: { animaId: string } | { arcanumHash: string }): Promise<bigint> {
    return [...this.store.values()]
      .filter(s => s.status === 'valid' && this._matches(s, by))
      .reduce((sum, s) => sum + s.valor, 0n)
  }

  async issue(signum: Omit<Signum, 'id' | 'natum' | 'status'>): Promise<Signum> {
    const s: Signum = { ...signum, id: randomUUID(), natum: new Date(), status: 'valid' }
    this.store.set(s.id, s)
    return s
  }

  async lock(signaIds: string[], actumId: string): Promise<void> {
    for (const id of signaIds) {
      const s = this.store.get(id)
      if (s) this.store.set(id, { ...s, status: 'locked', actumId })
    }
  }

  async release(signaIds: string[]): Promise<void> {
    for (const id of signaIds) {
      const s = this.store.get(id)
      if (s && s.status === 'locked') this.store.set(id, { ...s, status: 'valid', actumId: undefined })
    }
  }

  async history(by: { animaId: string } | { arcanumHash: string }): Promise<Signa> {
    return [...this.store.values()].filter(s => this._matches(s, by))
  }

  async settle(signaIds: string[], actualImpetus: bigint, actumId: string): Promise<void> {
    const now = new Date()
    let totalLocked = 0n
    for (const id of signaIds) {
      const s = this.store.get(id)
      if (!s) continue
      totalLocked += s.valor
      this.store.set(id, { ...s, status: 'spent', expensum: now, actumId })
    }
    const delta = totalLocked - actualImpetus
    if (delta > 0n) {
      const first = signaIds.map(id => this.store.get(id)).find(Boolean)
      if (first) {
        const by = first.animaId ? { animaId: first.animaId } : undefined
        await this.issue({
          forma: 'minted',
          valor: delta,
          auctor: 'system:refund',
          ...(by ?? {}),
          status: 'valid' as const,
        } as Omit<Signum, 'id' | 'natum' | 'status'>)
      }
    }
  }

  private _matches(s: Signum, by: { animaId: string } | { arcanumHash: string }): boolean {
    if ('animaId' in by) return s.animaId === by.animaId
    return s.testis === by.arcanumHash
  }
}
