import type { Collection, Filter, Document } from 'mongodb'
import type { ActumIndex, ActumIndexStore } from '../types/actumIndex.js'
import type { AuctorKey } from '../flow/types.js'

/** Opaque page cursor = the (settledAt, actumId) of the last row on the previous
 *  page. Base64url of `${iso}|${actumId}` — enough to resume the deterministic
 *  (settledAt desc, actumId desc) sort with no dupes and no skips. */
function encodeCursor(settledAt: Date, actumId: string): string {
  return Buffer.from(`${settledAt.toISOString()}|${actumId}`, 'utf8').toString('base64url')
}
function decodeCursor(cursor: string): { settledAt: Date; actumId: string } | null {
  try {
    const raw = Buffer.from(cursor, 'base64url').toString('utf8')
    const sep = raw.lastIndexOf('|')
    if (sep < 0) return null
    const settledAt = new Date(raw.slice(0, sep))
    const actumId = raw.slice(sep + 1)
    if (Number.isNaN(settledAt.getTime()) || !actumId) return null
    return { settledAt, actumId }
  } catch {
    return null
  }
}

/** Owner filter shared by every owner-scoped read. bursaToken keys map to `null`
 *  (never indexed) so the caller can short-circuit to an empty result. */
function ownerFilter(key: AuctorKey): Filter<Document> | null {
  if ('bursaToken' in key) return null
  return 'animaId' in key ? { animaId: key.animaId } : { commitment: key.commitment }
}

/**
 * MongoActumIndex — Mongo-backed ActumIndexStore. One document per actumId
 * (unique). Either `animaId` OR `commitment` is set on each document; queries
 * filter by whichever the AuctorKey carries. Recommended indexes on both
 * (sparse) fields for hot `/status` reads, and a compound
 * `{ animaId|commitment, settledAt, actumId }` for the settled-history listing.
 */
export class MongoActumIndex implements ActumIndexStore {
  constructor(private readonly col: Collection) {}

  async record(entry: ActumIndex): Promise<void> {
    await this.col.replaceOne({ actumId: entry.actumId }, entry, { upsert: true })
  }

  async findFor(key: AuctorKey): Promise<ActumIndex[]> {
    // bursaToken runs are not indexed — dispatchInceptio skips the record() call for them.
    // The index exists for identified (animaId) and arcanum commitment runs only.
    if ('bursaToken' in key) return []
    // IN-FLIGHT ONLY: exclude settled rows. Retain-on-settle (noema-026) keeps terminal
    // rows in the collection for the settled-history listing (`listSettled`), but `findFor`
    // is the in-flight surface — `/status` fans out one actorum.findById per returned row,
    // and the GDPR export ships them, so returning a user's entire lifetime history here
    // would be an unbounded /status fan-out and an export-payload change. Settled rows are
    // reachable only through `listSettled`/`sumSettledImpetus`.
    const owner = 'animaId' in key
      ? { animaId: key.animaId }
      : { commitment: key.commitment }
    const filter = { ...owner, settledAt: { $exists: false } }
    const docs = await this.col.find(filter).toArray()
    return docs.map(d => {
      const { _id: _omit, ...rest } = d as ActumIndex & { _id: unknown }
      return rest as ActumIndex
    })
  }

  async remove(actumId: string): Promise<void> {
    await this.col.deleteOne({ actumId })
  }

  /** Identity fallback (noema-044) — `settle` already upserts/updates keyed by actumId,
   *  so the entry is trivially findable by that same key regardless of settled state. */
  async findByActumId(actumId: string): Promise<ActumIndex | null> {
    const doc = await this.col.findOne({ actumId })
    if (!doc) return null
    const { _id: _omit, ...rest } = doc as ActumIndex & { _id: unknown }
    return rest as ActumIndex
  }

  /** Retain-on-settle: stamp the existing row in place, keyed by actumId (preserves
   *  the owner key). Idempotent — a repeated at-least-once webhook re-stamps the same
   *  values. No upsert: if the row is gone (never indexed / already pruned) it's a no-op. */
  async settle(actumId: string, patch: { settledAt: Date; impetus: string; modusLabel: string }): Promise<void> {
    await this.col.updateOne(
      { actumId },
      { $set: { settledAt: patch.settledAt, impetus: patch.impetus, modusLabel: patch.modusLabel } },
    )
  }

  async listSettled(
    key: AuctorKey,
    opts: { limit: number; cursor?: string },
  ): Promise<{ entries: ActumIndex[]; nextCursor?: string }> {
    const owner = ownerFilter(key)
    if (!owner) return { entries: [] }

    const limit = Math.min(Math.max(Math.trunc(opts.limit) || 0, 1), 100)
    const filter: Filter<Document> = { ...owner, settledAt: { $exists: true } }

    if (opts.cursor) {
      const c = decodeCursor(opts.cursor)
      if (c) {
        // Rows strictly after the cursor in (settledAt desc, actumId desc) order.
        filter.$or = [
          { settledAt: { $lt: c.settledAt } },
          { settledAt: c.settledAt, actumId: { $lt: c.actumId } },
        ]
      }
    }

    // Fetch one extra to know whether another page exists.
    const docs = await this.col
      .find(filter)
      .sort({ settledAt: -1, actumId: -1 })
      .limit(limit + 1)
      .toArray()

    const hasMore = docs.length > limit
    const page = hasMore ? docs.slice(0, limit) : docs
    const entries = page.map(d => {
      const { _id: _omit, ...rest } = d as ActumIndex & { _id: unknown }
      return rest as ActumIndex
    })

    let nextCursor: string | undefined
    if (hasMore) {
      const last = entries[entries.length - 1]
      if (last?.settledAt) nextCursor = encodeCursor(new Date(last.settledAt), last.actumId)
    }
    return { entries, ...(nextCursor ? { nextCursor } : {}) }
  }

  /** Lifetime settled-impetus sum for the owner. Sums `impetus` (stored as a string) via
   *  `$toDecimal` so the total is exact even beyond 2^53, then serialises it back to a
   *  base-10 string. `'0'` when there is no settled history. */
  async sumSettledImpetus(key: AuctorKey): Promise<string> {
    const owner = ownerFilter(key)
    if (!owner) return '0'
    const rows = await this.col
      .aggregate([
        { $match: { ...owner, settledAt: { $exists: true } } },
        { $group: { _id: null, total: { $sum: { $toDecimal: '$impetus' } } } },
      ])
      .toArray()
    const total = rows[0]?.total
    if (total == null) return '0'
    // Decimal128 → integer string (impetus is always a whole-point integer).
    return total.toString().split('.')[0]
  }
}
