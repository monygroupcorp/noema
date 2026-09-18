import { Collection } from 'mongodb'
import type { PartnerUsage, PartnerUsageRollup, PartnerUsageStore } from '../types/partnerUsage.js'
import { rollup } from './MemoryPartnerUsage.js'

function fromDoc(doc: Record<string, unknown>): PartnerUsage {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { _id, ...rest } = doc as Record<string, unknown> & { _id: unknown }
  return rest as unknown as PartnerUsage
}

/**
 * The B2B meter. `actumId` is the document `_id`, which is what makes `record` idempotent and
 * `settle`/`void` addressable by the completion webhook — the webhook knows the actum and
 * nothing about the credential that started it.
 *
 * `sumPeriod` fetches the window and rolls it up in process rather than in an aggregation
 * pipeline: the totals are bigint impetus, which Mongo's `$sum` cannot hold exactly past 2^53,
 * and a billing total that silently loses precision is the one number here that must not.
 * A single partner's single billing period is a bounded fetch.
 */
export class MongoPartnerUsage implements PartnerUsageStore {
  constructor(private col: Collection) {}

  async record(entry: Pick<PartnerUsage, 'actumId' | 'animaId' | 'keyPrefix' | 'modusId' | 'calledAt'>): Promise<void> {
    await this.col.updateOne(
      { _id: entry.actumId as unknown as object },
      { $setOnInsert: { ...entry } },
      { upsert: true },
    )
  }

  async settle(
    actumId: string,
    patch: { settledAt: Date; impetus: string; durationMs?: number; modusLabel: string; models: string[] },
  ): Promise<void> {
    await this.col.updateOne(
      { _id: actumId as unknown as object },
      {
        $set: {
          settledAt: patch.settledAt,
          impetus: patch.impetus,
          modusLabel: patch.modusLabel,
          models: patch.models,
          ...(patch.durationMs !== undefined ? { durationMs: patch.durationMs } : {}),
        },
      },
    )
  }

  async void(actumId: string, at: Date): Promise<void> {
    await this.col.updateOne({ _id: actumId as unknown as object }, { $set: { voidedAt: at } })
  }

  private async window(animaId: string, from: Date, to: Date): Promise<PartnerUsage[]> {
    const docs = await this.col
      .find({ animaId, calledAt: { $gte: from, $lt: to } })
      .sort({ calledAt: -1 })
      .toArray()
    return docs.map(d => fromDoc(d as Record<string, unknown>))
  }

  async list(animaId: string, from: Date, to: Date): Promise<PartnerUsage[]> {
    return this.window(animaId, from, to)
  }

  async sumPeriod(animaId: string, from: Date, to: Date): Promise<PartnerUsageRollup> {
    return rollup(await this.window(animaId, from, to))
  }
}
