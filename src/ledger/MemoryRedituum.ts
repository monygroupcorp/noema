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

  async findByChargeRef(chargeRef: string): Promise<Reditus | null> {
    for (const r of this.store.values()) {
      if (r.origo === 'fiat' && r.chargeRef === chargeRef) return r
    }
    return null
  }

  async reverse(originalReditusId: string, amountMicro: bigint, reason: string): Promise<Reditus> {
    // Idempotent on reversalOf: one contra-row per original (a redelivered charge.refunded must not
    // double-reverse). First writer wins; a later call returns the existing contra-row unchanged.
    for (const existing of this.store.values()) {
      if (existing.reversalOf === originalReditusId) return existing
    }
    const original = this.store.get(originalReditusId)
    if (!original) throw new Error(`Reditus reverse: original '${originalReditusId}' not found`)
    if (typeof amountMicro !== 'bigint' || amountMicro <= 0n) {
      throw new Error(`Reditus reverse: amountMicro must be a positive micro-USD amount (got ${String(amountMicro)})`)
    }
    if (amountMicro > original.usdFmv) {
      throw new Error(`Reditus reverse: amountMicro ${amountMicro} exceeds the original recognized ${original.usdFmv}`)
    }
    // The contra-row: NEGATIVE usdFmv (offsetting), reversalOf → original. Exempt from record()'s
    // fail-closed positivity check by construction (it does not go through record()).
    const contra: Reditus = {
      id: randomUUID(),
      natum: new Date(),
      usdFmv: -amountMicro,
      fmvSource: reason,
      origo: original.origo,
      reversalOf: originalReditusId,
    }
    this.store.set(contra.id, contra)
    return contra
  }

  async trailingUsdRevenue(now: Date): Promise<bigint> {
    const cutoff = new Date(now)
    cutoff.setFullYear(cutoff.getFullYear() - 1)   // 12 months before `now`
    const inWindow = (d: Date): boolean => d > cutoff && d <= now
    let sum = 0n
    for (const r of this.store.values()) {
      // Gross side: only true inbound rows (NOT reversal contra-rows), keyed by their own natum.
      // window (cutoff, now]: a receipt exactly 12 months old has rolled off; a future-dated
      // receipt (clock skew) is excluded from the trailing figure.
      if (r.reversalOf === undefined && inWindow(r.natum)) sum += r.usdFmv
    }
    // Netting side (noema-082): a refund contra-row un-recognizes revenue in the window the ORIGINAL
    // was recognized in — subtract it only when the row it points at falls inside this window (not
    // by the contra-row's own natum). Its usdFmv is already negative, so we add it.
    for (const r of this.store.values()) {
      if (r.reversalOf === undefined) continue
      const original = this.store.get(r.reversalOf)
      if (original && inWindow(original.natum)) sum += r.usdFmv
    }
    return sum
  }
}
