import { Collection, Filter, Document } from 'mongodb'
import { v4 as uuidv4 } from 'uuid'
import { captionCoverage, nextDatasetVersion } from '../types/dataset.js'
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
    images: d.media.length,
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

  private async _page(opts: DatasetListOpts): Promise<{ entries: Dataset[]; nextCursor?: string }> {
    const limit = Math.min(Math.max(Math.trunc(opts.limit ?? 20) || 20, 1), 100)
    const filter: Filter<Document> = { owner: opts.owner }

    if (opts.cursor) {
      const c = decodeCursor(opts.cursor)
      if (c) {
        filter.$or = [
          { mutatum: { $lt: c.mutatum } },
          { mutatum: c.mutatum, id: { $lt: c.id } },
        ]
      }
    }

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
      coverage: captionCoverage(c.captions, media.length),
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
      coverage: captionCoverage(captionset.captions, current.media.length),
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
    const updated: Captionset = { ...target, captions, coverage: captionCoverage(captions, current.media.length) }
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

  // The rich/thin split projects down from the SAME document — no separate
  // persisted shape, just a `.map()` at read time (mirrors CrystalApi.listFlows'
  // Modus -> FlowSummary projection).
  async listSummaries(opts: DatasetListOpts): Promise<DatasetSummaryListPage> {
    const { entries, nextCursor } = await this._page(opts)
    return { entries: entries.map(toSummary), ...(nextCursor ? { nextCursor } : {}) }
  }
}
