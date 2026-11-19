// =============================================================================
// MemoryProMonthlySubscriptions -- in-memory ProMonthlySubscriptionStore (tests only)
// =============================================================================
//
// Mirrors MemorySignorum/MemoryRedituum: a Map-backed double for the hermetic webhook tests.
// See src/crystal/MongoProMonthlySubscriptions.ts for the production implementation.
// =============================================================================

import type { ProMonthlySubscriptionRecord, ProMonthlySubscriptionStore } from '../api/webhooks/stripeProMonthlyWebhook.js'

export class MemoryProMonthlySubscriptions implements ProMonthlySubscriptionStore {
  private readonly byId = new Map<string, ProMonthlySubscriptionRecord>()
  private seq = 0

  async activate(input: { animaId: string; stripeSubscriptionId: string }): Promise<ProMonthlySubscriptionRecord> {
    const existing = this.byId.get(input.stripeSubscriptionId)
    if (existing) {
      const reactivated: ProMonthlySubscriptionRecord = { ...existing, status: 'active', canceledAt: undefined }
      this.byId.set(input.stripeSubscriptionId, reactivated)
      return reactivated
    }
    const record: ProMonthlySubscriptionRecord = {
      id: `promonthly_${++this.seq}`,
      animaId: input.animaId,
      stripeSubscriptionId: input.stripeSubscriptionId,
      status: 'active',
      natum: new Date(),
    }
    this.byId.set(input.stripeSubscriptionId, record)
    return record
  }

  async findBySubscriptionId(stripeSubscriptionId: string): Promise<ProMonthlySubscriptionRecord | null> {
    return this.byId.get(stripeSubscriptionId) ?? null
  }

  async cancel(stripeSubscriptionId: string): Promise<void> {
    const existing = this.byId.get(stripeSubscriptionId)
    if (!existing || existing.status === 'canceled') return
    this.byId.set(stripeSubscriptionId, { ...existing, status: 'canceled', canceledAt: new Date() })
  }
}
