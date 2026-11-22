// =============================================================================
// MongoProMonthlySubscriptions -- Mongo-backed ProMonthlySubscriptionStore
// =============================================================================
//
// One doc per Stripe subscription: `{ id, animaId, stripeSubscriptionId, status, natum,
// canceledAt? }`. `stripeSubscriptionId` is unique -- `activate` upserts on it, so a
// redelivered `checkout.session.completed` is a no-op rewrite, not a duplicate row.
// =============================================================================

import { Collection } from 'mongodb'
import { randomUUID } from 'crypto'
import type { ProMonthlySubscriptionRecord, ProMonthlySubscriptionStore } from '../api/webhooks/stripeProMonthlyWebhook.js'

interface ProMonthlySubscriptionDoc {
  id: string
  animaId: string
  stripeSubscriptionId: string
  status: 'active' | 'canceled'
  natum: Date
  canceledAt?: Date
}

export class MongoProMonthlySubscriptions implements ProMonthlySubscriptionStore {
  constructor(private readonly col: Collection<ProMonthlySubscriptionDoc>) {}

  /** Lookup + upsert-key index. Idempotent; call once at wiring (mirrors MongoLinkToken). */
  async ensureIndexes(): Promise<void> {
    await this.col.createIndex({ stripeSubscriptionId: 1 }, { unique: true })
    await this.col.createIndex({ animaId: 1 })
  }

  async activate(input: { animaId: string; stripeSubscriptionId: string }): Promise<ProMonthlySubscriptionRecord> {
    const now = new Date()
    const result = await this.col.findOneAndUpdate(
      { stripeSubscriptionId: input.stripeSubscriptionId },
      {
        $set: { animaId: input.animaId, status: 'active' },
        $unset: { canceledAt: '' },
        $setOnInsert: { id: randomUUID(), stripeSubscriptionId: input.stripeSubscriptionId, natum: now },
      },
      { upsert: true, returnDocument: 'after' },
    )
    const doc = result as unknown as ProMonthlySubscriptionDoc
    return toRecord(doc)
  }

  async findBySubscriptionId(stripeSubscriptionId: string): Promise<ProMonthlySubscriptionRecord | null> {
    const doc = await this.col.findOne({ stripeSubscriptionId })
    return doc ? toRecord(doc as unknown as ProMonthlySubscriptionDoc) : null
  }

  async cancel(stripeSubscriptionId: string): Promise<void> {
    await this.col.updateOne(
      { stripeSubscriptionId, status: { $ne: 'canceled' } },
      { $set: { status: 'canceled', canceledAt: new Date() } },
    )
  }
}

function toRecord(doc: ProMonthlySubscriptionDoc): ProMonthlySubscriptionRecord {
  return {
    id: doc.id,
    animaId: doc.animaId,
    stripeSubscriptionId: doc.stripeSubscriptionId,
    status: doc.status,
    natum: doc.natum,
    ...(doc.canceledAt ? { canceledAt: doc.canceledAt } : {}),
  }
}
