import { randomUUID } from 'node:crypto'
import type {
  Vestigium,
  Vestigia,
  Vestigiorum,
  VestigiumQuery,
  VestigiumResult,
  ImpressioKind,
} from '../types/vestigium.js'

type AuctorKey = { animaId: string } | { commitment: string }

function matchesKey(a: AuctorKey, b: AuctorKey): boolean {
  if ('animaId' in a && 'animaId' in b) return a.animaId === b.animaId
  if ('commitment' in a && 'commitment' in b) return a.commitment === b.commitment
  return false
}

function raterToken(key: AuctorKey): string {
  return 'animaId' in key ? `animaId:${key.animaId}` : `commitment:${key.commitment}`
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
  private readonly raters = new Map<string, Set<string>>()
  private seq = 0
  private readonly insertionSeq = new Map<string, number>()

  constructor(
    private readonly embed?: (text: string) => Promise<number[]>,
    private readonly embedImage?: (imageUrl: string) => Promise<number[]>,
  ) {}

  async create(
    vestigium: Omit<Vestigium, 'id' | 'natum' | 'mutatum' | 'embeddingPromptum' | 'embeddingImago' | 'embeddingIntella' | 'impressio'>
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

  async indexPromptum(id: string): Promise<void> {
    if (!this.embed) throw new Error('No embed function configured')
    const v = this.store.get(id)
    if (!v) throw new Error(`Vestigium '${id}' not found`)
    const text = v.negativum ? `${v.promptum} ${v.negativum}` : v.promptum
    const embeddingPromptum = await this.embed(text)
    this.store.set(id, { ...v, embeddingPromptum })
  }

  async indexImago(id: string): Promise<void> {
    if (!this.embedImage) throw new Error('No embedImage function configured')
    const v = this.store.get(id)
    if (!v) throw new Error(`Vestigium '${id}' not found`)
    if (!v.imagoUrl) return
    const embeddingImago = await this.embedImage(v.imagoUrl)
    this.store.set(id, { ...v, embeddingImago })
  }

  async indexIntella(id: string): Promise<void> {
    if (!this.embed) throw new Error('No embed function configured')
    const v = this.store.get(id)
    if (!v) throw new Error(`Vestigium '${id}' not found`)
    if (!v.intellaDescription) return
    const embeddingIntella = await this.embed(v.intellaDescription)
    this.store.set(id, { ...v, embeddingIntella })
  }

  async search(query: VestigiumQuery): Promise<VestigiumResult[]> {
    if (!this.embed) throw new Error('No embed function configured')

    const {
      quaerendum,
      per = 'promptum',
      auctorKey,
      visibilitas,
      auctorImpressio,
      modusId,
      genus,
      intellaIds,
      limit = 20,
      minSimilaritas = 0.7,
    } = query

    const allowedVisibility: string[] = visibilitas ?? (auctorKey ? ['privata', 'communis', 'publica'] : ['publica'])
    const queryEmbedding = await this.embed(quaerendum)

    const embeddingKey = per === 'imago' ? 'embeddingImago'
      : per === 'intella' ? 'embeddingIntella'
      : 'embeddingPromptum'

    const results: VestigiumResult[] = []

    for (const v of this.store.values()) {
      const emb = v[embeddingKey] as number[] | undefined
      if (!emb) continue
      if (!allowedVisibility.includes(v.visibilitas)) continue
      if (auctorKey && !matchesKey(v.auctorKey, auctorKey)) continue
      if (auctorImpressio && !auctorImpressio.includes(v.impressio.auctorImpressio as ImpressioKind)) continue
      if (modusId && v.modusId !== modusId) continue
      if (genus && v.genus !== genus) continue
      if (intellaIds && !intellaIds.some(id => v.intellaIds?.includes(id))) continue

      const similaritas = cosine(queryEmbedding, emb)
      if (similaritas < minSimilaritas) continue

      results.push({ vestigium: v, similaritas })
    }

    return results.sort((a, b) => b.similaritas - a.similaritas).slice(0, limit)
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
      impressio: { ...v.impressio, auctorImpressio: impressio ?? undefined },
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
    if (raterSet.has(token)) throw new Error(`Rater has already rated this vestigium — double-rating rejected`)
    raterSet.add(token)
    this.raters.set(id, raterSet)
    this.store.set(id, {
      ...v,
      impressio: { ...v.impressio, [impressio]: v.impressio[impressio] + 1 },
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

  async delete(id: string): Promise<void> {
    this.store.delete(id)
    this.raters.delete(id)
    this.insertionSeq.delete(id)
  }
}
