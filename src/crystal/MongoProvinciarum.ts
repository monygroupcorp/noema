import type { Collection, Document, Filter } from 'mongodb'
import { randomUUID } from 'node:crypto'
import type { Provincia, Provinciae, ProvinciaListOpts, ProvinciaPatch, Provinciarum } from '../types/provincia.js'

// =============================================================================
// MongoProvinciarum — the project store (no bigint fields → plain marshalling)
// =============================================================================

function fromDoc(doc: Document): Provincia {
  const { _id, ...rest } = doc as Provincia & { _id: unknown }
  return rest as Provincia
}

export class MongoProvinciarum implements Provinciarum {
  constructor(private readonly col: Collection) {}

  async find(id: string): Promise<Provincia | null> {
    const doc = await this.col.findOne({ id })
    return doc ? fromDoc(doc) : null
  }

  async create(input: Omit<Provincia, 'id' | 'natum' | 'mutatum'>): Promise<Provincia> {
    const now = new Date()
    const provincia: Provincia = { ...input, id: randomUUID(), natum: now, mutatum: now }
    await this.col.insertOne({ ...provincia })
    return provincia
  }

  async update(id: string, patch: ProvinciaPatch): Promise<Provincia> {
    // Split the patch: defined fields → $set, undefined fields → $unset (so clearing an
    // optional field like `sodalitasId` REMOVES it, not stores a null the projection would
    // then emit as teamId:null). $set always carries the mutatum bump.
    const set: Record<string, unknown> = { mutatum: new Date() }
    const unset: Record<string, ''> = {}
    for (const [k, v] of Object.entries(patch)) {
      if (v === undefined) unset[k] = ''
      else set[k] = v
    }
    const update: Record<string, unknown> = { $set: set }
    if (Object.keys(unset).length) update.$unset = unset
    const result = await this.col.findOneAndUpdate({ id }, update, { returnDocument: 'after' })
    if (!result) throw new Error(`Provincia '${id}' not found`)
    return fromDoc(result)
  }

  async remove(id: string): Promise<void> {
    await this.col.deleteOne({ id })
  }

  /**
   * ACCESS, in the query. The caller's own projects UNION the projects shared with a team the
   * caller is a member of (`Provincia.sodalitasId` — the team overlay; `opts.sodalitasIds` is
   * resolved at the API layer from the authenticated caller, never from a request parameter).
   * With no team ids the filter is the bare `{ animaId }` this list has always used, so a caller
   * in no team reads exactly what they read before.
   *
   * One `$or` and nothing else on the filter, so there is no second `$or` for it to collide
   * with; if a further predicate is ever added here it must be composed under `$and` (the shape
   * `MongoDataset._page` uses for its cursor clause), never written onto the same key.
   */
  async list(opts: ProvinciaListOpts): Promise<Provinciae> {
    const teamIds = opts.sodalitasIds ?? []
    const filter: Filter<Document> =
      teamIds.length > 0
        ? { $or: [{ animaId: opts.animaId }, { sodalitasId: { $in: teamIds } }] }
        : { animaId: opts.animaId }
    // Oldest-first (by creation) — a stable order so the project set doesn't reshuffle
    // between loads (the client picks projects[0] as the default fallback).
    const docs = await this.col.find(filter).sort({ natum: 1 }).toArray()
    return docs.map(fromDoc)
  }

  /** Owner-only, and no team seam: the account export reads this. */
  async listByOwner(animaId: string): Promise<Provinciae> {
    return this.list({ animaId })
  }

  /**
   * GDPR erasure (noema-025) — hard-delete every project (Provincia) owned by this soul. The
   * filed assets themselves are separate nouns (untouched — a project is just a folder ref);
   * this removes the owner's project rows. Idempotent — a re-run returns 0.
   */
  async deleteByOwner(animaId: string): Promise<number> {
    const r = await this.col.deleteMany({ animaId })
    return r.deletedCount ?? 0
  }
}
