import { randomUUID } from 'node:crypto'
import { Collection } from 'mongodb'
import type { PartnerInvoice, PartnerInvoiceStatus, PartnerInvoiceStore } from '../types/partnerInvoice.js'

function fromDoc(doc: Record<string, unknown>): PartnerInvoice {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { _id, ...rest } = doc as Record<string, unknown> & { _id: unknown }
  return rest as unknown as PartnerInvoice
}

/** The invoice book. A period is billed once: the not-void (animaId, periodStart, periodEnd)
 *  read below is the same check `MemoryPartnerInvoice` makes, and the deployment carries a
 *  unique partial index behind it (see `docs/ops/`-level index setup alongside the other
 *  unique partial indexes this codebase relies on for money idempotency). */
export class MongoPartnerInvoice implements PartnerInvoiceStore {
  constructor(private col: Collection) {}

  async issue(input: Omit<PartnerInvoice, 'id' | 'status' | 'issuedAt'> & { issuedAt?: Date }): Promise<PartnerInvoice> {
    const clash = await this.col.findOne({
      animaId: input.animaId,
      periodStart: input.periodStart,
      periodEnd: input.periodEnd,
      status: { $ne: 'void' },
    })
    if (clash) {
      const row = fromDoc(clash as Record<string, unknown>)
      throw new Error(`PartnerInvoice: ${input.animaId} is already billed for this period (invoice ${row.id}, ${row.status})`)
    }
    const record: PartnerInvoice = { ...input, id: randomUUID(), status: 'open', issuedAt: input.issuedAt ?? new Date() }
    await this.col.insertOne({ ...record })
    return record
  }

  async find(id: string): Promise<PartnerInvoice | null> {
    const doc = await this.col.findOne({ id })
    return doc ? fromDoc(doc as Record<string, unknown>) : null
  }

  async list(animaId: string, filter?: { status?: PartnerInvoiceStatus }): Promise<PartnerInvoice[]> {
    const f: Record<string, unknown> = { animaId }
    if (filter?.status !== undefined) f.status = filter.status
    const docs = await this.col.find(f).sort({ issuedAt: -1 }).toArray()
    return docs.map(d => fromDoc(d as Record<string, unknown>))
  }

  async markPaid(id: string, paidAt: Date, chargeRef: string): Promise<PartnerInvoice> {
    // Conditional update on `status: 'open'` — two webhook deliveries racing here means exactly
    // one matches and the other falls through to the already-paid read below.
    const res = await this.col.findOneAndUpdate(
      { id, status: 'open' },
      { $set: { status: 'paid', paidAt, chargeRef } },
      { returnDocument: 'after' },
    )
    if (res) return fromDoc(res as unknown as Record<string, unknown>)

    const existing = await this.find(id)
    if (!existing) throw new Error(`PartnerInvoice not found: ${id}`)
    if (existing.status === 'void') throw new Error(`PartnerInvoice ${id} was voided and cannot be paid`)
    if (existing.chargeRef === chargeRef) return existing
    throw new Error(`PartnerInvoice ${id} is already paid by charge ${existing.chargeRef} — refusing charge ${chargeRef}`)
  }

  async setStatus(id: string, status: Extract<PartnerInvoiceStatus, 'void'>): Promise<PartnerInvoice> {
    const res = await this.col.findOneAndUpdate(
      { id, status: { $ne: 'paid' } },
      { $set: { status } },
      { returnDocument: 'after' },
    )
    if (res) return fromDoc(res as unknown as Record<string, unknown>)
    const existing = await this.find(id)
    if (!existing) throw new Error(`PartnerInvoice not found: ${id}`)
    throw new Error(`PartnerInvoice ${id} is paid and cannot be voided`)
  }
}
