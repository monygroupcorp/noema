// =============================================================================
// VESTIGIUM — the indexed trace of a completed output
// =============================================================================
//
// "Vestigium" = footprint, track, trace (Latin, neuter 2nd declension).
// Vestigia sunt — the footprints remain.
//
// A Vestigium is created from a completed Actum. It records the prompt that
// was used (aditus), a textual summary of the output, a pre-computed embedding
// vector, and social metadata (ratings). This is what the RAG layer indexes.
//
// The embedding is stored as a plain number[] on the document — not in any
// proprietary format. The implementation (Atlas Vector Search, pgvector,
// Qdrant, Weaviate, Pinecone) is behind the Vestigiorum interface.
// Migrating stores = exporting documents (vectors included) + swapping the
// implementation. No re-embedding needed.
//
// PRIVACY PARTITION:
//   auctorKey mirrors the `by` pattern on Inceptio and Mandatum:
//     { animaId }     → identified path (imperfect current use)
//     { arcanumHash } → anonymous path (ZK / perfect private use)
//   Never both. Never neither. Enforced at write time by the implementation.
//
// INDEXING:
//   create()  → vestigium written, embedding absent (async indexing pending)
//   index()   → embedding computed and written
//   search()  → embed(quaerendum) → ANN search with metadata pre-filter
//
// HOOKUP TO EXECUTION RAIL:
//   ActumCompletor.complete() returns the completed Actum.
//   The execution orchestrator (RunPodAdapter, API handler) calls
//   vestigiorum.create() with the output — the execution rail itself is
//   unaware of vestigia.
//
// SESSION SUMMARIES:
//   After a Modo terminates, a session summary vestigium can be created
//   (genus: 'text', actumId absent, fonteIds pointing to the output vestigia).
//   This enables "last Tuesday I was working on portraits"-style RAG over
//   session history using the same search() interface.
// =============================================================================

export type VestigiumVisibility = 'privata' | 'communis' | 'publica'
// privata  → visible only to auctor
// communis → accessible to anyone with the link
// publica  → listed in the public gallery and searched by strangers

export type VestigiumGenus = 'text' | 'image' | 'video' | 'audio'

export type ImpressioKind = 'amor' | 'risus' | 'maeror'
// amor   = love  (strong positive — "this is exactly what I wanted")
// risus  = laughter (playful positive — "this is funny/unexpected/delightful")
// maeror = grief (negative — "this missed the mark")

/**
 * Impressio — the reaction record attached to a Vestigium.
 *
 * Two separate concerns:
 *   auctorImpressio — the author's own reaction, used for personal RAG
 *                     filtering ("search only the images I loved")
 *   amor/risus/maeror counts — anonymous community reactions, no rater IDs
 *                     stored on the Vestigium. The implementation tracks rater
 *                     identity internally (as hashed keys) to prevent double-
 *                     rating; the public surface exposes only counts.
 */
export interface Impressio {
  /** Author's own reaction — one choice, changeable, used for personal filtering */
  auctorImpressio?: ImpressioKind
  /** Community love count */
  amor: number
  /** Community laughter count */
  risus: number
  /** Community grief count */
  maeror: number
}

/**
 * Vestigium — the indexed trace of a completed actum output.
 *
 * Created after ActumCompletor.complete(). One vestigium per notable output.
 * The embedding is populated asynchronously via Vestigiorum.index().
 */
export interface Vestigium {
  id: string

  /**
   * FK → Actum. The execution that produced this output.
   * Absent for synthetic vestigia (session summaries, manual entries).
   */
  actumId?: string
  /** FK → Modus. What tool produced this output. */
  modusId: string
  /**
   * The exact modus version at run time — locked in, like actum.modusVersiono.
   * Allows filtering "outputs from FLUX v2 specifically."
   */
  modusVersiono?: string
  /** FK → Modo. The session this ran within — if any. */
  modoId?: string

  /**
   * Who owns this vestigium for retrieval purposes.
   * Mirrors the `by` pattern on Inceptio and Mandatum.
   * { animaId }     → identified path
   * { arcanumHash } → anonymous path (ZK bearer)
   * Never both. Never neither.
   */
  auctorKey: { animaId: string } | { arcanumHash: string }

  /**
   * The textual prompt used — extracted from actum.aditus by the orchestrator.
   * "promptum" = what is brought forth (past participle of promere).
   * This field, concatenated with summarium, is what gets embedded.
   * For multi-modal tools without a text prompt: a short description of the
   * input (e.g. "style transfer: photo → impressionist painting").
   */
  promptum: string

  /**
   * Textual summary of the output.
   * For text outputs: the text itself, truncated to a sensible limit.
   * For image/video/audio: a generated caption or description produced by
   * the cursor at completion time (or by a subsequent captioning pass).
   * "summarium" = summary in Latin.
   */
  summarium: string

  /** What kind of output was produced */
  genus: VestigiumGenus

  visibilitas: VestigiumVisibility

  /** Social reactions from author and community */
  impressio: Impressio

  /**
   * User-assigned keyword tags — for hybrid text + vector search.
   * "signacula" = small marks/seals in Latin (diminutive of signum).
   * E.g. ['portrait', 'forest', 'soft-light']
   */
  signacula?: string[]

  /**
   * Pre-computed embedding vector for semantic search.
   * Stored as a plain number[] — portable to any vector store.
   * Absent until Vestigiorum.index() is called (async after creation).
   *
   * Dimensionality is determined by the configured embedding model:
   *   1536 for text-embedding-3-large
   *    768 for text-embedding-3-small
   *   1024 for e5-large-v2, etc.
   *
   * Migration note: since this is a plain array on the document, exporting
   * and re-importing to another vector store requires no re-embedding.
   */
  embedding?: number[]

  /**
   * FK[] → Vestigium. Source vestigia this was derived from.
   * Present on session summary vestigia — points to the individual output
   * vestigia whose content was collapsed into this summary.
   */
  fonteIds?: string[]

  /** "natum" = born — when this vestigium was created */
  natum: Date
  /** "mutatum" = changed — when tags, visibility, or impressio were last updated */
  mutatum: Date
}

/** "Vestigia" — nominative plural of vestigium */
export type Vestigia = Vestigium[]

// ---------------------------------------------------------------------------
// Query and result types
// ---------------------------------------------------------------------------

/**
 * VestigiumQuery — the search parameters for Vestigiorum.search().
 * Used directly by agents and by the /rag/search endpoint.
 */
export interface VestigiumQuery {
  /** Text to embed and search against. "what to seek" */
  quaerendum: string
  /**
   * Scope search to one identity's vestigia.
   * Absent = search across public (visibilitas: 'publica') vestigia only.
   * Present = search this identity's private + communis + publica vestigia.
   */
  auctorKey?: { animaId: string } | { arcanumHash: string }
  /**
   * Filter by visibility. Defaults:
   *   with auctorKey → ['privata', 'communis', 'publica']
   *   without        → ['publica']
   */
  visibilitas?: VestigiumVisibility[]
  /**
   * Only return results where the author reacted with one of these impressions.
   * E.g. ['amor'] → personal gallery of loved outputs.
   * Absent = no impression filter.
   */
  auctorImpressio?: ImpressioKind[]
  /** Restrict to outputs from a specific modus */
  modusId?: string
  /** Restrict to outputs of a specific genus */
  genus?: VestigiumGenus
  /** Maximum results to return — default 20 */
  limit?: number
  /** Minimum cosine similarity (0–1) — default 0.7 */
  minSimilaritas?: number
}

/**
 * VestigiumResult — one ranked result from a search.
 * "similaritas" = similarity in Latin.
 */
export interface VestigiumResult {
  vestigium: Vestigium
  /** Cosine similarity score from the vector search (0–1) */
  similaritas: number
}

// ---------------------------------------------------------------------------
// Vestigiorum — the trace store
// ---------------------------------------------------------------------------

/**
 * Vestigiorum — genitive plural "of the traces."
 * The store and search surface for all vestigia.
 *
 * Implementations:
 *   MemoryVestigiorum         — in-process map, for tests
 *   MongoAtlasVestigiorum     — MongoDB Atlas Vector Search ($vectorSearch + $filter)
 *   PgVectorVestigiorum       — pgvector (<-> operator with WHERE)
 *   QdrantVestigiorum         — Qdrant filtered ANN
 *
 * All implementations satisfy the same contract. Migrating from Atlas to
 * pgvector = export documents (vectors included as number[]) + swap impl.
 */
export interface Vestigiorum {
  /**
   * Create a vestigium from a completed actum output.
   * Called by the execution orchestrator after ActumCompletor.complete().
   * Embedding is absent on creation — call index() to populate asynchronously.
   * Impressio is initialised to all-zero counts with no auctorImpressio.
   */
  create(
    vestigium: Omit<Vestigium, 'id' | 'natum' | 'mutatum' | 'embedding' | 'impressio'>
  ): Promise<Vestigium>

  /**
   * Compute and store the embedding for a vestigium.
   * Embeds promptum + summarium concatenated.
   * Idempotent — safe to call multiple times; re-embeds if already present.
   */
  index(id: string): Promise<void>

  /**
   * Semantic vector search with metadata pre-filtering.
   *
   * Implementation contract:
   *   1. Embed query.quaerendum using the configured embedding model
   *   2. Run ANN search against the embedding index
   *   3. Apply metadata filters (auctorKey, visibilitas, auctorImpressio,
   *      modusId, genus) as pre-filters on the index, not post-filters
   *   4. Return results ranked by cosine similarity, trimmed to limit
   *
   * Atlas impl:  $vectorSearch with $filter
   * pgvector:    SELECT ... ORDER BY embedding <-> $1 WHERE ...
   * Qdrant:      search() with filter payload conditions
   */
  search(query: VestigiumQuery): Promise<VestigiumResult[]>

  findById(id: string): Promise<Vestigium | null>

  /**
   * Return the most recent vestigia for an identity — no semantic query.
   * Used for RAG context injection ("show me recent outputs") and for
   * building session summary inputs.
   */
  forIdentity(
    auctorKey: { animaId: string } | { arcanumHash: string },
    limit?: number
  ): Promise<Vestigium[]>

  /**
   * Set or clear the author's own impression of their output.
   * The author may change their mind — this overwrites the previous value.
   * null clears the impression entirely.
   * Only the holder of the matching auctorKey may call this.
   */
  setAuctorImpressio(
    id: string,
    auctorKey: { animaId: string } | { arcanumHash: string },
    impressio: ImpressioKind | null
  ): Promise<Vestigium>

  /**
   * Record a community reaction from a non-author viewer.
   * Privacy-preserving: increments the count on the vestigium.
   * The implementation tracks rater identity internally (as H(raterKey))
   * to prevent double-rating; no rater ID is ever stored on the Vestigium.
   * Throws if raterKey matches the vestigium's auctorKey (use setAuctorImpressio).
   */
  rate(
    id: string,
    raterKey: { animaId: string } | { arcanumHash: string },
    impressio: ImpressioKind
  ): Promise<void>

  update(
    id: string,
    patch: Partial<Pick<Vestigium, 'visibilitas' | 'signacula' | 'mutatum'>>
  ): Promise<Vestigium>
}
