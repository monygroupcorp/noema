import { randomUUID } from 'node:crypto'
import { Collection, MongoServerError } from 'mongodb'
import type { PartnerInvoice, PartnerInvoiceStatus, PartnerInvoiceStore } from '../types/partnerInvoice.js'

function fromDoc(doc: Record<string, unknown>): PartnerInvoice {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { _id, ...rest } = doc as Record<string, unknown> & { _id: unknown }
  return rest as unknown as PartnerInvoice
}

/** The invoice book. A period is billed once: the not-void (animaId, periodStart, periodEnd)
 *  read below is the same check `MemoryPartnerInvoice` makes, and a unique PARTIAL index over
 *  non-void rows (`crystal/ensureIndexes.ts`) is what actually holds it — a read-then-write
 *  alone is a race between two instances, the same reasoning the fiat `Reditus` follows. */
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
    try {
      await this.col.insertOne({ ...record })
    } catch (err) {
      // The unique partial index fired: another instance issued this period between the read
      // above and this insert. The `id` is a fresh uuid, so nothing else on this collection can
      // collide. Reported as the same refusal the read gives, so a race and a double-click reach
      // the caller as one answer instead of a 409 and a 500.
      if (err instanceof MongoServerError && err.code === 11000) {
        throw new Error(`PartnerInvoice: ${input.animaId} is already billed for this period`)
      }
      throw err
    }
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
    if (res) return fromDoc(res as Record<string, unknown>)

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
    if (res) return fromDoc(res as Record<string, unknown>)
    const existing = await this.find(id)
    if (!existing) throw new Error(`PartnerInvoice not found: ${id}`)
    throw new Error(`PartnerInvoice ${id} is paid and cannot be voided`)
  }
}
