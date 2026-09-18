import { randomUUID } from 'node:crypto'
import type { PartnerInvoice, PartnerInvoiceStatus, PartnerInvoiceStore } from '../types/partnerInvoice.js'

/** In-memory invoice book — the hermetic mirror of `MongoPartnerInvoice`. */
export class MemoryPartnerInvoice implements PartnerInvoiceStore {
  private readonly store = new Map<string, PartnerInvoice>()

  async issue(input: Omit<PartnerInvoice, 'id' | 'status' | 'issuedAt'> & { issuedAt?: Date }): Promise<PartnerInvoice> {
    const clash = [...this.store.values()].find(
      i =>
        i.animaId === input.animaId &&
        i.periodStart.getTime() === input.periodStart.getTime() &&
        i.periodEnd.getTime() === input.periodEnd.getTime() &&
        i.status !== 'void',
    )
    if (clash) {
      throw new Error(`PartnerInvoice: ${input.animaId} is already billed for this period (invoice ${clash.id}, ${clash.status})`)
    }
    const record: PartnerInvoice = { ...input, id: randomUUID(), status: 'open', issuedAt: input.issuedAt ?? new Date() }
    this.store.set(record.id, record)
    return record
  }

  async find(id: string): Promise<PartnerInvoice | null> {
    return this.store.get(id) ?? null
  }

  async list(animaId: string, filter?: { status?: PartnerInvoiceStatus }): Promise<PartnerInvoice[]> {
    return [...this.store.values()]
      .filter(i => i.animaId === animaId && (filter?.status === undefined || i.status === filter.status))
      .sort((a, b) => b.issuedAt.getTime() - a.issuedAt.getTime())
  }

  async markPaid(id: string, paidAt: Date, chargeRef: string): Promise<PartnerInvoice> {
    const existing = this.store.get(id)
    if (!existing) throw new Error(`PartnerInvoice not found: ${id}`)
    if (existing.status === 'void') throw new Error(`PartnerInvoice ${id} was voided and cannot be paid`)
    if (existing.status === 'paid') {
      // Same charge → the redelivery this idempotency exists for. Different charge → two
      // payments against one invoice, which nobody should absorb silently.
      if (existing.chargeRef === chargeRef) return existing
      throw new Error(`PartnerInvoice ${id} is already paid by charge ${existing.chargeRef} — refusing charge ${chargeRef}`)
    }
    const paid: PartnerInvoice = { ...existing, status: 'paid', paidAt, chargeRef }
    this.store.set(id, paid)
    return paid
  }

  async setStatus(id: string, status: Extract<PartnerInvoiceStatus, 'void'>): Promise<PartnerInvoice> {
    const existing = this.store.get(id)
    if (!existing) throw new Error(`PartnerInvoice not found: ${id}`)
    if (existing.status === 'paid') throw new Error(`PartnerInvoice ${id} is paid and cannot be voided`)
    const updated: PartnerInvoice = { ...existing, status }
    this.store.set(id, updated)
    return updated
  }
}
