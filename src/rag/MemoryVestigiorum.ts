import { randomUUID } from 'node:crypto'
import type {
  Vestigium,
  Vestigia,
  Vestigiorum,
  VestigiumQuery,
  VestigiumResult,
  ImpressioKind,
} from '../types/vestigium.js'

type AuctorKey = { animaId: string } | { arcanumHash: string }

function matchesKey(a: AuctorKey, b: AuctorKey): boolean {
  if ('animaId' in a && 'animaId' in b) return a.animaId === b.animaId
  if ('arcanumHash' in a && 'arcanumHash' in b) return a.arcanumHash === b.arcanumHash
  return false
}

function raterToken(key: AuctorKey): string {
  return 'animaId' in key ? `animaId:${key.animaId}` : `arcanumHash:${key.arcanumHash}`
}

function cosine(a: number[], b: number[]): number {
  let dot = 0, normA = 0, normB = 0
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i]
    normA += a[i] * a[i]
    normB += b[i] * b[i]
  }
  if (normA === 0 || normB === 0) return 0
  return dot / (Math.sqrt(normA) * Math.sqrt(normB))
}

export class MemoryVestigiorum implements Vestigiorum {
  private readonly store = new Map<string, Vestigium>()
  // vestigiumId → Set<raterToken> — tracks who has rated to prevent double-rating
  private readonly raters = new Map<string, Set<string>>()
  // monotonic counter for stable ordering when natum values tie (same millisecond)
  private seq = 0
  private readonly insertionSeq = new Map<string, number>()

  constructor(private readonly embed?: (text: string) => Promise<number[]>) {}

  async create(
    vestigium: Omit<Vestigium, 'id' | 'natum' | 'mutatum' | 'embedding' | 'impressio'>
  ): Promise<Vestigium> {
    const now = new Date()
    const record: Vestigium = {
      ...vestigium,
      id: randomUUID(),
      impressio: { amor: 0, risus: 0, maeror: 0 },
      natum: now,
      mutatum: now,
    }
    this.store.set(record.id, record)
    this.insertionSeq.set(record.id, this.seq++)
    return record
  }

  async index(id: string): Promise<void> {
    if (!this.embed) {
      throw new Error('No embed function configured — pass one to the MemoryVestigiorum constructor')
    }
    const v = this.store.get(id)
    if (!v) throw new Error(`Vestigium '${id}' not found`)
    const text = `${v.promptum} ${v.summarium}`
    const embedding = await this.embed(text)
    this.store.set(id, { ...v, embedding })
  }

  async search(query: VestigiumQuery): Promise<VestigiumResult[]> {
    if (!this.embed) {
      throw new Error('No embed function configured — pass one to the MemoryVestigiorum constructor')
    }

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

    // Default visibility: all if scoped to identity, public-only if open search
    const allowedVisibility: string[] = visibilitas ?? (auctorKey ? ['privata', 'communis', 'publica'] : ['publica'])

    const queryEmbedding = await this.embed(quaerendum)

    const results: VestigiumResult[] = []

    for (const v of this.store.values()) {
      if (!v.embedding) continue
      if (!allowedVisibility.includes(v.visibilitas)) continue
      if (auctorKey && !matchesKey(v.auctorKey, auctorKey)) continue
      if (auctorImpressio && !auctorImpressio.includes(v.impressio.auctorImpressio as ImpressioKind)) continue
      if (modusId && v.modusId !== modusId) continue
      if (genus && v.genus !== genus) continue

      const similaritas = cosine(queryEmbedding, v.embedding)
      if (similaritas < minSimilaritas) continue

      results.push({ vestigium: v, similaritas })
    }

    return results
      .sort((a, b) => b.similaritas - a.similaritas)
      .slice(0, limit)
  }

  async findById(id: string): Promise<Vestigium | null> {
    return this.store.get(id) ?? null
  }

  async forIdentity(auctorKey: AuctorKey, limit = 100): Promise<Vestigia> {
    return Array.from(this.store.values())
      .filter(v => matchesKey(v.auctorKey, auctorKey))
      .sort((a, b) => {
        const t = b.natum.getTime() - a.natum.getTime()
        if (t !== 0) return t
        return (this.insertionSeq.get(b.id) ?? 0) - (this.insertionSeq.get(a.id) ?? 0)
      })
      .slice(0, limit)
  }

  async setAuctorImpressio(
    id: string,
    auctorKey: AuctorKey,
    impressio: ImpressioKind | null
  ): Promise<Vestigium> {
    const v = this.store.get(id)
    if (!v) throw new Error(`Vestigium '${id}' not found`)
    if (!matchesKey(v.auctorKey, auctorKey)) {
      throw new Error(`auctorKey does not match — only the holder of the matching auctorKey may set their impression`)
    }
    const updated: Vestigium = {
      ...v,
      impressio: {
        ...v.impressio,
        auctorImpressio: impressio ?? undefined,
      },
      mutatum: new Date(),
    }
    this.store.set(id, updated)
    return updated
  }

  async rate(id: string, raterKey: AuctorKey, impressio: ImpressioKind): Promise<void> {
    const v = this.store.get(id)
    if (!v) throw new Error(`Vestigium '${id}' not found`)
    if (matchesKey(v.auctorKey, raterKey)) {
      throw new Error(`Author must use setAuctorImpressio() to rate their own output`)
    }
    const token = raterToken(raterKey)
    const raterSet = this.raters.get(id) ?? new Set<string>()
    if (raterSet.has(token)) {
      throw new Error(`Rater has already rated this vestigium — double-rating rejected`)
    }
    raterSet.add(token)
    this.raters.set(id, raterSet)

    this.store.set(id, {
      ...v,
      impressio: {
        ...v.impressio,
        [impressio]: v.impressio[impressio] + 1,
      },
      mutatum: new Date(),
    })
  }

  async update(
    id: string,
    patch: Partial<Pick<Vestigium, 'visibilitas' | 'signacula' | 'mutatum'>>
  ): Promise<Vestigium> {
    const v = this.store.get(id)
    if (!v) throw new Error(`Vestigium '${id}' not found`)
    const updated = { ...v, ...patch }
    this.store.set(id, updated)
    return updated
  }
}
