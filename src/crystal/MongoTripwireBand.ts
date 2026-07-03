import type { Collection } from 'mongodb'
import type { TripwireBandState, TripwireBandStore } from './licenseTripwire.js'

// Single-document Mongo store for the license-tripwire's last band (see licenseTripwire.ts). One
// doc, fixed _id, upserted each evaluation — the tripwire needs only "what band were we in last
// time" to detect a transition across restarts. `R` is a bigint (micro-USD); Mongo has no native
// bigint, so it is stored as a decimal string and revived with BigInt(), the same toDoc/fromDoc
// convention MongoRedituum uses for usdFmv.

const STATE_ID = 'license-tripwire'

export class MongoTripwireBandStore implements TripwireBandStore {
  constructor(private readonly col: Collection) {}

  async last(): Promise<TripwireBandState | null> {
    const doc = await this.col.findOne({ _id: STATE_ID as unknown as import('mongodb').ObjectId })
    if (!doc) return null
    const d = doc as unknown as { band: TripwireBandState['band']; R: string; bindingCapUsd: number | null; at: Date }
    return { band: d.band, R: BigInt(d.R), bindingCapUsd: d.bindingCapUsd ?? null, at: d.at }
  }

  async save(state: TripwireBandState): Promise<void> {
    await this.col.replaceOne(
      { _id: STATE_ID as unknown as import('mongodb').ObjectId },
      {
        _id: STATE_ID,
        band: state.band,
        R: state.R.toString(),
        bindingCapUsd: state.bindingCapUsd,
        at: state.at,
      } as unknown as Record<string, unknown>,
      { upsert: true },
    )
  }
}
