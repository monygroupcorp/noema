// =============================================================================
// VESTIGIUM — the indexed trace of a completed output
// =============================================================================
//
// "Vestigium" = footprint, track, trace (Latin, neuter 2nd declension).
// Vestigia sunt — the footprints remain.
//
// A Vestigium is created from a completed Actum. It records the prompt used,
// the negative prompt (if any), a textual summary of the output, the models
// that were used, and up to three pre-computed embedding vectors for semantic
// search across three distinct user recall paths:
//
//   embeddingPromptum  — "I remember what I typed"
//   embeddingImago     — "I remember what it looked like"
//   embeddingIntella   — "I remember which model I used"
//
// Each embedding is populated independently and asynchronously after creation.
// A vestigium with no embeddings is valid and searchable by metadata.
//
// PRIVACY PARTITION:
//   auctorKey mirrors the `by` pattern on Inceptio and Mandatum:
//     { animaId }     → identified path
//     { commitment } → anonymous path (ZK / perfect private use)
//   Never both. Never neither.
//
// ATLAS VECTOR SEARCH:
//   Three separate Atlas Search indexes are required on noemaplane.vestigia,
//   one per embedding field. Each has filter paths for visibilitas and
//   auctorKey.animaId. See the Atlas UI for the index definitions.
// =============================================================================

export type VestigiumVisibility = 'privata' | 'communis' | 'publica'
// privata  → visible only to auctor
// communis → accessible to anyone with the link
// publica  → listed in the public gallery and searched by strangers

export type VestigiumGenus = 'text' | 'image' | 'video' | 'audio' | '3d'

export type ImpressioKind = 'amor' | 'risus' | 'maeror'
// amor   = love  (strong positive — "this is exactly what I wanted")
// risus  = laughter (playful positive — "this is funny/unexpected/delightful")
// maeror = grief (negative — "this missed the mark")

/**
 * Impressio — the reaction record attached to a Vestigium.
 */
export interface Impressio {
  /** Author's own reaction — one choice, changeable, used for personal filtering */
  auctorImpressio?: ImpressioKind
  amor: number
  risus: number
  maeror: number
}

/**
 * Vestigium — the indexed trace of a completed actum output.
 *
 * Created after ActumCompletor.complete(). One vestigium per notable output.
 * Embeddings are populated asynchronously via index*() methods.
 */
export interface Vestigium {
  id: string

  /** FK → Actum. The execution that produced this output. */
  actumId?: string
  /** FK → Modus. What tool produced this output. */
  modusId: string
  /** Exact modus version at run time — locked in. */
  modusVersiono?: string
  /** FK → Modo. The session this ran within — if any. */
  modoId?: string

  /**
   * Who owns this vestigium for retrieval purposes.
   * { animaId }     → identified path
   * { commitment } → anonymous path (ZK bearer)
   */
  auctorKey: { animaId: string } | { commitment: string }

  /**
   * The text prompt used at cast time.
   * "promptum" = what is brought forth (past participle of promere).
   */
  promptum: string

  /**
   * The negative prompt, if the modus accepts one.
   * "negativum" = the negated / excluded direction.
   * Combined with promptum for embeddingPromptum.
   */
  negativum?: string

  /**
   * Textual summary of the output — a caption or description.
   * For text outputs: the text itself (truncated).
   * For image/video/audio: a generated caption.
   */
  summarium: string

  /**
   * URL of the primary output image (or video frame thumbnail).
   * Used by indexImago() to fetch and embed the visual content.
   * "imago" = image, likeness in Latin.
   */
  imagoUrl?: string

  /**
   * FK[] → Intella. The model IDs resolved and used for this execution.
   * Stored for exact-match filtering ("show everything from FLUX Schnell").
   * Also embedded as text via indexIntella() for fuzzy model recall.
   */
  intellaIds?: string[]

  /**
   * Pre-rendered textual description of the models used — assembled by the
   * hook from Intella names and descriptions at creation time.
   * Used by indexIntella() to embed without needing a registry lookup.
   */
  intellaDescription?: string

  genus: VestigiumGenus
  visibilitas: VestigiumVisibility
  impressio: Impressio

  /** User-assigned keyword tags for hybrid search. */
  signacula?: string[]

  /**
   * Embedding of promptum + negativum.
   * Search: "I remember what I typed."
   * Atlas Search index: embeddingPromptum (cosine, dim = model-dependent).
   */
  embeddingPromptum?: number[]

  /**
   * Embedding of the output image / visual content.
   * Search: "I remember what it looked like."
   * Atlas Search index: embeddingImago (cosine, dim = model-dependent).
   */
  embeddingImago?: number[]

  /**
   * Embedding of intellaDescription — the textual description of models used.
   * Search: "I remember which model I used."
   * Atlas Search index: embeddingIntella (cosine, dim = model-dependent).
   */
  embeddingIntella?: number[]

  /** FK[] → Vestigium. Source vestigia for session summary vestigia. */
  fonteIds?: string[]

  natum: Date
  mutatum: Date
}

export type Vestigia = Vestigium[]

// ---------------------------------------------------------------------------
// Query and result types
// ---------------------------------------------------------------------------

export type VestigiumSearchDimension = 'promptum' | 'imago' | 'intella'

export interface VestigiumQuery {
  /** Text to embed and search against. */
  quaerendum: string
  /**
   * Which embedding dimension to search.
   * promptum → embeddingPromptum (default — "I remember what I typed")
   * imago    → embeddingImago    ("I remember what it looked like")
   * intella  → embeddingIntella  ("I remember which model I used")
   */
  per?: VestigiumSearchDimension
  /** Scope to one identity. Absent = public-only search. */
  auctorKey?: { animaId: string } | { commitment: string }
  visibilitas?: VestigiumVisibility[]
  /** Only return results where the author reacted with one of these. */
  auctorImpressio?: ImpressioKind[]
  modusId?: string
  genus?: VestigiumGenus
  /** Filter by specific intella model IDs (exact match, any-of). */
  intellaIds?: string[]
  limit?: number
  minSimilaritas?: number
}

export interface VestigiumResult {
  vestigium: Vestigium
  similaritas: number
}

// ---------------------------------------------------------------------------
// The embedding backlog
// ---------------------------------------------------------------------------

/**
 * How many of one identity's vestigia are still missing each embedding.
 *
 * A vestigium is created with no vectors and is embedded afterwards, so a run that
 * completes while the CLIP service is unreachable leaves a trace that metadata can
 * find and semantic search cannot. That gap is the BACKLOG, and it is per dimension:
 * a trace with no image carries no `imago` debt, and one whose promptum embedded
 * while its image fetch failed owes only the image.
 */
export type VestigiumBacklog = Record<VestigiumSearchDimension, number>

/**
 * One backlogged trace, reduced to the values an embed pass needs.
 *
 * Deliberately NOT a `Vestigium`: the sweep runs as an ordinary metered run, and an
 * Actum is identity-blind, so the work has to travel as values the API layer read for
 * the authenticated caller rather than as ids a cursor would resolve for itself.
 */
export interface VestigiumSweepItem {
  id: string
  /** The text to embed — promptum + negativum for `promptum`, the model description for `intella`. */
  textum?: string
  /** The image to embed for `imago`. */
  imagoUrl?: string
}

// ---------------------------------------------------------------------------
// Vestigiorum — the trace store
// ---------------------------------------------------------------------------

export interface Vestigiorum {
  /**
   * Create a vestigium. No embeddings are set — call index*() to populate.
   */
  create(
    vestigium: Omit<Vestigium, 'id' | 'natum' | 'mutatum' | 'embeddingPromptum' | 'embeddingImago' | 'embeddingIntella' | 'impressio'>
  ): Promise<Vestigium>

  /**
   * Embed promptum + negativum and store as embeddingPromptum.
   * "I remember what I typed."
   */
  indexPromptum(id: string): Promise<void>

  /**
   * Fetch imagoUrl and embed the image, store as embeddingImago.
   * "I remember what it looked like."
   * No-op if imagoUrl is absent on the vestigium.
   */
  indexImago(id: string): Promise<void>

  /**
   * Embed intellaDescription and store as embeddingIntella.
   * "I remember which model I used."
   * No-op if intellaDescription is absent on the vestigium.
   */
  indexIntella(id: string): Promise<void>

  /**
   * Semantic search across one embedding dimension.
   * query.per selects which dimension (default: 'promptum').
   * Results are ranked by cosine similarity and trimmed to limit.
   */
  search(query: VestigiumQuery): Promise<VestigiumResult[]>

  findById(id: string): Promise<Vestigium | null>

  forIdentity(
    auctorKey: { animaId: string } | { commitment: string },
    limit?: number
  ): Promise<Vestigium[]>

  setAuctorImpressio(
    id: string,
    auctorKey: { animaId: string } | { commitment: string },
    impressio: ImpressioKind | null
  ): Promise<Vestigium>

  rate(
    id: string,
    raterKey: { animaId: string } | { commitment: string },
    impressio: ImpressioKind
  ): Promise<void>

  update(
    id: string,
    patch: Partial<Pick<Vestigium, 'visibilitas' | 'signacula' | 'mutatum'>>
  ): Promise<Vestigium>

  /**
   * Hard-delete the vestigium record (the exploration-surface entry only — the
   * underlying Actum/spend history is untouched). Owner-scoping happens at the
   * router/API layer, not here; this is a plain delete-by-id.
   */
  delete(id: string): Promise<void>

  /**
   * How much of this identity's trail is still un-embedded, per dimension.
   *
   * Owner-scoped by construction: the count is over the auctorKey's own vestigia and
   * there is no parameter that widens it. A dimension a vestigium cannot owe — no
   * image, no model description — is not counted against it.
   */
  backlogCount(auctorKey: { animaId: string } | { commitment: string }): Promise<VestigiumBacklog>

  /**
   * The next `limit` backlogged traces for this identity in one dimension, oldest first
   * — the oldest gap is the one a search has been failing to find for longest.
   *
   * Owner-scoped for the same reason `backlogCount` is, and it returns VALUES rather
   * than records: what comes back is what an embed pass needs and nothing else.
   */
  backlog(
    auctorKey: { animaId: string } | { commitment: string },
    per: VestigiumSearchDimension,
    limit: number,
  ): Promise<VestigiumSweepItem[]>

  /**
   * Write one computed vector back onto one of this identity's vestigia.
   *
   * The auctorKey is part of the MATCH, not a check made before it: an id belonging to
   * another identity matches nothing and writes nothing, and the caller is told so by
   * `false` rather than by an exception. That is what keeps a sweep from writing onto a
   * stranger's trace even if a foreign id ever reached it.
   */
  setEmbedding(
    id: string,
    auctorKey: { animaId: string } | { commitment: string },
    per: VestigiumSearchDimension,
    embedding: number[],
  ): Promise<boolean>
}
