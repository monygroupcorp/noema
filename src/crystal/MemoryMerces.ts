import { randomUUID } from 'node:crypto'
import type { Merces, MercesDraft, MercesStatus, Mercedum } from '../types/merces.js'

/** In-memory payee-payout book — the hermetic mirror of MongoMerces. Enforces the same
 *  fail-closed accrual invariant and the unique-`sourceRef` idempotency (a duplicate accrual
 *  returns the existing row, never a second payout). See src/types/merces.ts. */
export class MemoryMerces implements Mercedum {
  private readonly byId = new Map<string, Merces>()
  private readonly bySource = new Map<string, string>()

  async accrue(draft: MercesDraft, status: MercesStatus): Promise<Merces> {
    if (typeof draft.usdFmv !== 'bigint' || draft.usdFmv <= 0n) {
      throw new Error(`Merces fail-closed: usdFmv must be a positive micro-USD amount (got ${String(draft.usdFmv)})`)
    }
    if (!draft.fmvSource || draft.fmvSource.trim() === '') {
      throw new Error('Merces fail-closed: fmvSource (pricing source-of-record) is required')
    }
    if (!draft.sourceRef || draft.sourceRef.trim() === '') {
      throw new Error('Merces fail-closed: sourceRef (idempotency key) is required')
    }
    const existingId = this.bySource.get(draft.sourceRef)
    if (existingId) return this.byId.get(existingId)!            // idempotent on sourceRef

    const natum = draft.natum ?? new Date()
    const record: Merces = {
      id: randomUUID(),
      payeeAnimaId: draft.payeeAnimaId,
      ...(draft.payoutAddress !== undefined ? { payoutAddress: draft.payoutAddress } : {}),
      usdFmv: draft.usdFmv,
      fmvSource: draft.fmvSource,
      taxYear: natum.getUTCFullYear(),
      sourceRef: draft.sourceRef,
      kind: draft.kind,
      status,
      natum,
    }
    this.byId.set(record.id, record)
    this.bySource.set(record.sourceRef, record.id)
    return record
  }

  async find(id: string): Promise<Merces | null> {
    return this.byId.get(id) ?? null
  }

  async annualTotal(payeeAnimaId: string, taxYear: number): Promise<bigint> {
    let sum = 0n
    for (const m of this.byId.values()) {
      if (m.payeeAnimaId === payeeAnimaId && m.taxYear === taxYear) sum += m.usdFmv
    }
    return sum
  }

  async setStatus(id: string, status: MercesStatus): Promise<void> {
    const m = this.byId.get(id)
    if (m) this.byId.set(id, { ...m, status })
  }

  async listByPayee(payeeAnimaId: string, taxYear: number): Promise<Merces[]> {
    return [...this.byId.values()]
      .filter((m) => m.payeeAnimaId === payeeAnimaId && m.taxYear === taxYear)
      .sort((a, b) => b.natum.getTime() - a.natum.getTime())
  }
}
