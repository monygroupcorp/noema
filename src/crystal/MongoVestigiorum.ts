import { Collection } from 'mongodb'
import { v4 as uuidv4 } from 'uuid'
import type {
  Vestigium,
  Vestigia,
  Vestigiorum,
  VestigiumQuery,
  VestigiumResult,
  ImpressioKind,
} from '../types/vestigium.js'

type AuctorKey = { animaId: string } | { arcanumHash: string }

function raterToken(key: AuctorKey): string {
  return 'animaId' in key ? `a:${key.animaId}` : `h:${key.arcanumHash}`
}

function matchesKey(a: AuctorKey, b: AuctorKey): boolean {
  if ('animaId' in a && 'animaId' in b) return a.animaId === b.animaId
  if ('arcanumHash' in a && 'arcanumHash' in b) return a.arcanumHash === b.arcanumHash
  return false
}

function auctorKeyQuery(key: AuctorKey): Record<string, unknown> {
  if ('animaId' in key) return { 'auctorKey.animaId': key.animaId }
  return { 'auctorKey.arcanumHash': key.arcanumHash }
}

function fromDoc(doc: Record<string, unknown>): Vestigium {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { _id, _raters, auctorKey, impressio, ...rest } = doc as Record<string, unknown> & {
    _id: unknown; _raters: unknown
    auctorKey: { animaId?: string; arcanumHash?: string }
    impressio: Record<string, unknown>
  }

  // Reconstruct the union type from the flat stored form
  const key: AuctorKey = auctorKey.animaId
    ? { animaId: auctorKey.animaId }
    : { arcanumHash: auctorKey.arcanumHash! }

  // Strip auctorImpressio if null/undefined to keep the interface clean
  const { auctorImpressio, ...counts } = impressio as { auctorImpressio?: string; amor: number; risus: number; maeror: number }

  return {
    ...rest,
    auctorKey: key,
    impressio: {
      amor: counts.amor,
      risus: counts.risus,
      maeror: counts.maeror,
      ...(auctorImpressio != null ? { auctorImpressio: auctorImpressio as ImpressioKind } : {}),
    },
  } as Vestigium
}

function cosine(a: number[], b: number[]): number {
  let dot = 0, normA = 0, normB = 0
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i]; normA += a[i] * a[i]; normB += b[i] * b[i]
  }
  if (normA === 0 || normB === 0) return 0
  return dot / (Math.sqrt(normA) * Math.sqrt(normB))
}

export class MongoVestigiorum implements Vestigiorum {
  constructor(
    private col: Collection,
    private embed?: (text: string) => Promise<number[]>
  ) {}

  async create(
    input: Omit<Vestigium, 'id' | 'natum' | 'mutatum' | 'embedding' | 'impressio'>
  ): Promise<Vestigium> {
    const now = new Date()
    const id = uuidv4()
    const impressio = { amor: 0, risus: 0, maeror: 0 }
    // Store auctorKey as a flat optional-field object for queryability
    const auctorKeyDoc = 'animaId' in input.auctorKey
      ? { animaId: input.auctorKey.animaId }
      : { arcanumHash: input.auctorKey.arcanumHash }

    const doc = { ...input, id, auctorKey: auctorKeyDoc, impressio, _raters: [], natum: now, mutatum: now }
    await this.col.insertOne(doc)

    return { ...input, id, impressio, natum: now, mutatum: now }
  }

  async index(id: string): Promise<void> {
    if (!this.embed) throw new Error('No embed function configured')
    const v = await this.findById(id)
    if (!v) throw new Error(`Vestigium '${id}' not found`)
    const embedding = await this.embed(`${v.promptum} ${v.summarium}`)
    await this.col.updateOne({ id }, { $set: { embedding } })
  }

  async search(query: VestigiumQuery): Promise<VestigiumResult[]> {
    if (!this.embed) throw new Error('No embed function configured')

    const {
      quaerendum,
      auctorKey,
      visibilitas,
      auctorImpressio,
      modusId,
      genus,
      limit = 20,
      minSimilaritas = 0.7,
    } = query

    const allowedVis: string[] = visibilitas ?? (auctorKey ? ['privata', 'communis', 'publica'] : ['publica'])

    const filter: Record<string, unknown> = { visibilitas: { $in: allowedVis }, embedding: { $exists: true } }
    if (auctorKey) Object.assign(filter, auctorKeyQuery(auctorKey))
    if (modusId) filter.modusId = modusId
    if (genus) filter.genus = genus
    if (auctorImpressio) filter['impressio.auctorImpressio'] = { $in: auctorImpressio }

    const docs = await this.col.find(filter).toArray()
    const queryVec = await this.embed(quaerendum)

    const results: VestigiumResult[] = []
    for (const doc of docs) {
      const emb = doc.embedding as number[] | undefined
      if (!emb) continue
      const similaritas = cosine(queryVec, emb)
      if (similaritas < minSimilaritas) continue
      results.push({ vestigium: fromDoc(doc as Record<string, unknown>), similaritas })
    }

    return results.sort((a, b) => b.similaritas - a.similaritas).slice(0, limit)
  }

  async findById(id: string): Promise<Vestigium | null> {
    const doc = await this.col.findOne({ id })
    return doc ? fromDoc(doc as Record<string, unknown>) : null
  }

  async forIdentity(auctorKey: AuctorKey, limit = 100): Promise<Vestigia> {
    const docs = await this.col
      .find(auctorKeyQuery(auctorKey))
      .sort({ natum: -1 })
      .limit(limit)
      .toArray()
    return docs.map(d => fromDoc(d as Record<string, unknown>))
  }

  async setAuctorImpressio(
    id: string,
    auctorKey: AuctorKey,
    impressio: ImpressioKind | null
  ): Promise<Vestigium> {
    const v = await this.findById(id)
    if (!v) throw new Error(`Vestigium '${id}' not found`)
    if (!matchesKey(v.auctorKey, auctorKey)) {
      throw new Error(`auctorKey does not match — only the holder of the matching auctorKey may set their impression`)
    }
    const set: Record<string, unknown> = { mutatum: new Date() }
    if (impressio === null) {
      await this.col.updateOne({ id }, { $set: set, $unset: { 'impressio.auctorImpressio': '' } })
    } else {
      set['impressio.auctorImpressio'] = impressio
      await this.col.updateOne({ id }, { $set: set })
    }
    return (await this.findById(id))!
  }

  async rate(id: string, raterKey: AuctorKey, impressio: ImpressioKind): Promise<void> {
    const v = await this.findById(id)
    if (!v) throw new Error(`Vestigium '${id}' not found`)
    if (matchesKey(v.auctorKey, raterKey)) {
      throw new Error(`Author must use setAuctorImpressio() to rate their own output`)
    }
    const token = raterToken(raterKey)
    const result = await this.col.updateOne(
      { id, _raters: { $ne: token } },
      {
        $inc: { [`impressio.${impressio}`]: 1 },
        $addToSet: { _raters: token },
        $set: { mutatum: new Date() },
      }
    )
    if (result.matchedCount === 0) {
      throw new Error(`double-rating rejected — rater has already rated this vestigium`)
    }
  }

  async update(
    id: string,
    patch: Partial<Pick<Vestigium, 'visibilitas' | 'signacula' | 'mutatum'>>
  ): Promise<Vestigium> {
    const result = await this.col.findOneAndUpdate(
      { id },
      { $set: { ...patch, mutatum: new Date() } },
      { returnDocument: 'after' }
    )
    if (!result) throw new Error(`Vestigium '${id}' not found`)
    return fromDoc(result as Record<string, unknown>)
  }
}
