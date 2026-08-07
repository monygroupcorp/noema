// =============================================================================
// legacyToIntella — pure transform from legacy `loraModels` doc → spec-v2 Intella
// =============================================================================
//
// This is the chunk migration's keeper deliverable: a tested, pure function that
// turns one legacy LoRA record into one crystal Intella record matching the v2
// spec at docs/spec/intella-schema.md.
//
// The output type `IntellaV2` is declared LOCAL to this migration directory —
// it does NOT replace `src/types/intelligendi.ts` (which is still the v1 sparse
// shape). The runtime crystal isn't able to read these records correctly yet;
// they live in `noema_fake` so we can eyeball the migration's output, learn
// what the spec gets wrong, and revise before doing the type refactor proper.
//
// Once the spec settles, this directory's `IntellaV2` type promotes to
// `src/types/intelligendi.ts` and the migration becomes idempotent + safe to
// re-run against the production collection.

import { classifyModelLicense, type CommercialVerdict, familiaFromBaseIntellaId, isKnownBaseIntellaId } from '../../crystal/modelLicense.js'

// ─ Types (mirroring docs/spec/intella-schema.md §3) ────────────────────────

export type Genus = 'lora' | 'model' | 'vae' | 'controlnet' | 'embedding' | 'upscaler' | 'audio' | 'video' | 'llm'

export type Access =
  | { kind: 'public' }
  | { kind: 'unlisted' }
  | { kind: 'private'; ownerAnimaId: string; sharedWith?: string[] }
  | { kind: 'group'; groupId: string }
  | { kind: 'hidden' }

export interface OwnershipTransfer {
  fromAnimaId?: string
  toAnimaId: string
  transferredAt: Date
  kind: 'transfer' | 'sale'
  saleValor?: bigint
  saleSignumId?: string
}

export interface IntellaBaseV2 {
  id: string
  nomen: string
  versio: string
  contentHash?: string
  paramCount?: number

  // Authorship + ownership (single rail; see spec §5)
  authorAnimaIds: string[]
  ownerAnimaId?: string
  ownershipHistory?: OwnershipTransfer[]
  transferable: boolean
  importerAnimaId?: string
  parentIntellaId?: string
  parentRoyaltyShare?: number
  corpusId?: string
  canonica: boolean

  // Compatibility (LoRA base-flow key; absent when the base is unknown or has no base flow)
  familia?: string

  // Provenance
  importedFrom?: {
    source: 'huggingface' | 'civitai' | 'r2' | 'user-upload' | 'platform-training' | 'community'
    originalAuthor?: string
    sourceUri?: string
    importedAt: Date
  }

  // Access (single axis)
  access: Access

  // Artifacts
  sources: Array<{ provenance: string; uri: string }>
  dest: string
  artifacts?: Array<{ role: string; uri: string; dest: string; sizeGb?: number }>
  sizeGb: number

  // Display
  description?: string
  tags?: Array<{ tag: string; source: 'user' | 'admin'; score?: number }>
  category?: string
  thumbnailUri?: string
  previewUris?: string[]
  examplePrompts?: string[]

  // Quality
  usageCount?: number
  rating?: { avg: number; count: number }
  lastUsed?: Date

  // Moderation (required by spec)
  contentRating: 'untriaged' | 'sfw' | 'suggestive' | 'explicit'
  blocked: boolean
  reviewState?: 'pending' | 'approved' | 'rejected'
  moderationNotes?: string

  // License. `license` is a free-form id reconciled with the runtime `Intella.license` (string) and
  // the `modelLicense.ts` register — the old CC-only enum couldn't express 'openrail-m' /
  // 'flux-1-dev-nc' / 'krea-community' etc., so it's widened to string. `commercialUse` is the
  // public-catalog verdict the go-public gate reads (fail-closed; see modelLicense.ts).
  license?: string
  commercialUse?: CommercialVerdict
  usageTerms?: string

  // Lifecycle
  natum: Date
  mutatum?: Date
  deprecatedAt?: Date
  supersedesIntellaId?: string
  supersededByIntellaId?: string

  // Legacy preservation
  legacyMonetization?: unknown
  legacy?: Record<string, unknown>
}

export interface LoraParamsV2 {
  triggerWords: string[]
  slug: string
  defaultWeight: number
  recommendedWeightRange?: [number, number]
  baseIntellaId: string
}

export interface CheckpointParamsV2 { architectura: string }

export type IntellaV2 =
  | (IntellaBaseV2 & { genus: 'lora';  params: LoraParamsV2 })
  | (IntellaBaseV2 & { genus: 'model'; params: CheckpointParamsV2 })
// (other genuses omitted — the legacy collection is LoRA-only; we extend as fixtures appear)

// ─ Legacy doc shape (from src/core/services/db/loRAModelDb.js §1 docstring) ─

export interface LegacyLoraDoc {
  _id: { toString(): string } | string
  slug?: string
  name?: string
  triggerWords?: string[]
  cognates?: Array<{ word: string; replaceWith?: string }>
  replaceWith?: string
  defaultWeight?: number
  modelType?: string
  strength?: string
  checkpoint?: string
  trainedFrom?: { trainingId?: string; captionSetId?: string; tool?: string; steps?: number }
  tags?: Array<{ tag: string; source: 'user' | 'admin' | 'auto'; score?: number }>
  description?: string
  examplePrompts?: string[]
  previewImages?: string[]
  usageCount?: number
  rating?: { avg: number; count: number }
  visibility?: 'public' | 'private' | 'unlisted'
  permissionType?: 'public' | 'private' | 'licensed'
  accessControl?: Array<{ toString(): string } | string>
  createdBy?: { toString(): string } | string
  ownedBy?: { toString(): string } | string
  collectionId?: { toString(): string } | string
  monetization?: unknown
  importedFrom?: {
    source?: string
    url?: string
    originalAuthor?: string
    importedAt?: Date | string
  }
  publishedTo?: { huggingfaceRepo?: string; uploadedAt?: Date | string }
  moderation?: {
    flagged?: boolean
    issues?: string[]
    reviewedBy?: string
    reviewedAt?: Date | string
  }
  createdAt?: Date | string
  updatedAt?: Date | string
  lastUsedAt?: Date | string
}

// ─ Lookups the caller supplies ─────────────────────────────────────────────

export interface MigrationLookups {
  /** legacy `checkpoint` string (e.g. 'FLUX') → crystal base intella id (e.g. `intella.flux-base`). */
  checkpointToBaseIntellaId: Record<string, string>
  /** animaIds the platform considers "itself" — used to detect canonica. */
  platformAnimaIds: Set<string>
  /**
   * Rough per-architecture default LoRA file size (GB). Legacy records have no
   * size info; bulletin wait estimates need *something*. These are estimates
   * — the weight-migration sprint backfills real values when files land in R2.
   */
  defaultLoraSizeGbByCheckpoint?: Record<string, number>
}

// ─ Migration log (collected per-transform; surfaces collisions + drops) ────

export interface MigrationLogEntry {
  intellaId: string
  legacyId: string
  warnings: string[]
  drops: string[]   // fields silently discarded
}

// ─ The transform ───────────────────────────────────────────────────────────

export function legacyToIntella(
  doc: LegacyLoraDoc,
  lookups: MigrationLookups,
): { intella: IntellaV2; log: MigrationLogEntry } {
  const warnings: string[] = []
  const drops: string[] = []
  const id = toIdString(doc._id)

  // ─ Authorship branches by origin (spec §13) ────────────────────────────
  const createdBy = doc.createdBy ? toIdString(doc.createdBy) : undefined
  const ownedBy   = doc.ownedBy   ? toIdString(doc.ownedBy)   : undefined
  const isPlatformAnima = createdBy ? lookups.platformAnimaIds.has(createdBy) : false
  let importSource = normalizeSource(doc.importedFrom?.source, warnings)

  // Heuristic: when importedFrom.source is missing, infer 'platform-training'
  // from the presence of `trainedFrom` (training-pipeline metadata) or
  // `publishedTo` (we published this model out, implying we trained it first).
  // Rescues author attribution for records that predate the importedFrom field.
  if (!importSource && (doc.trainedFrom || doc.publishedTo)) {
    importSource = 'platform-training'
    warnings.push('importedFrom.source missing — inferred platform-training from trainedFrom/publishedTo')
  }

  let authorAnimaIds: string[]
  let ownerAnimaId: string | undefined
  let importerAnimaId: string | undefined
  let canonica = false

  // Orphan detection — no createdBy AND no provenance whatsoever. These are
  // "original stock" records the catalogue has carried forever with no
  // attribution. Per user: treat them as platform-canonical; royalty routes
  // via PLATFORM_ANIMA_ID at runtime (env set to the desired recipient anima).
  const isOrphan = !createdBy && !importSource && !doc.trainedFrom && !doc.publishedTo

  if (isPlatformAnima) {
    // Platform-canonical: royalty routes to PLATFORM_ANIMA_ID; explicit fields ignored.
    canonica = true
    authorAnimaIds = []
    ownerAnimaId = undefined
    importerAnimaId = undefined
  } else if (isOrphan) {
    // Original-stock orphan with no createdBy + no provenance: canonical platform stock.
    canonica = true
    authorAnimaIds = []
    ownerAnimaId = undefined
    importerAnimaId = undefined
    warnings.push('orphan record (no createdBy + no provenance) — marked canonica: platform royalty applies')
  } else if (importSource === 'platform-training') {
    // User trained on the platform → they're the author.
    authorAnimaIds = createdBy ? [createdBy] : []
    ownerAnimaId   = ownedBy ?? createdBy
    importerAnimaId = undefined
  } else {
    // Imported (HF/Civitai/etc.) OR origin unknown after heuristic — authorless.
    authorAnimaIds = []
    ownerAnimaId   = ownedBy ?? createdBy
    importerAnimaId = createdBy
    if (!importSource) warnings.push('importedFrom.source missing AND no trainedFrom/publishedTo — treating as authorless import')
  }

  // ─ Access consolidation (spec §13 collision table) ─────────────────────
  const access = consolidateAccess(doc, ownerAnimaId, warnings)

  // ─ Genus + params ─────────────────────────────────────────────────────
  // The legacy collection is LoRA-only. Triggerwords + slug + checkpoint required.
  if (!doc.slug) warnings.push('legacy slug missing — defaulting to id-derived slug')
  const slug = doc.slug ?? `legacy-${id.slice(0, 8)}`

  const triggerWords = mergeTriggerWords(doc.triggerWords, doc.cognates, warnings)
  if (doc.replaceWith) drops.push('replaceWith (redundant with cognates)')

  const baseIntellaId = lookups.checkpointToBaseIntellaId[(doc.checkpoint ?? '').trim().toUpperCase()]
  if (!baseIntellaId) warnings.push(`checkpoint '${doc.checkpoint}' not in lookup table — baseIntellaId will be 'intella.unknown-base'`)
  const resolvedBaseIntellaId = baseIntellaId ?? 'intella.unknown-base'

  // `familia` mirrors the repair mapping's posture: unmapped bases are reported, never guessed.
  let familia: string | null = null
  if (!isKnownBaseIntellaId(resolvedBaseIntellaId)) {
    warnings.push(`baseIntellaId '${resolvedBaseIntellaId}' not in FAMILIA_BY_BASE_INTELLA_ID — familia left unset`)
  } else {
    familia = familiaFromBaseIntellaId(resolvedBaseIntellaId)
  }

  const params: LoraParamsV2 = {
    triggerWords,
    slug,
    defaultWeight: doc.defaultWeight ?? 1.0,
    baseIntellaId: resolvedBaseIntellaId,
  }

  if (doc.modelType) drops.push(`modelType=${doc.modelType}`)
  if (doc.strength)  drops.push(`strength=${doc.strength}`)

  // ─ License (go-public gate) ────────────────────────────────────────────
  // Legacy records carry no license field; derive one from the trained-on base (`checkpoint`,
  // e.g. 'FLUX'/'SDXL'/'SD1.5') via the shared classifier — a FLUX.1-dev-trained LoRA is a
  // Non-Commercial derivative and can't be laundered clean by re-hosting. Fail-closed: a bare
  // 'FLUX' (schnell vs dev indeterminable) → 'unknown', so it can't auto-promote until an admin
  // clears it. `commercialUse` is what the public-catalog gate reads.
  const { license, commercialUse } = classifyModelLicense({
    provenance: doc.checkpoint ? { base: doc.checkpoint } : undefined,
    nomen: doc.name,
  })
  if (commercialUse === 'unknown') {
    warnings.push(`license indeterminable from checkpoint='${doc.checkpoint ?? '(none)'}' — commercialUse='unknown' (fail-closed; admin must clear before public promotion)`)
  }

  // ─ Moderation ─────────────────────────────────────────────────────────
  const moderation = doc.moderation
  const blocked = !!moderation?.flagged
  const reviewState: IntellaBaseV2['reviewState'] = moderation?.reviewedAt
    ? (moderation.flagged ? 'rejected' : 'approved')
    : (moderation ? 'pending' : undefined)
  const contentRating: IntellaBaseV2['contentRating'] = canonica
    ? 'sfw'
    : (moderation?.reviewedAt && !moderation.flagged ? 'sfw' : 'untriaged')
  const moderationNotes = moderation?.issues?.length ? moderation.issues.join('; ') : undefined

  // ─ Provenance ─────────────────────────────────────────────────────────
  const importedFrom = doc.importedFrom ? {
    source: importSource ?? 'community' as const,
    ...(doc.importedFrom.originalAuthor ? { originalAuthor: doc.importedFrom.originalAuthor } : {}),
    ...(doc.importedFrom.url ? { sourceUri: doc.importedFrom.url } : {}),
    importedAt: toDate(doc.importedFrom.importedAt) ?? toDate(doc.createdAt) ?? new Date(0),
  } : undefined

  // ─ Lifecycle dates ───────────────────────────────────────────────────
  const natum   = toDate(doc.createdAt) ?? new Date()
  const mutatum = toDate(doc.updatedAt)
  const lastUsed = toDate(doc.lastUsedAt)

  // ─ Tags (drop 'auto' source per spec §8) ─────────────────────────────
  const tags = doc.tags
    ?.filter(t => t.tag)
    .map(t => ({
      tag: t.tag,
      source: (t.source === 'auto' ? 'admin' : t.source) as 'user' | 'admin',
      ...(t.score !== undefined ? { score: t.score } : {}),
    }))

  // ─ Legacy preservation ───────────────────────────────────────────────
  const legacyPreserved: Record<string, unknown> = {}
  if (doc.collectionId)  legacyPreserved.collectionId = toIdString(doc.collectionId)
  if (doc.publishedTo)   legacyPreserved.publishedTo = doc.publishedTo
  if (doc.trainedFrom)   legacyPreserved.trainedFrom = doc.trainedFrom

  // ─ Synthetic initial ownership entry ─────────────────────────────────
  const ownershipHistory: OwnershipTransfer[] | undefined = ownerAnimaId
    ? [{ toAnimaId: ownerAnimaId, transferredAt: natum, kind: 'transfer' }]
    : undefined

  // ─ Sources (legacy has no explicit sources[] for the file itself) ────
  //   Best-effort: pull from publishedTo.huggingfaceRepo or importedFrom.url.
  //   Migration leaves sources[] as a single placeholder when unknown — the
  //   real URLs will fill in via the weight-migration project later.
  const primarySourceUri =
    doc.importedFrom?.url ??
    (doc.publishedTo?.huggingfaceRepo
      ? `https://huggingface.co/${doc.publishedTo.huggingfaceRepo}/resolve/main/${slug}.safetensors`
      : undefined)
  const sources: Array<{ provenance: string; uri: string }> = primarySourceUri
    ? [{ provenance: importSource ?? 'unknown', uri: primarySourceUri }]
    : []
  if (sources.length === 0) warnings.push('no source URI resolvable from legacy fields — sources[] is empty')

  const dest = defaultDestFor('lora', slug)

  // ─ Rough size estimate by architecture (real bytes land in weight migration)
  const checkpointKey = (doc.checkpoint ?? '').trim().toUpperCase()
  const estimatedSizeGb = lookups.defaultLoraSizeGbByCheckpoint?.[checkpointKey] ?? 0.2

  // ─ Build the Intella ─────────────────────────────────────────────────
  const intella: IntellaV2 = {
    id,
    nomen: doc.name ?? slug,
    versio: '1.0.0',
    paramCount: undefined,

    authorAnimaIds,
    ownerAnimaId,
    ownershipHistory,
    transferable: !canonica,
    importerAnimaId,
    canonica,

    importedFrom,

    access,

    sources,
    dest,
    sizeGb: estimatedSizeGb,   // rough per-architecture estimate; weight-migration backfills real bytes

    description: doc.description,
    tags,
    previewUris: doc.previewImages,
    examplePrompts: doc.examplePrompts,

    usageCount: doc.usageCount,
    rating: doc.rating,
    lastUsed,

    contentRating,
    blocked,
    reviewState,
    moderationNotes,

    license,
    commercialUse,

    natum,
    mutatum,

    legacyMonetization: doc.monetization,
    ...(Object.keys(legacyPreserved).length > 0 ? { legacy: legacyPreserved } : {}),
    ...(familia !== null ? { familia } : {}),

    genus: 'lora',
    params,
  }

  return {
    intella,
    log: { intellaId: id, legacyId: id, warnings, drops },
  }
}

// ─ Helpers ────────────────────────────────────────────────────────────────

function toIdString(id: { toString(): string } | string): string {
  return typeof id === 'string' ? id : id.toString()
}
function toDate(v: Date | string | undefined): Date | undefined {
  if (!v) return undefined
  if (v instanceof Date) return v
  const d = new Date(v)
  return isNaN(d.getTime()) ? undefined : d
}

function normalizeSource(s: string | undefined, warnings: string[]): IntellaBaseV2['importedFrom'] extends infer T
  ? T extends { source: infer S } ? S : never : never | undefined {
  if (!s) return undefined as never
  const lower = s.toLowerCase()
  const known = ['huggingface', 'civitai', 'r2', 'user-upload', 'platform-training', 'community']
  if (known.includes(lower)) return lower as never
  warnings.push(`importedFrom.source '${s}' not recognized — preserving as 'community'`)
  return 'community' as never
}

function mergeTriggerWords(
  triggerWords: string[] | undefined,
  cognates: Array<{ word: string; replaceWith?: string }> | undefined,
  warnings: string[],
): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const t of triggerWords ?? []) {
    const k = t.toLowerCase().trim()
    if (k && !seen.has(k)) { seen.add(k); out.push(k) }
  }
  for (const c of cognates ?? []) {
    const k = c.word?.toLowerCase().trim()
    if (k && !seen.has(k)) { seen.add(k); out.push(k) }
    if (c.replaceWith && !triggerWords?.some(t => t.toLowerCase() === c.replaceWith?.toLowerCase())) {
      warnings.push(`cognate replaceWith='${c.replaceWith}' isn't in triggerWords; preserved as alias`)
      const rk = c.replaceWith.toLowerCase().trim()
      if (rk && !seen.has(rk)) { seen.add(rk); out.push(rk) }
    }
  }
  return out
}

function consolidateAccess(
  doc: LegacyLoraDoc,
  ownerAnimaId: string | undefined,
  warnings: string[],
): Access {
  const v = doc.visibility
  const p = doc.permissionType
  const acl = (doc.accessControl ?? []).map(toIdString)

  // The collision table from spec §13. permissionType wins over visibility on disagreement.
  if (p === 'private') {
    if (v && v !== 'private') warnings.push(`visibility=${v} but permissionType=private → private wins`)
    return { kind: 'private', ownerAnimaId: ownerAnimaId ?? '', sharedWith: acl }
  }
  if (p === 'licensed') {
    return { kind: 'private', ownerAnimaId: ownerAnimaId ?? '', sharedWith: acl }
  }
  // permissionType public OR absent — visibility decides
  if (v === 'private')  return { kind: 'private', ownerAnimaId: ownerAnimaId ?? '', sharedWith: acl }
  if (v === 'unlisted') return { kind: 'unlisted' }
  return { kind: 'public' }
}

function defaultDestFor(genus: Genus, slug: string): string {
  switch (genus) {
    case 'lora':       return `models/loras/${slug}.safetensors`
    case 'model':      return `models/checkpoints/${slug}.safetensors`
    case 'vae':        return `models/vae/${slug}.safetensors`
    case 'controlnet': return `models/controlnet/${slug}.safetensors`
    case 'embedding':  return `models/embeddings/${slug}.pt`
    case 'upscaler':   return `models/upscale_models/${slug}.pth`
    case 'audio':      return `models/audio/${slug}`
    case 'video':      return `models/video/${slug}`
    case 'llm':        return `models/llm/${slug}`
  }
}
