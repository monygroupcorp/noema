import { Collection, MongoServerError } from 'mongodb'
import { v4 as uuidv4 } from 'uuid'
import type { Reditus, ReditusDraft, Redituum } from '../types/reditus.js'

// usdFmv is a bigint (micro-USD); Mongo has no native bigint, so it is stored as a decimal
// string and revived with BigInt() — the same toDoc/fromDoc convention MongoSignorum and
// MongoDepositum use for their bigint `valor`. natum stays a native Date (range-queryable).
function toDoc(r: Reditus): Record<string, unknown> {
  const { usdFmv, ...rest } = r
  return { ...rest, usdFmv: usdFmv.toString() }
}

function fromDoc(doc: Record<string, unknown>): Reditus {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { _id, usdFmv, ...rest } = doc as Record<string, unknown> & { _id: unknown; usdFmv: string }
  return { ...rest, usdFmv: BigInt(usdFmv) } as Reditus
}

/**
 * Mongo USD revenue book. The fail-closed FMV invariant (ADR-0013 §2) lives in record(), and
 * idempotency is enforced by UNIQUE PARTIAL INDEXES — on `depositumId` (crypto) and on
 * `chargeRef` where origo:'fiat' (fiat, e.g. a Stripe payment_intent id) — so two concurrent
 * webhook re-deliveries cannot both insert. The loser catches the duplicate-key error and returns
 * the row the winner wrote. Rows carrying neither key are excluded from both partial indexes and
 * always append.
 *
 * See src/types/reditus.ts + docs/spec/conditional-license-revenue.md.
 */
export class MongoRedituum implements Redituum {
  constructor(private col: Collection) {}

  /**
   * Create the id + depositumId + chargeRef + natum indexes. Idempotent; call once at startup
   * (mirrors how the webhook wiring creates its collection indexes). The depositumId (crypto) and
   * chargeRef (fiat) indexes are UNIQUE + PARTIAL (only over docs that HAVE that key) — that is
   * what makes record() concurrency-safe.
   */
  async ensureIndexes(): Promise<void> {
    await this.col.createIndex({ id: 1 }, { unique: true })
    await this.col.createIndex(
      { depositumId: 1 },
      { unique: true, partialFilterExpression: { depositumId: { $exists: true } } },
    )
    // Fiat idempotency: unique + partial on chargeRef over FIAT rows that carry one — the
    // atomic cross-instance guard that a redelivered Stripe payment books revenue exactly once.
    // Scoped to origo:'fiat' AND chargeRef existing, so crypto rows and legacy fiat rows without
    // a chargeRef are excluded (they still append freely).
    await this.col.createIndex(
      { chargeRef: 1 },
      { unique: true, partialFilterExpression: { origo: 'fiat', chargeRef: { $exists: true } } },
    )
    // Refund clawback (noema-082): UNIQUE + PARTIAL on `reversalOf` over contra-rows that carry one
    // — the atomic guard that a redelivered `charge.refunded` reverses a reditus EXACTLY ONCE (one
    // contra-row per original). The loser of a concurrent race catches the dup-key and returns the
    // winner's contra-row. Non-reversal rows (no `reversalOf`) are excluded, so they append freely.
    await this.col.createIndex(
      { reversalOf: 1 },
      { unique: true, partialFilterExpression: { reversalOf: { $exists: true } } },
    )
    await this.col.createIndex({ natum: 1 })   // the trailing-window range scan
  }

  async record(draft: ReditusDraft): Promise<Reditus> {
    // FAIL-CLOSED: a priced usdFmv AND a logged source, or nothing is recorded (ADR-0013 §2).
    if (typeof draft.usdFmv !== 'bigint' || draft.usdFmv <= 0n) {
      throw new Error(`Reditus fail-closed: usdFmv must be a positive priced micro-USD amount (got ${String(draft.usdFmv)})`)
    }
    if (!draft.fmvSource || draft.fmvSource.trim() === '') {
      throw new Error('Reditus fail-closed: fmvSource (price oracle / source-of-record) is required — cannot record an unpriced deposit')
    }
    const record: Reditus = {
      id: uuidv4(),
      natum: draft.natum ?? new Date(),
      usdFmv: draft.usdFmv,
      fmvSource: draft.fmvSource,
      origo: draft.origo,
      ...(draft.depositumId !== undefined ? { depositumId: draft.depositumId } : {}),
      ...(draft.chargeRef !== undefined ? { chargeRef: draft.chargeRef } : {}),
    }
    try {
      await this.col.insertOne(toDoc(record))
      return record
    } catch (err) {
      // Idempotent on depositumId (crypto) / chargeRef (fiat): a concurrent re-delivery already
      // inserted this payment's row. Return the existing row unchanged so revenue is counted
      // exactly once. Only a depositumId/chargeRef partial-unique index can collide here (id is a
      // fresh uuid); anything else is a real error and re-thrown.
      if (err instanceof MongoServerError && err.code === 11000) {
        if (draft.depositumId !== undefined) {
          const existing = await this.col.findOne({ depositumId: draft.depositumId })
          if (existing) return fromDoc(existing as Record<string, unknown>)
        }
        if (draft.chargeRef !== undefined) {
          const existing = await this.col.findOne({ chargeRef: draft.chargeRef, origo: 'fiat' })
          if (existing) return fromDoc(existing as Record<string, unknown>)
        }
      }
      throw err
    }
  }

  async findByChargeRef(chargeRef: string): Promise<Reditus | null> {
    const doc = await this.col.findOne({ chargeRef, origo: 'fiat' })
    return doc ? fromDoc(doc as Record<string, unknown>) : null
  }

  async reverse(originalReditusId: string, amountMicro: bigint, reason: string): Promise<Reditus> {
    // Idempotent on reversalOf (the unique partial index): a redelivered charge.refunded must not
    // double-reverse. A pre-existing contra-row is replayed rather than a second written.
    const existing = await this.col.findOne({ reversalOf: originalReditusId })
    if (existing) return fromDoc(existing as Record<string, unknown>)

    const originalDoc = await this.col.findOne({ id: originalReditusId })
    if (!originalDoc) throw new Error(`Reditus reverse: original '${originalReditusId}' not found`)
    const original = fromDoc(originalDoc as Record<string, unknown>)
    if (typeof amountMicro !== 'bigint' || amountMicro <= 0n) {
      throw new Error(`Reditus reverse: amountMicro must be a positive micro-USD amount (got ${String(amountMicro)})`)
    }
    if (amountMicro > original.usdFmv) {
      throw new Error(`Reditus reverse: amountMicro ${amountMicro} exceeds the original recognized ${original.usdFmv}`)
    }
    // The contra-row: NEGATIVE usdFmv (offsetting), reversalOf → original. Written through THIS
    // dedicated path (not record()), so it is exempt from record()'s fail-closed positivity check.
    const contra: Reditus = {
      id: uuidv4(),
      natum: new Date(),
      usdFmv: -amountMicro,
      fmvSource: reason,
      origo: original.origo,
      reversalOf: originalReditusId,
    }
    try {
      await this.col.insertOne(toDoc(contra))
      return contra
    } catch (err) {
      // The unique partial index on reversalOf fired: a concurrent redelivery already reversed this
      // reditus. Return the winner's contra-row so revenue is un-recognized exactly once.
      if (err instanceof MongoServerError && err.code === 11000) {
        const dup = await this.col.findOne({ reversalOf: originalReditusId })
        if (dup) return fromDoc(dup as Record<string, unknown>)
      }
      throw err
    }
  }

  async trailingUsdRevenue(now: Date): Promise<bigint> {
    const cutoff = new Date(now)
    cutoff.setFullYear(cutoff.getFullYear() - 1)   // window (cutoff, now]
    // usdFmv is stored as a string, so it cannot be $sum'd in the pipeline; fetch the windowed
    // rows and reduce in bigint (the same approach MongoSignorum.balance takes). The natum index
    // bounds the scan to the window. Scale is deferred, identical to balance's posture.
    //
    // Gross side: true inbound rows only (exclude reversal contra-rows), keyed by their own natum.
    const grossDocs = await this.col.find({ natum: { $gt: cutoff, $lte: now }, reversalOf: { $exists: false } }).toArray()
    let sum = grossDocs.reduce((s, d) => s + BigInt((d as Record<string, unknown>).usdFmv as string), 0n)

    // Netting side (noema-082): a refund contra-row un-recognizes revenue in the window the ORIGINAL
    // was recognized in — subtract it (its usdFmv is negative) ONLY when the reditus it points at
    // falls inside this window, NOT by the contra-row's own natum. So a refund of a charge that has
    // already rolled off the trailing window does not spuriously reduce the current figure.
    const reversalDocs = await this.col.find({ reversalOf: { $exists: true } }).toArray()
    if (reversalDocs.length > 0) {
      const originalIds = reversalDocs.map(d => (d as Record<string, unknown>).reversalOf as string)
      const originalsInWindow = await this.col
        .find({ id: { $in: originalIds }, natum: { $gt: cutoff, $lte: now } }, { projection: { id: 1 } })
        .toArray()
      const windowed = new Set(originalsInWindow.map(o => (o as Record<string, unknown>).id as string))
      for (const r of reversalDocs) {
        const rec = r as Record<string, unknown>
        if (windowed.has(rec.reversalOf as string)) sum += BigInt(rec.usdFmv as string)
      }
    }
    return sum
  }
}
