import { randomUUID } from 'node:crypto'
import type { Reditus, ReditusDraft, Redituum } from '../types/reditus.js'

/**
 * In-memory USD revenue book. The fail-closed FMV invariant (ADR-0013 §2) lives in
 * record() — the single write path — exactly as MemorySignorum enforces the privacy
 * partition in issue(). The trailing-12-month rollup is a plain range-sum over natum.
 *
 * The real store is Mongo (a range-sum on an indexed natum); this Map impl proves the
 * contract. See src/types/reditus.ts + docs/spec/conditional-license-revenue.md.
 */
export class MemoryRedituum implements Redituum {
  private readonly store = new Map<string, Reditus>()

  async record(draft: ReditusDraft): Promise<Reditus> {
    // FAIL-CLOSED: an inbound payment must carry a priced usdFmv AND a logged source.
    // A missing/zero/negative FMV is "could not price" → a hard error, never a silent 0.
    if (typeof draft.usdFmv !== 'bigint' || draft.usdFmv <= 0n) {
      throw new Error(`Reditus fail-closed: usdFmv must be a positive priced micro-USD amount (got ${String(draft.usdFmv)})`)
    }
    if (!draft.fmvSource || draft.fmvSource.trim() === '') {
      throw new Error('Reditus fail-closed: fmvSource (price oracle / source-of-record) is required — cannot record an unpriced deposit')
    }
    // Idempotent on depositumId: a re-delivered webhook for the same on-chain deposit must not
    // double-count revenue. First writer wins; later calls return the existing row unchanged.
    if (draft.depositumId !== undefined) {
      for (const existing of this.store.values()) {
        if (existing.depositumId === draft.depositumId) return existing
      }
    }
    // Idempotent on chargeRef (fiat): a redelivered Stripe payment (or the two events that share
    // one payment_intent) must not double-book revenue. Mirrors the depositumId guard; in Mongo
    // this is enforced by a unique partial index, here by a scan (single-writer, no race).
    if (draft.chargeRef !== undefined) {
      for (const existing of this.store.values()) {
        if (existing.chargeRef === draft.chargeRef) return existing
      }
    }
    const record: Reditus = {
      id: randomUUID(),
      natum: draft.natum ?? new Date(),
      usdFmv: draft.usdFmv,
      fmvSource: draft.fmvSource,
      origo: draft.origo,
      ...(draft.depositumId !== undefined ? { depositumId: draft.depositumId } : {}),
      ...(draft.chargeRef !== undefined ? { chargeRef: draft.chargeRef } : {}),
    }
    this.store.set(record.id, record)
    return record
  }

  async trailingUsdRevenue(now: Date): Promise<bigint> {
    const cutoff = new Date(now)
    cutoff.setFullYear(cutoff.getFullYear() - 1)   // 12 months before `now`
    let sum = 0n
    for (const r of this.store.values()) {
      // window (cutoff, now]: a receipt exactly 12 months old has rolled off; a future-
      // dated receipt (clock skew) is excluded from the trailing figure.
      if (r.natum > cutoff && r.natum <= now) sum += r.usdFmv
    }
    return sum
  }
}
