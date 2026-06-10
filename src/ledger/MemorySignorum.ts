import { randomUUID } from 'node:crypto'
import type { Signum, Signa, Signorum } from '../types/significandi.js'

export class MemorySignorum implements Signorum {
  private readonly store = new Map<string, Signum>()

  async issue(signum: Omit<Signum, 'id' | 'natum' | 'status'>): Promise<Signum> {
    if ((signum.forma === 'arcanum' || signum.forma === 'tessera') && signum.animaId !== undefined) {
      throw new Error(`Privacy partition violation: ${signum.forma} signum must not have animaId`)
    }
    if ((signum.forma === 'arcanum' || signum.forma === 'tessera') && signum.commitment !== undefined) {
      throw new Error(`One-way link violation: ${signum.forma} signum must not have commitment — it is the anonymous end, not the deposit end`)
    }
    const record: Signum = {
      ...signum,
      id: randomUUID(),
      natum: new Date(),
      status: 'valid',
    }
    this.store.set(record.id, record)
    return record
  }

  async balance(by: { animaId: string } | { commitment: string }): Promise<bigint> {
    return this.forIdentity(by)
      .filter(s => s.status === 'valid')
      .reduce((sum, s) => sum + s.valor, 0n)
  }

  async history(by: { animaId: string } | { commitment: string }): Promise<Signa> {
    return this.forIdentity(by)
  }

  async ownsAny(by: { animaId: string } | { commitment: string }, signumIds: string[]): Promise<boolean> {
    if (signumIds.length === 0) return false
    const ids = new Set(signumIds)
    return this.forIdentity(by).some(s => ids.has(s.id))
  }

  async lock(signaIds: string[], actumId: string): Promise<void> {
    // Validate all exist before mutating any (atomicity)
    for (const id of signaIds) {
      if (!this.store.has(id)) throw new Error(`Signum '${id}' not found`)
    }
    for (const id of signaIds) {
      const s = this.store.get(id)!
      this.store.set(id, { ...s, status: 'locked', actumId })
    }
  }

  async release(signaIds: string[]): Promise<void> {
    for (const id of signaIds) {
      const s = this.store.get(id)
      if (!s || s.status !== 'locked') continue  // no-op if spent or missing
      this.store.set(id, { ...s, status: 'valid', actumId: undefined })
    }
  }

  async createMany(signa: Array<Omit<Signum, 'id' | 'natum' | 'status'>>): Promise<Signum[]> {
    return Promise.all(signa.map(s => this.issue(s)))
  }

  async settle(signaIds: string[], actualImpetus: bigint, actumId: string): Promise<void> {
    const signa = signaIds.map(id => {
      const s = this.store.get(id)
      if (!s) throw new Error(`Signum '${id}' not found`)
      if (s.status === 'spent') throw new Error(`Signum '${id}' is already spent`)
      if (s.status !== 'locked') throw new Error(`Signum '${id}' must be locked before settle (status: ${s.status})`)
      return s
    })

    const totalLocked = signa.reduce((sum, s) => sum + s.valor, 0n)
    if (actualImpetus > totalLocked) {
      throw new Error(`Cursor overcharge: actual impetus ${actualImpetus} exceeds locked total ${totalLocked}`)
    }
    const delta = totalLocked - actualImpetus

    // Spend all locked signa
    const now = new Date()
    for (const s of signa) {
      this.store.set(s.id, { ...s, status: 'spent', actumId, expensum: now })
    }

    // Issue refund signum for the delta — preserves the original identity
    if (delta > 0n) {
      const first = signa[0]
      const refund: Omit<Signum, 'id' | 'natum' | 'status'> = first.forma === 'arcanum'
        ? { forma: 'arcanum', valor: delta, auctor: 'settle:delta', testis: first.testis }
        : { animaId: first.animaId, forma: first.forma, valor: delta, auctor: 'settle:delta' }
      await this.issue(refund)
    }
  }

  private forIdentity(by: { animaId: string } | { commitment: string }): Signa {
    const signa = Array.from(this.store.values())
    if ('animaId' in by) {
      return signa.filter(s => s.animaId === by.animaId)
    }
    // commitment: anonymous signa store their commitment in signum.testis
    return signa.filter(s => s.forma === 'arcanum' && s.testis === by.commitment)
  }
}
