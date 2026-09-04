import type { Partner, PartnerStore } from '../types/partner.js'

/** In-memory partner registry — the hermetic mirror of `MongoPartner`. Keyed by animaId. */
export class MemoryPartner implements PartnerStore {
  private readonly store = new Map<string, Partner>()

  async create(input: Omit<Partner, 'natum' | 'status'> & { status?: Partner['status'] }): Promise<Partner> {
    const record: Partner = { ...input, status: input.status ?? 'active', natum: new Date() }
    this.store.set(record.animaId, record)
    return record
  }

  async find(animaId: string): Promise<Partner | null> {
    return this.store.get(animaId) ?? null
  }

  async list(filter?: { status?: Partner['status'] }): Promise<Partner[]> {
    const all = Array.from(this.store.values()).sort((a, b) => b.natum.getTime() - a.natum.getTime())
    return filter?.status === undefined ? all : all.filter(p => p.status === filter.status)
  }

  async setStatus(animaId: string, status: Partner['status']): Promise<void> {
    const p = this.store.get(animaId)
    if (p) this.store.set(animaId, { ...p, status })
  }
}
