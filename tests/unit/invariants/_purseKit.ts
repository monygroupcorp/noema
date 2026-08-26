// An in-memory Bursarum for the invariant suites.
//
// Declared `implements Bursarum`, so it is held to the real store contract by
// `typecheck:tests` — a double that drifts from the interface stops being evidence about the
// system. The redemption claim mirrors the Mongo implementation's semantics exactly: one step,
// conditional on the purse being OWNED and ACTIVE. That condition is the whole of the one-shot
// rule, so a double that granted the claim unconditionally would make these tests pass while
// the property they assert was false.

import type { Bursa, Bursarum, BursaCreateOpts } from '../../../src/types/bursa.js'
import { InsufficientBursaCreditsError } from '../../../src/types/bursa.js'

export class MemoryBursarium implements Bursarum {
  readonly byToken = new Map<string, Bursa>()
  private n = 0

  async create(credits: bigint, opts?: BursaCreateOpts): Promise<Bursa> {
    const b: Bursa = {
      id: `purse-${++this.n}`, credits, createdAt: new Date(),
      ...(opts?.owner ? { owner: opts.owner, status: 'active' as const } : {}),
      ...(opts?.label !== undefined ? { label: opts.label } : {}),
    }
    this.byToken.set(b.id, b)
    return { ...b }
  }

  async findByToken(token: string): Promise<Bursa | null> {
    const b = this.byToken.get(token)
    return b ? { ...b } : null
  }

  async debit(token: string, amount: bigint): Promise<Bursa> {
    const b = this.byToken.get(token)
    if (!b) throw new Error('Bursa not found')
    if (b.credits < amount) throw new InsufficientBursaCreditsError(b.credits, amount)
    b.credits -= amount
    return { ...b }
  }

  async credit(token: string, amount: bigint): Promise<void> {
    const b = this.byToken.get(token)
    if (b) b.credits += amount
  }

  async listByOwner(animaId: string): Promise<Bursa[]> {
    return [...this.byToken.values()].filter((b) => b.owner?.animaId === animaId).map((b) => ({ ...b }))
  }

  async setStatus(token: string, status: NonNullable<Bursa['status']>): Promise<void> {
    const b = this.byToken.get(token)
    if (b) b.status = status
  }

  async claimForRedemption(token: string, at: Date): Promise<Bursa | null> {
    const b = this.byToken.get(token)
    if (!b || !b.owner || (b.status ?? 'active') !== 'active') return null
    b.status = 'redeemed'
    b.redeemedAt = at
    return { ...b }
  }

  async releaseRedemptionClaim(token: string): Promise<void> {
    const b = this.byToken.get(token)
    if (b && b.status === 'redeemed') { b.status = 'active'; delete b.redeemedAt }
  }
}

/** Credits sitting in purses — one of the three places a credit can be. */
export function purseCredits(bursarium: MemoryBursarium): bigint {
  return [...bursarium.byToken.values()].reduce((sum, b) => sum + b.credits, 0n)
}
