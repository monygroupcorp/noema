import { Collection, Filter, Document } from 'mongodb'
import { v4 as uuidv4 } from 'uuid'
import { coverageOver, liveMedia, nextDatasetVersion } from '../types/dataset.js'
import type { Fragment } from './muse/taxonomy.js'
import type {
  Captionset,
  Dataset,
  DatasetListOpts,
  DatasetListPage,
  DatasetMediaItem,
  DatasetSummary,
  DatasetSummaryListPage,
  Datasets,
} from '../types/dataset.js'

/** Opaque page cursor = the (mutatum, id) of the last row on the previous
 *  page. Base64url of `${iso}|${id}` — mirrors MongoActumIndex.listSettled's
 *  cursor, resuming the deterministic (mutatum desc, id desc) sort. */
function encodeCursor(mutatum: Date, id: string): string {
  return Buffer.from(`${mutatum.toISOString()}|${id}`, 'utf8').toString('base64url')
}
function decodeCursor(cursor: string): { mutatum: Date; id: string } | null {
  try {
    const raw = Buffer.from(cursor, 'base64url').toString('utf8')
    const sep = raw.lastIndexOf('|')
    if (sep < 0) return null
    const mutatum = new Date(raw.slice(0, sep))
    const id = raw.slice(sep + 1)
    if (Number.isNaN(mutatum.getTime()) || !id) return null
    return { mutatum, id }
  } catch {
    return null
  }
}

function toDoc(d: Partial<Dataset>): Record<string, unknown> {
  return { ...d }
}

function fromDoc(doc: Record<string, unknown>): Dataset {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { _id, ...rest } = doc as Record<string, unknown> & { _id: unknown }
  return rest as unknown as Dataset
}

function toSummary(d: Dataset): DatasetSummary {
  return {
    id: d.id,
    name: d.name,
    images: liveMedia(d.media).length,
    updatedAt: d.mutatum instanceof Date ? d.mutatum.toISOString() : String(d.mutatum),
  }
}

export class MongoDataset implements Datasets {
  constructor(private col: Collection) {}

  async create(input: Omit<Dataset, 'id' | 'natum' | 'mutatum'>): Promise<Dataset> {
    const now = new Date()
    const d: Dataset = { ...input, id: uuidv4(), natum: now, mutatum: now }
    await this.col.insertOne(toDoc(d))
    return d
  }

  async find(id: string): Promise<Dataset | null> {
    const doc = await this.col.findOne({ id })
    return doc ? fromDoc(doc as Record<string, unknown>) : null
  }

  /**
   * The id-resolving read, with the access predicate IN THE QUERY (see `Datasets.findOwned`).
   * A dataset this owner may not name does not come back, so there is no loaded record for a
   * later comparison to be skipped on.
   *
   * Two `access` shapes are admitted because the tree carries two: the flat `'public'` string
   * `Intella` stores, and the `{ kind }` single-axis Access union the schema spec settles on.
   * `Dataset` carries neither field today, so both arms match nothing — they are here so that
   * the item which gives datasets an access field is a schema change, not a re-derivation of
   * who may read what. Team sharing (`sodalitasId`) did NOT light those arms up: sharing with a
   * named fellowship and publishing to everyone are different decisions.
   *
   * And this seam deliberately does not honour the team overlay either — it is the gate a RUN's
   * dataset reference resolves through (`_assertOwnedAditus`), so widening it would let a member
   * spend on someone else's data. See `Datasets.findOwned` and ADR-0014's open question.
   */
  async findOwned(id: string, owner: string): Promise<Dataset | null> {
    const doc = await this.col.findOne({
      id,
      $or: [{ owner }, { access: 'public' }, { 'access.kind': 'public' }],
    })
    return doc ? fromDoc(doc as Record<string, unknown>) : null
  }

  private async _page(opts: DatasetListOpts): Promise<{ entries: Dataset[]; nextCursor?: string }> {
    const limit = Math.min(Math.max(Math.trunc(opts.limit ?? 20) || 20, 1), 100)

    // ACCESS, in the query. The caller's own datasets UNION the datasets shared with a team the
    // caller is a member of (`Dataset.sodalitasId` — the team overlay; `opts.sodalitasIds` is
    // resolved at the API layer from the authenticated caller, never from a request parameter).
    // With no team ids the clause is the bare `{ owner }` this list has always used, so a
    // caller in no team reads exactly what they read before.
    const teamIds = opts.sodalitasIds ?? []
    const access: Filter<Document> =
      teamIds.length > 0
        ? { $or: [{ owner: opts.owner }, { sodalitasId: { $in: teamIds } }] }
        : { owner: opts.owner }

    // The access clause and the cursor clause are BOTH `$or`s, so they are composed under
    // `$and` rather than written onto the same key — a second `filter.$or` would silently
    // replace the first, and the one it replaced is the access predicate.
    const clauses: Filter<Document>[] = [access]

    if (opts.cursor) {
      const c = decodeCursor(opts.cursor)
      if (c) {
        clauses.push({
          $or: [
            { mutatum: { $lt: c.mutatum } },
            { mutatum: c.mutatum, id: { $lt: c.id } },
          ],
        })
      }
    }

    // Archived datasets are gone from the lists. `archivum` is UNSET on restore rather than
    // set to null, so "no archivum field" is the whole of live — and a document written before
    // this field existed carries none, which is correct: it is live.
    const filter: Filter<Document> = { archivum: { $exists: false }, $and: clauses }

    const docs = await this.col
      .find(filter)
      .sort({ mutatum: -1, id: -1 })
      .limit(limit + 1)
      .toArray()

    const hasMore = docs.length > limit
    const page = hasMore ? docs.slice(0, limit) : docs
    const entries = page.map(d => fromDoc(d as Record<string, unknown>))

    let nextCursor: string | undefined
    if (hasMore) {
      const last = entries[entries.length - 1]
      if (last) nextCursor = encodeCursor(new Date(last.mutatum), last.id)
    }
    return { entries, ...(nextCursor ? { nextCursor } : {}) }
  }

  async list(opts: DatasetListOpts): Promise<DatasetListPage> {
    return this._page(opts)
  }

  /**
   * Append media to the dataset.
   *
   * `$push`/`$each`, never `$set` on `media`: the array is append-only by contract, and every
   * captionset's caption map plus every media item's fragments are keyed on
   * `DatasetMediaItem.id`. A whole-array write would carry the same risk positionally that
   * `setFragments` documents, and would do it invisibly.
   *
   * Three derived facts move with the append, in the same update:
   *   • `mutatum` — the pagination sort key (`_page` sorts `{mutatum:-1, id:-1}`).
   *   • a new `DatasetVersion` whose `count` is the media count AFTER the append; the string
   *     comes from `nextDatasetVersion`, which is shared so no double can derive it differently.
   *   • every existing captionset's `coverage`, recomputed through the same `captionCoverage`
   *     helper `addCaptionset`/`setCaption` use. Coverage is `captions present / media.length`,
   *     so an append moves the denominator: a pass reading `7/7` reads `7/9` once two items
   *     land. Leaving it would let a caption pass keep claiming a completeness it no longer has.
   */
  async addMedia(datasetId: string, items: DatasetMediaItem[]): Promise<Dataset | null> {
    const current = await this.find(datasetId)
    if (!current) return null

    const media = [...current.media, ...items]
    const captionsets = current.captionsets.map((c) => ({
      ...c,
      coverage: coverageOver(c.captions, media),
    }))
    const mutatum = new Date()
    const version = { v: nextDatasetVersion(current.versions), count: media.length, when: mutatum }
    const versions = [...current.versions, version]

    await this.col.updateOne(
      { id: datasetId },
      {
        $push: { media: { $each: items }, versions: version },
        $set: { captionsets, mutatum },
      } as Document,
    )
    return { ...current, media, captionsets, versions, mutatum }
  }

  /** Attach a captionset, replacing one already carrying the same id rather than
   *  duplicating it. `coverage` is derived from the captions supplied, never echoed.
   *  Bumps `mutatum` — it is the pagination sort key (`_page` sorts `{mutatum:-1, id:-1}`),
   *  so a write that skipped it would leave the dataset in its old list position. */
  async addCaptionset(datasetId: string, captionset: Captionset): Promise<Dataset | null> {
    const current = await this.find(datasetId)
    if (!current) return null

    const next: Captionset = {
      ...captionset,
      coverage: coverageOver(captionset.captions, current.media),
    }
    const captionsets = current.captionsets.some((c) => c.id === next.id)
      ? current.captionsets.map((c) => (c.id === next.id ? next : c))
      : [...current.captionsets, next]

    const mutatum = new Date()
    await this.col.updateOne({ id: datasetId }, { $set: { captionsets, mutatum } })
    return { ...current, captionsets, mutatum }
  }

  /** Set exactly one caption inside exactly one captionset and recompute that
   *  captionset's coverage from the captions actually present. Returns null when the
   *  dataset or the captionset is unknown — an unknown captionset is never created here. */
  async setCaption(datasetId: string, captionsetId: string, mediaId: string, caption: string): Promise<Dataset | null> {
    const current = await this.find(datasetId)
    if (!current) return null
    const target = current.captionsets.find((c) => c.id === captionsetId)
    if (!target) return null

    const captions = { ...(target.captions ?? {}), [mediaId]: caption }
    const updated: Captionset = { ...target, captions, coverage: coverageOver(captions, current.media) }
    const captionsets = current.captionsets.map((c) => (c.id === captionsetId ? updated : c))

    const mutatum = new Date()
    await this.col.updateOne({ id: datasetId }, { $set: { captionsets, mutatum } })
    return { ...current, captionsets, mutatum }
  }

  /** Replace one media item's decomposed fragments (the Muse decompose job's write).
   *  Keyed by media id, never by position: `media` is append-only, so a positional write
   *  re-binds every fragment to a different item the first time media is appended — and it
   *  does so invisibly, because every item still has fragments. An unknown dataset or media
   *  id returns null rather than creating one. Bumps `mutatum` for the same reason
   *  `addCaptionset` does — it is the pagination sort key. */
  async setFragments(datasetId: string, mediaId: string, fragments: Fragment[]): Promise<Dataset | null> {
    const current = await this.find(datasetId)
    if (!current) return null
    if (!current.media.some((m) => m.id === mediaId)) return null

    const media = current.media.map((m) => (m.id === mediaId ? { ...m, fragments } : m))
    const mutatum = new Date()
    await this.col.updateOne({ id: datasetId }, { $set: { media, mutatum } })
    return { ...current, media, mutatum }
  }

  /**
   * Archive the dataset — the delete that strands nothing.
   *
   * `archivum` is stamped and `mutatum` bumped. The lists (`list`/`listSummaries`) filter on
   * `archivum: {$exists:false}` and so stop returning it; `find` is deliberately untouched, so
   * a Muse session's mother, a session dataset behind a saved piece, and a past run's lineage
   * all keep resolving through it. Archive is not erasure.
   *
   * Idempotent: an already-archived dataset keeps its first `archivum` and is returned as it
   * stands, so a repeated call cannot re-date the archive.
   */
  async archiveDataset(datasetId: string): Promise<Dataset | null> {
    const current = await this.find(datasetId)
    if (!current) return null
    if (current.archivum) return current

    const mutatum = new Date()
    await this.col.updateOne({ id: datasetId }, { $set: { archivum: mutatum, mutatum } })
    return { ...current, archivum: mutatum, mutatum }
  }

  /** Restore an archived dataset by REMOVING `archivum` (`$unset`), not by writing a second
   *  flag beside it — one field, and "absent" is the only spelling of live. Bumps `mutatum`,
   *  which is the pagination sort key, so a restored dataset comes back at the top of the
   *  list it left. Idempotent on a dataset that is already live. */
  async restoreDataset(datasetId: string): Promise<Dataset | null> {
    const current = await this.find(datasetId)
    if (!current) return null
    if (!current.archivum) return current

    const mutatum = new Date()
    await this.col.updateOne({ id: datasetId }, { $set: { mutatum }, $unset: { archivum: '' } })
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { archivum: _gone, ...rest } = current
    return { ...rest, mutatum }
  }

  /**
   * Archive ONE media item, and recompute every captionset's coverage against what is left.
   *
   * The recomputation is the point, not a courtesy: `coverage` is STORED, derived once at
   * write time (`addMedia`/`addCaptionset`/`setCaption` all do it), never at read time. An
   * archive that moved the media set without moving the fraction would leave a pass reading
   * `7/9` against images that are no longer in the set, and the shortfall could never be
   * closed. `coverageOver` moves both sides: the archived item leaves the denominator, and
   * its caption — which stays on the record, keyed by media id — leaves the numerator.
   *
   * The item is stamped, never removed: `media` is append-only because every caption map and
   * every fragment list is keyed on `DatasetMediaItem.id`.
   */
  async archiveMedia(datasetId: string, mediaId: string): Promise<Dataset | null> {
    return this._setMediaArchivum(datasetId, mediaId, new Date())
  }

  /** Restore ONE archived media item — the item rejoins the working set and every captionset's
   *  coverage is recomputed against it, the same write `archiveMedia` performs in reverse. */
  async restoreMedia(datasetId: string, mediaId: string): Promise<Dataset | null> {
    return this._setMediaArchivum(datasetId, mediaId, null)
  }

  /** One writer for both directions, so an archive and a restore cannot disagree about what
   *  moves with the media set. `null` clears the field. Idempotent: a media item already in
   *  the requested state is returned untouched, coverage included. */
  private async _setMediaArchivum(datasetId: string, mediaId: string, archivum: Date | null): Promise<Dataset | null> {
    const current = await this.find(datasetId)
    if (!current) return null
    const target = current.media.find((m) => m.id === mediaId)
    if (!target) return null
    if (Boolean(target.archivum) === Boolean(archivum)) return current

    const media = current.media.map((m) => {
      if (m.id !== mediaId) return m
      if (archivum) return { ...m, archivum }
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { archivum: _gone, ...rest } = m
      return rest
    })
    const captionsets = current.captionsets.map((c) => ({ ...c, coverage: coverageOver(c.captions, media) }))
    const mutatum = new Date()

    await this.col.updateOne({ id: datasetId }, { $set: { media, captionsets, mutatum } })
    return { ...current, media, captionsets, mutatum }
  }

  // The rich/thin split projects down from the SAME document — no separate
  // persisted shape, just a `.map()` at read time (mirrors CrystalApi.listFlows'
  // Modus -> FlowSummary projection).
  async listSummaries(opts: DatasetListOpts): Promise<DatasetSummaryListPage> {
    const { entries, nextCursor } = await this._page(opts)
    return { entries: entries.map(toSummary), ...(nextCursor ? { nextCursor } : {}) }
  }
}
