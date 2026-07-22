import { Collection, Filter, Document } from 'mongodb'
import { v4 as uuidv4 } from 'uuid'
import type {
  Dataset,
  DatasetListOpts,
  DatasetListPage,
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

  // The rich/thin split projects down from the SAME document — no separate
  // persisted shape, just a `.map()` at read time (mirrors CrystalApi.listFlows'
  // Modus -> FlowSummary projection).
  async listSummaries(opts: DatasetListOpts): Promise<DatasetSummaryListPage> {
    const { entries, nextCursor } = await this._page(opts)
    return { entries: entries.map(toSummary), ...(nextCursor ? { nextCursor } : {}) }
  }
}
