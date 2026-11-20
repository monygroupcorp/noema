import type { Collection, Db } from 'mongodb'
import type { BehaviourEvent, BehaviourEventKind } from './BehaviourEvent.js'

export interface BehaviourEventDoc extends BehaviourEvent {
  _id?: unknown
  savedAt: string
}

export class BehaviourEventStore {
  private col: Collection<BehaviourEventDoc>

  constructor(db: Db) {
    this.col = db.collection('behaviour_events')
  }

  async save(event: BehaviourEvent): Promise<void> {
    await this.col.insertOne({ ...event, savedAt: new Date().toISOString() })
  }

  async query(filter: {
    kind?:     BehaviourEventKind
    ownerKey?: string
    since?:    Date
    limit?:    number
  }): Promise<BehaviourEventDoc[]> {
    const q: Record<string, unknown> = {}
    if (filter.kind)     q.kind     = filter.kind
    if (filter.ownerKey) q.ownerKey = filter.ownerKey
    if (filter.since)    q.ts = { $gte: filter.since.toISOString() }

    return this.col
      .find(q)
      .sort({ ts: -1 })
      .limit(filter.limit ?? 100)
      .toArray() as unknown as BehaviourEventDoc[]
  }

  /** Count of events per kind since the cutoff — the raw input to a funnel view. */
  async totals(since: Date): Promise<Record<BehaviourEventKind, number>> {
    const rows = await this.col.aggregate<{ _id: BehaviourEventKind; count: number }>([
      { $match: { ts: { $gte: since.toISOString() } } },
      { $group: { _id: '$kind', count: { $sum: 1 } } },
    ]).toArray()
    const out: Record<string, number> = {}
    for (const row of rows) out[row._id] = row.count
    return out as Record<BehaviourEventKind, number>
  }

  /**
   * Distinct owners who reached each kind since the cutoff — the funnel is measured by
   * DISTINCT visitor, not raw event count, so one visitor refreshing the catalog ten
   * times does not read as ten "visitors who viewed the catalog."
   */
  async distinctOwnersByKind(since: Date): Promise<Record<BehaviourEventKind, number>> {
    const rows = await this.col.aggregate<{ _id: BehaviourEventKind; owners: string[] }>([
      { $match: { ts: { $gte: since.toISOString() } } },
      { $group: { _id: '$kind', owners: { $addToSet: '$ownerKey' } } },
    ]).toArray()
    const out: Record<string, number> = {}
    for (const row of rows) out[row._id] = row.owners.length
    return out as Record<BehaviourEventKind, number>
  }
}
