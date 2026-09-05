import { Collection } from 'mongodb'
import { v4 as uuidv4 } from 'uuid'
import type { Editio, Editiones, Editionum, ArtifactRef, FeedFilter } from '../types/editio.js'

function fromDoc(doc: Record<string, unknown>): Editio {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { _id, ...rest } = doc as Record<string, unknown> & { _id: unknown }
  return rest as unknown as Editio
}

/** Match the author union `{animaId} | {commitment}` as a flat Mongo query. */
function authorQuery(by: Editio['by']): Record<string, unknown> {
  return 'animaId' in by ? { 'by.animaId': by.animaId } : { 'by.commitment': by.commitment }
}

export class MongoEditionum implements Editionum {
  constructor(private col: Collection) {}

  async create(input: Omit<Editio, 'id' | 'natum' | 'mutatum' | 'status'>): Promise<Editio> {
    const now = new Date()
    const e: Editio = { ...input, id: uuidv4(), status: 'pending', natum: now, mutatum: now }
    await this.col.insertOne({ ...e })
    return e
  }

  async find(id: string): Promise<Editio | null> {
    const doc = await this.col.findOne({ id })
    return doc ? fromDoc(doc as Record<string, unknown>) : null
  }

  async listByArtifact(ref: ArtifactRef): Promise<Editiones> {
    const docs = await this.col.find({ 'artifactRef.kind': ref.kind, 'artifactRef.id': ref.id }).toArray()
    return docs.map((d) => fromDoc(d as Record<string, unknown>))
  }

  async listByAuthor(by: Editio['by']): Promise<Editiones> {
    const docs = await this.col.find(authorQuery(by)).sort({ natum: -1 }).toArray()
    return docs.map((d) => fromDoc(d as Record<string, unknown>))
  }

  async listFeed(filter?: FeedFilter): Promise<Editiones> {
    const query: Record<string, unknown> = {
      status: 'published',
      visibility: filter?.visibility ?? 'feed',
      ...(filter?.destination !== undefined ? { destination: filter.destination } : {}),
      // Author scope keeps the public clamp (published + public visibility above) — it
      // narrows to one creator/agent, never exposes their private/unlisted editions.
      ...(filter?.author !== undefined ? authorQuery(filter.author) : {}),
      // Multi-author scope (collection gallery): any of these identified animaIds.
      ...(filter?.authorAnimaIds !== undefined ? { 'by.animaId': { $in: filter.authorAnimaIds } } : {}),
    }
    let cursor = this.col.find(query).sort({ natum: -1 })
    if (filter?.limit !== undefined) cursor = cursor.limit(filter.limit)
    const docs = await cursor.toArray()
    return docs.map((d) => fromDoc(d as Record<string, unknown>))
  }

  async listHeld(by?: Editio['by']): Promise<Editiones> {
    // The review queue: editions the gate held (reviewOutcome:'pending'). Author-scoped
    // when `by` is given (a creator's own held items), else the full admin queue.
    const query: Record<string, unknown> = {
      reviewOutcome: 'pending',
      ...(by !== undefined ? authorQuery(by) : {}),
    }
    const docs = await this.col.find(query).sort({ natum: -1 }).toArray()
    return docs.map((d) => fromDoc(d as Record<string, unknown>))
  }

  async update(
    id: string,
    patch: Partial<Pick<Editio, 'status' | 'externalRef' | 'visibility' | 'custody' | 'reviewOutcome' | 'leasedUntil' | 'moderation' | 'hostedOutput'>>,
  ): Promise<Editio> {
    const result = await this.col.findOneAndUpdate(
      { id },
      { $set: { ...patch, mutatum: new Date() } },
      { returnDocument: 'after' },
    )
    if (!result) throw new Error(`Editio '${id}' not found`)
    return fromDoc(result as Record<string, unknown>)
  }

  async claimPending(now: Date, leaseMs: number): Promise<Editio | null> {
    // Atomic claim: the oldest pending row whose lease is absent or lapsed. Stamping
    // `leasedUntil` + bumping `attempts` in the same findOneAndUpdate is the lock —
    // a competing worker's identical query won't match a freshly-leased row.
    const result = await this.col.findOneAndUpdate(
      {
        status: 'pending',
        // Skip items held for human review (reviewOutcome:'pending') so a hold does not
        // re-scan every pass; an admin approval sets it to 'approved' → claimable again.
        reviewOutcome: { $ne: 'pending' },
        $or: [{ leasedUntil: { $exists: false } }, { leasedUntil: { $lte: now } }],
      },
      { $set: { leasedUntil: new Date(now.getTime() + leaseMs), mutatum: now }, $inc: { attempts: 1 } },
      { returnDocument: 'after', sort: { natum: 1 } },
    )
    return result ? fromDoc(result as Record<string, unknown>) : null
  }
}
