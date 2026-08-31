import { Collection } from 'mongodb'
import { v4 as uuidv4 } from 'uuid'
import type { Collectio, Collectiones, CollectioStatus, Collectionum } from '../types/collectio.js'

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
