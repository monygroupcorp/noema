import { randomUUID } from 'node:crypto'
import type { PartnerRequest, PartnerRequestStore } from '../types/partnerRequest.js'

/** In-memory partner-request registry — the hermetic mirror of `MongoPartnerRequest`. */
export class MemoryPartnerRequest implements PartnerRequestStore {
  private readonly store = new Map<string, PartnerRequest>()

  async create(
    input: Omit<PartnerRequest, 'id' | 'natum' | 'status' | 'decidedAt' | 'decidedBy'> & { status?: PartnerRequest['status'] },
  ): Promise<PartnerRequest> {
    const record: PartnerRequest = { ...input, id: randomUUID(), status: input.status ?? 'pending', natum: new Date() }
    this.store.set(record.id, record)
    return record
  }

  async find(id: string): Promise<PartnerRequest | null> {
    return this.store.get(id) ?? null
  }

  async list(filter?: { status?: PartnerRequest['status'] }): Promise<PartnerRequest[]> {
    const all = Array.from(this.store.values()).sort((a, b) => b.natum.getTime() - a.natum.getTime())
    return filter?.status === undefined ? all : all.filter(r => r.status === filter.status)
  }

  async update(
    id: string,
    patch: Partial<Pick<PartnerRequest, 'status' | 'decidedAt' | 'decidedBy'>>,
  ): Promise<PartnerRequest> {
    const existing = this.store.get(id)
    if (!existing) throw new Error(`PartnerRequest not found: ${id}`)
    const updated: PartnerRequest = { ...existing, ...patch }
    this.store.set(id, updated)
    return updated
  }

  async findByEmailKey(emailKey: string): Promise<PartnerRequest[]> {
    return Array.from(this.store.values()).filter(r => r.emailKey === emailKey)
  }
}
