import { Collection, Document, Filter } from 'mongodb'
import { v4 as uuidv4 } from 'uuid'
import type { Collectio, CollectioListOpts, CollectioListPage, Collectiones, CollectioStatus, Collectionum } from '../types/collectio.js'

/** Opaque page cursor = the (natum, id) of the last row on the previous page. Base64url of
 *  `${iso}|${id}` — the same encoding MongoDataset uses, resuming the deterministic
 *  (natum desc, id desc) sort. */
function encodeCursor(natum: Date, id: string): string {
  return Buffer.from(`${natum.toISOString()}|${id}`, 'utf8').toString('base64url')
}
function decodeCursor(cursor: string): { natum: Date; id: string } | null {
  try {
    const raw = Buffer.from(cursor, 'base64url').toString('utf8')
    const sep = raw.lastIndexOf('|')
    if (sep < 0) return null
    const natum = new Date(raw.slice(0, sep))
    const id = raw.slice(sep + 1)
    if (Number.isNaN(natum.getTime()) || !id) return null
    return { natum, id }
  } catch {
    return null
  }
}

function toDoc(c: Partial<Collectio>): Record<string, unknown> {
  const { impetusTotal, ...rest } = c
  return { ...rest, ...(impetusTotal !== undefined ? { impetusTotal: impetusTotal.toString() } : {}) }
}

function fromDoc(doc: Record<string, unknown>): Collectio {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { _id, impetusTotal, reiectae, pendentes, ...rest } = doc as Record<string, unknown> & { _id: unknown; impetusTotal: string; reiectae?: number; pendentes?: number }
  // `reiectae` is part of the dispatch budget (`numerus + reiectae`), so an absent one is not a
  // cosmetic gap: it makes that sum NaN and the fan-out's `nextIndex < totalPieces` guard false
  // forever — the collection goes agens and never dispatches a piece. Docs written before this
  // store seeded the field (and any written by an older build) must read back as 0, not undefined.
  // `pendentes` is read the same way: it is arithmetic (`completae + pendentes + fractae`), so an
  // absent one must be 0, never undefined.
  return { ...rest, reiectae: reiectae ?? 0, pendentes: pendentes ?? 0, impetusTotal: BigInt(impetusTotal ?? '0') } as Collectio
}

export class MongoCollectio implements Collectionum {
  constructor(private col: Collection) {}

  // The counters are the STORE's to seed — every one of them. `reiectae` and `pendentes` belong
  // with `completae`/`fractae` in the omitted set (as the `Collectionum` contract declares):
  // callers never pass them, so a store that does not seed `reiectae` persists a collection with
  // no `reiectae` at all, and `numerus + reiectae` — the CollectioCursor's dispatch budget —
  // becomes NaN.
  async create(input: Omit<Collectio, 'id' | 'natum' | 'acta' | 'completae' | 'fractae' | 'pendentes' | 'reiectae' | 'impetusTotal'>): Promise<Collectio> {
    const now = new Date()
    const c: Collectio = { ...input, id: uuidv4(), acta: [], completae: 0, fractae: 0, pendentes: 0, reiectae: 0, impetusTotal: 0n, natum: now }
    await this.col.insertOne(toDoc(c))
    return c
  }

  async find(id: string): Promise<Collectio | null> {
    const doc = await this.col.findOne({ id })
    return doc ? fromDoc(doc as Record<string, unknown>) : null
  }

  async list(filter?: Partial<Pick<Collectio, 'status'>>): Promise<Collectiones> {
    const docs = await this.col.find(filter ?? {}).toArray()
    return docs.map(d => fromDoc(d as Record<string, unknown>))
  }

  async listByStatus(status: CollectioStatus): Promise<Collectiones> {
    return this.list({ status })
  }

  /**
   * The caller's collections, newest first, owner-scoped and paged in the DATABASE.
   *
   * `list()` above answers "every collection in the store" and is the cursor's status scan; it
   * is not a read a request may take. A per-caller listing that loads every document and drops
   * the ones the caller does not own reads the whole table on every hit, and the documents it
   * discards are other tenants' — so the scope goes in the filter, and the page size bounds
   * what a single request can pull back however large the store grows.
   *
   * The predicate is `_ownsCollection`'s, expressed as a query: the funding identity on `by`,
   * UNION the collections shared with a team the caller belongs to (`sodalitasId`, resolved at
   * the API layer from the authenticated caller — never from a request parameter). A document
   * with no `sodalitasId` cannot match the `$in`, which is the `c.sodalitasId !== undefined`
   * half of the in-process check.
   */
  async listOwned(opts: CollectioListOpts): Promise<CollectioListPage> {
    const funder: Filter<Document> =
      'animaId' in opts.by ? { 'by.animaId': opts.by.animaId } : { 'by.commitment': opts.by.commitment }
    const teamIds = opts.sodalitasIds ?? []
    const access: Filter<Document> =
      teamIds.length > 0 ? { $or: [funder, { sodalitasId: { $in: teamIds } }] } : funder

    const limit = Math.min(Math.max(Math.trunc(opts.limit ?? 100) || 100, 1), 500)
    const clauses: Filter<Document>[] = [access]
    if (opts.cursor) {
      const c = decodeCursor(opts.cursor)
      if (c) {
        clauses.push({ $or: [{ natum: { $lt: c.natum } }, { natum: c.natum, id: { $lt: c.id } }] })
      }
    }

    const docs = await this.col
      .find({ $and: clauses })
      .sort({ natum: -1, id: -1 })
      .limit(limit + 1)
      .toArray()

    const hasMore = docs.length > limit
    const entries = (hasMore ? docs.slice(0, limit) : docs).map(d => fromDoc(d as Record<string, unknown>))
    const last = entries[entries.length - 1]
    const nextCursor = hasMore && last ? encodeCursor(new Date(last.natum), last.id) : undefined
    return { entries, ...(nextCursor ? { nextCursor } : {}) }
  }

  // `nomen` / `descriptio` / `modusId` ride the same generic $set path as every other
  // scalar field — `toDoc` spreads the patch verbatim, so no per-field projection exists
  // (or is needed) here; the store is a straight document mirror of `Collectio`.
  async update(id: string, patch: Partial<Pick<Collectio, 'status' | 'acta' | 'completae' | 'fractae' | 'pendentes' | 'reiectae' | 'impetusTotal' | 'completum' | 'nomen' | 'descriptio' | 'modusId' | 'numerus' | 'tractus' | 'provenanceHash' | 'pausatum'>>): Promise<Collectio> {
    // `pausatum: undefined` means "clear the pause" (resume) — $unset it rather
    // than $set-ing an undefined value (which Mongo would otherwise reject/drop).
    const { pausatum, ...rest } = patch
    const update: Record<string, unknown> = {}
    const setDoc = toDoc(rest)
    if (Object.keys(setDoc).length) update.$set = setDoc
    if ('pausatum' in patch) {
      if (pausatum === undefined) update.$unset = { pausatum: '' }
      else update.$set = { ...(update.$set as Record<string, unknown> | undefined), pausatum }
    }
    const result = await this.col.findOneAndUpdate(
      { id },
      update,
      { returnDocument: 'after' }
    )
    if (!result) throw new Error(`Collectio not found: ${id}`)
    return fromDoc(result as Record<string, unknown>)
  }
}
