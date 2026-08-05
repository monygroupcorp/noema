import { randomUUID } from 'node:crypto'
import type { Sponsio, Sponsiones, SponsioStore } from '../types/sponsio.js'

/** In-memory sponsorship registry — the hermetic mirror of `MongoSponsio`, including
 *  the atomic `claimCycle` CAS (single-threaded, so trivially atomic). */
export class MemorySponsio implements SponsioStore {
  private readonly store = new Map<string, Sponsio>()

  async create(
    input: Omit<Sponsio, 'id' | 'natum' | 'status' | 'drippedTotal'> & { status?: Sponsio['status'] },
  ): Promise<Sponsio> {
    const record: Sponsio = {
      ...input,
      id: randomUUID(),
      drippedTotal: 0n,
      status: input.status ?? 'active',
      natum: new Date(),
    }
    this.store.set(record.id, record)
    return record
  }

  async find(id: string): Promise<Sponsio | null> {
    return this.store.get(id) ?? null
  }

  async listBySponsor(animaId: string): Promise<Sponsiones> {
    return Array.from(this.store.values()).filter(s => s.sponsor.animaId === animaId)
  }

  async listActive(): Promise<Sponsiones> {
    return Array.from(this.store.values()).filter(s => s.status === 'active')
  }

  async claimCycle(id: string, cycle: string): Promise<boolean> {
    const s = this.store.get(id)
    if (!s || s.lastDripCycle === cycle) return false
    this.store.set(id, { ...s, lastDripCycle: cycle })
    return true
  }

  async releaseCycle(id: string, cycle: string): Promise<void> {
    const s = this.store.get(id)
    if (s && s.lastDripCycle === cycle) this.store.set(id, { ...s, lastDripCycle: undefined })
  }

  async recordDrip(id: string, amount: bigint): Promise<void> {
    const s = this.store.get(id)
    if (!s) return
    const drippedTotal = s.drippedTotal + amount
    const exhausted = s.capTotal !== undefined && drippedTotal >= s.capTotal
    this.store.set(id, { ...s, drippedTotal, ...(exhausted ? { status: 'exhausted' as const } : {}) })
  }

  async setStatus(id: string, status: Sponsio['status']): Promise<void> {
    const s = this.store.get(id)
    if (s) this.store.set(id, { ...s, status })
  }
}
