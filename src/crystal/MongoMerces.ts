import { Collection, MongoServerError } from 'mongodb'
import { v4 as uuidv4 } from 'uuid'
import type { Merces, MercesDraft, MercesStatus, Mercedum } from '../types/merces.js'

// usdFmv is a bigint (micro-USD); Mongo has no native bigint, so it is stored as a decimal
// string and revived with BigInt() — the same convention MongoRedituum/MongoSignorum use.
function toDoc(m: Merces): Record<string, unknown> {
  const { usdFmv, ...rest } = m
  return { ...rest, usdFmv: usdFmv.toString() }
}
function fromDoc(doc: Record<string, unknown>): Merces {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { _id, usdFmv, ...rest } = doc as Record<string, unknown> & { _id: unknown; usdFmv: string }
  return { ...rest, usdFmv: BigInt(usdFmv) } as Merces
}

function yearOf(d: Date): number {
  return d.getUTCFullYear()
}

/**
 * Mongo payee-payout book (ADR-0013 §4c). The fail-closed invariant lives in accrue(); the
 * per-source idempotency is a UNIQUE INDEX on `sourceRef` (created via ensureIndexes) — two
 * concurrent settles of the same x402 payment cannot both accrue; the loser returns the
 * winner's row, so an agent is paid at-most-once per event. See src/types/merces.ts.
 */
export class MongoMerces implements Mercedum {
  constructor(private col: Collection) {}

  async ensureIndexes(): Promise<void> {
    await this.col.createIndex({ id: 1 }, { unique: true })
    await this.col.createIndex({ sourceRef: 1 }, { unique: true })          // per-event idempotency
    await this.col.createIndex({ payeeAnimaId: 1, taxYear: 1 })             // the per-payee annual rollup
  }

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
    const natum = draft.natum ?? new Date()
    const record: Merces = {
      id: uuidv4(),
      payeeAnimaId: draft.payeeAnimaId,
      ...(draft.payoutAddress !== undefined ? { payoutAddress: draft.payoutAddress } : {}),
      usdFmv: draft.usdFmv,
      fmvSource: draft.fmvSource,
      taxYear: yearOf(natum),
      sourceRef: draft.sourceRef,
      kind: draft.kind,
      status,
      natum,
    }
    try {
      await this.col.insertOne(toDoc(record))
      return record
    } catch (err) {
      // Idempotent on sourceRef: a concurrent re-settle already accrued this event. Return the
      // existing row unchanged so the payee is credited exactly once.
      if (err instanceof MongoServerError && err.code === 11000) {
        const existing = await this.col.findOne({ sourceRef: draft.sourceRef })
        if (existing) return fromDoc(existing as Record<string, unknown>)
      }
      throw err
    }
  }

  async find(id: string): Promise<Merces | null> {
    const doc = await this.col.findOne({ id })
    return doc ? fromDoc(doc as Record<string, unknown>) : null
  }

  async annualTotal(payeeAnimaId: string, taxYear: number): Promise<bigint> {
    // usdFmv is a string, so it cannot be $sum'd; fetch the payee's year rows and reduce in
    // bigint (same posture as MongoRedituum.trailingUsdRevenue). Sums ALL statuses — the 1099
    // obligation is on total earnings, not on what has been disbursed.
    const docs = await this.col.find({ payeeAnimaId, taxYear }).toArray()
    return docs.reduce((sum, d) => sum + BigInt((d as Record<string, unknown>).usdFmv as string), 0n)
  }

  async setStatus(id: string, status: MercesStatus): Promise<void> {
    await this.col.updateOne({ id }, { $set: { status } })
  }

  async listByPayee(payeeAnimaId: string, taxYear: number): Promise<Merces[]> {
    const docs = await this.col.find({ payeeAnimaId, taxYear }).sort({ natum: -1 }).toArray()
    return docs.map((d) => fromDoc(d as Record<string, unknown>))
  }
}
