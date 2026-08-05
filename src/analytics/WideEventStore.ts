import type { Collection, Db } from 'mongodb'
import type { WideEvent } from '../lib/wide.js'

export interface WideEventDoc extends WideEvent {
  _id?: unknown
  savedAt: string
}

export class WideEventStore {
  private col: Collection<WideEventDoc>

  constructor(db: Db) {
    this.col = db.collection('wide_events')
  }

  async save(wide: WideEvent): Promise<void> {
    await this.col.insertOne({ ...wide, savedAt: new Date().toISOString() })
  }

  async query(filter: {
    animaId?: string
    modusId?: string
    status?:  'completed' | 'failed'
    since?:   Date
    limit?:   number
  }): Promise<WideEventDoc[]> {
    const q: Record<string, unknown> = {}
    if (filter.animaId) q.animaId = filter.animaId
    if (filter.modusId) q.modusId = filter.modusId
    if (filter.status)  q.status  = filter.status
    if (filter.since)   q.ts = { $gte: filter.since.toISOString() }

    return this.col
      .find(q)
      .sort({ ts: -1 })
      .limit(filter.limit ?? 100)
      .toArray() as unknown as WideEventDoc[]
  }

  async totals(since: Date): Promise<{ revenue: bigint; count: number; failed: number }> {
    const docs = await this.query({ since, limit: 10_000 })
    let revenue = 0n
    let failed  = 0
    for (const d of docs) {
      revenue += BigInt(d.impetus ?? '0')
      if (d.status === 'failed') failed++
    }
    return { revenue, count: docs.length, failed }
  }

  /** COGS rollup (admin workspace) — sums `costUsd` across jobs since the cutoff via a real
   *  Mongo aggregation (costUsd is a plain number, unlike impetus's bigint-as-string). Docs
   *  missing costUsd (no pod telemetry) contribute 0, not a skip, so `count` still reflects
   *  the full windowed job volume. */
  async sumCostUsd(since: Date): Promise<{ costUsd: number; count: number }> {
    const [row] = await this.col.aggregate<{ costUsd: number; count: number }>([
      { $match: { ts: { $gte: since.toISOString() } } },
      { $group: { _id: null, costUsd: { $sum: { $ifNull: ['$costUsd', 0] } }, count: { $sum: 1 } } },
    ]).toArray()
    return { costUsd: row?.costUsd ?? 0, count: row?.count ?? 0 }
  }
}
