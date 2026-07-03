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
 * idempotency-on-depositumId is enforced by a UNIQUE PARTIAL INDEX on depositumId (created via
 * ensureIndexes) — so two concurrent webhook re-deliveries cannot both insert. The loser catches
 * the duplicate-key error and returns the row the winner wrote. Fiat rows carry no depositumId
 * and are excluded from the index (partialFilterExpression), so they always append.
 *
 * See src/types/reditus.ts + docs/spec/conditional-license-revenue.md.
 */
export class MongoRedituum implements Redituum {
  constructor(private col: Collection) {}

  /**
   * Create the id + depositumId indexes. Idempotent; call once at startup (mirrors how the
   * webhook wiring creates its collection indexes). The depositumId index is UNIQUE + PARTIAL
   * (only over docs that HAVE a depositumId) — that is what makes record() concurrency-safe.
   */
  async ensureIndexes(): Promise<void> {
    await this.col.createIndex({ id: 1 }, { unique: true })
    await this.col.createIndex(
      { depositumId: 1 },
      { unique: true, partialFilterExpression: { depositumId: { $exists: true } } },
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
    }
    try {
      await this.col.insertOne(toDoc(record))
      return record
    } catch (err) {
      // Idempotent on depositumId: a concurrent re-delivery already inserted this deposit's row.
      // Return the existing row unchanged so revenue is counted exactly once. Only the depositumId
      // unique index can collide here (id is a fresh uuid); anything else is a real error.
      if (draft.depositumId !== undefined && err instanceof MongoServerError && err.code === 11000) {
        const existing = await this.col.findOne({ depositumId: draft.depositumId })
        if (existing) return fromDoc(existing as Record<string, unknown>)
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
    const docs = await this.col.find({ natum: { $gt: cutoff, $lte: now } }).toArray()
    return docs.reduce((sum, d) => sum + BigInt((d as Record<string, unknown>).usdFmv as string), 0n)
  }
}
