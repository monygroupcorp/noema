import { randomUUID } from 'node:crypto'
import type { Collection, Document, WithId } from 'mongodb'
import type { Locorum, Locus, LocusPlace } from '../types/locus.js'

/**
 * MongoLocorum — Mongo-backed warm-pod line. One document per waiting run
 * (`actumId` unique), ordered by `admissum`.
 *
 * `claim` is a single `findOneAndUpdate` with `{ vocatum: { $exists: false } }` in
 * the filter and `sort: { admissum: 1 }`: the oldest unclaimed place is selected
 * and stamped in one atomic operation, so two app instances reacting to two pods
 * freeing at the same instant cannot hand the same run to both.
 */
export class MongoLocorum implements Locorum {
  constructor(private readonly col: Collection) {}

  async enqueue(input: { actumId: string; imageRef: string }): Promise<Locus> {
    // Idempotent per run: `$setOnInsert` leaves an existing place — and its
    // `admissum` — exactly as it stands, so a re-dispatch of a run already waiting
    // does not send it to the back of its own line.
    const doc = await this.col.findOneAndUpdate(
      { actumId: input.actumId },
      {
        $setOnInsert: {
          id: randomUUID(),
          actumId: input.actumId,
          imageRef: input.imageRef,
          admissum: new Date(),
        },
      },
      { upsert: true, returnDocument: 'after' },
    )
    if (!doc) throw new Error(`Locus upsert returned nothing for actum '${input.actumId}'`)
    return toLocus(doc)
  }

  async place(actumId: string): Promise<LocusPlace | null> {
    const held = await this.col.findOne({ actumId })
    if (!held) return null
    const [ahead, depth] = await Promise.all([
      this.col.countDocuments({
        imageRef: held.imageRef,
        vocatum: { $exists: false },
        admissum: { $lt: held.admissum },
      }),
      this.col.countDocuments({ imageRef: held.imageRef, vocatum: { $exists: false } }),
    ])
    // A claimed place is being dispatched right now: it is out of the counted line,
    // so it stands at the head of a line one longer than the one it left.
    if (held.vocatum) return { place: 1, depth: depth + 1 }
    return { place: ahead + 1, depth }
  }

  async claim(imageRef: string): Promise<Locus | null> {
    const doc = await this.col.findOneAndUpdate(
      { imageRef, vocatum: { $exists: false } },
      { $set: { vocatum: new Date() } },
      { sort: { admissum: 1 }, returnDocument: 'after' },
    )
    return doc ? toLocus(doc) : null
  }

  async waiting(imageRef: string): Promise<Locus[]> {
    const docs = await this.col
      .find({ imageRef, vocatum: { $exists: false } })
      .sort({ admissum: 1 })
      .toArray()
    return docs.map(toLocus)
  }

  async images(): Promise<string[]> {
    return (await this.col.distinct('imageRef', {})) as string[]
  }

  async remove(actumId: string): Promise<void> {
    await this.col.deleteOne({ actumId })
  }

  async release(id: string): Promise<void> {
    await this.col.updateOne({ id }, { $unset: { vocatum: '' } })
  }
}

function toLocus(doc: WithId<Document>): Locus {
  const { _id: _drop, ...rest } = doc
  return rest as unknown as Locus
}
