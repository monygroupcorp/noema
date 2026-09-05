// =============================================================================
// COLLECTIO — the collection / batch-generation container
// =============================================================================
//
// "Collectio" = a gathering together, a collection (Latin, from colligere:
// to gather, to collect). In Roman rhetoric, a collectio was a summary that
// drew conclusions from assembled evidence.
//
// A Collectio is the container for N Acta generated from one parameterised
// modus expansion. It is neither a single Actum nor a Modus — it is the
// result of applying a parameter grid to a Modus and executing every
// combination. This is the canonical name for the feature once colloquially
// called "cook" — `Collectio` is the only term used in code (user-facing
// labels like "Collections"/"Drops" are a frontend concern). Minting is the
// SEPARATE later on-chain step (Catena), never conflated with generation.
//
// The TraitEngine (pure function) expands:
//   Modus × parametri → Inceptio[]   (one Inceptio per combination)
//
// The CollectioCursor fans those Inceptiones to ActumInceptor with
// configurable concurrency, collecting the resulting Acta into this record.
//
// Lifecycle:
//   draft      → authored but NOT yet fired — tractus is still mutable (the only
//                editable state; provenance re-derives on every tractus edit)
//   nascens    → created + fired, not yet executing
//   agens      → executing — some acta running, others queued
//   completa   → all acta completed (some may be fractus)
//   cancellata → cancelled mid-run
// Firing (draft → nascens) FREEZES tractus: provenance is locked from then on.
// =============================================================================

export type CollectioStatus = 'draft' | 'nascens' | 'agens' | 'completa' | 'cancellata'

/**
 * TraitValor — one option within a trait axis.
 * "valor" = value/worth in Latin.
 */
export interface TraitValor {
  /** The actual aditus value injected into the modus when this option is selected */
  value: unknown
  /** Human-facing display name. Shown in canvas UI and used as the NFT "value" field. Falls back to String(value). */
  label?: string
  /** Probability weight for weighted-random selection. Default 0.5. Higher = more common. */
  rarity?: number
  /** Text fragment woven into the assembled generation prompt when this option wins. */
  promptFragment?: string
  /** Names of options in OTHER tractus axes that this option blocks (label-level exclusion). */
  excludes?: string[]
  /**
   * Theme tags for group-level mutual exclusion.
   * e.g. ['fantasy', 'medieval'] — used with selectForPiece tagRules to prevent
   * mixing themed options (e.g. 'fantasy' never coexists with 'sci-fi').
   */
  tags?: string[]
}

/**
 * A single axis of variation in the parameter grid.
 * "Tractus" = a stretch/tract in Latin — one dimension of the expansion.
 *
 * Example: { porta: 'seed', valores: [42, 137, 999] }
 * Combined with other tractus, produces the full expansion grid.
 */
export interface Tractus {
  /** The aditus port key this axis varies — e.g. 'background', 'outfit' */
  porta: string
  /**
   * Human-facing category label. Shown on the canvas and used as the NFT "trait_type" field.
   * Falls back to porta if absent.
   */
  label?: string
  /**
   * When true, this axis is IGNORED in the DNA uniqueness check (see `Collectio.dna`).
   * Two pieces differing only on bypassed axes count as duplicate DNA. Typical for
   * incidental axes like `background` where a repeat is acceptable.
   */
  bypassDNA?: boolean
  valores: TraitValor[]
}

/**
 * Collectio — a batch-generation container.
 *
 * Holds the parameterisation that generated it, the IDs of all resulting
 * Acta, and aggregate stats for progress tracking and cost accounting.
 */
export interface Collectio {
  id: string
  /** "nomen" = name in Latin — user-given name for this collection */
  nomen?: string
  /** "descriptio" = description — the user's working note on what this collection is. */
  descriptio?: string

  /**
   * FK → Modus. The modus that was expanded across the parameter grid.
   * A DRAFT may not have picked its flow yet — it carries `''` until one is set
   * (and its `provenanceHash` is `''` too, there being nothing to content-address).
   * Every fired collection has a real modusId; `fireCollection` refuses an empty one.
   */
  modusId: string
  /** The base aditus applied to every actum (before per-axis overrides) */
  aditusBase: Record<string, unknown>
  /** The parameter grid axes — each tractus is one dimension of variation */
  tractus: Tractus[]
  /** Target piece count for the run (the requested total; grows when extended).
   *  NOT the size of the combination grid — with weighted/duplicate selection a
   *  collection may target more or fewer pieces than there are combinations. */
  numerus: number

  /**
   * Content-address of the generative configuration — `sha256:<hex>` over
   * `{ modusId, modusVersio, tractus, aditusBase }`. Any change to the flow,
   * a trait, a weight, or the base aditus yields a new hash (a provably
   * different/versioned input). The NFT "provenance hash". See provenance.ts.
   */
  provenanceHash: string

  /**
   * FK → Anima or commitment — the concrete identity that initiated AND funds
   * this collection's pieces (every dispatched Actum is charged to this `by`).
   * For a team-owned collection this is the founding/initiating member; team
   * ownership is the `sodalitasId` overlay below.
   */
  by: { animaId: string } | { commitment: string }

  /**
   * FK → Sodalitas. Team ownership overlay: when present, every member of the
   * team owns this collection (not just `by`). The funding identity stays on
   * `by` — teams have no pooled ledger yet. Absent → single-owner.
   */
  sodalitasId?: string

  /**
   * Per-artifact ownership split, snapshotted from the owning team's membership
   * at creation (equal weights, each `1/n`; floating-point so they sum to ~1).
   * A PROVISIONAL record of who shares in the artifact — the exact, canonical
   * on-chain split (integer basis points) is re-snapshotted at freeze (later).
   * Absent for single-owner (non-team) collections.
   */
  owners?: Array<{ animaId: string; weight: number }>

  /** FK[] → Actum. The executions this collection spawned — every piece the
   *  collection initiated and paid for, in dispatch order, whatever its outcome.
   *  A piece is appended the moment it is dispatched, so a piece held for review
   *  is a member of this list exactly like an auto-counted one. */
  acta: string[]

  // ── The piece counters ────────────────────────────────────────────────────
  //
  // Every DISPATCHED piece is in exactly one of the four states below: in flight
  // (in neither counter yet), `pendentes`, `completae`, `fractae` or `reiectae`.
  // A piece moves between them once and never back, except that `pendentes` is a
  // waypoint: a held piece leaves it for `completae` (approved) or `reiectae`
  // (rejected). With `numerus + reiectae` as the dispatch budget, that gives the
  // identity a caller can rely on:
  //
  //   completae + pendentes + fractae + <in flight> + <not yet dispatched> = numerus
  //
  // `reiectae` cancels out of both sides — it raises the budget by exactly the
  // piece it removed from the target, which is what "a rejection is not a
  // failure, it is a re-roll" means arithmetically.

  /** How many acta GENERATED AND ACCEPTED — a successful gen that counts toward
   *  `numerus`. With review on, a piece reaches this counter only once a reviewer
   *  approves it (until then it is in `pendentes`); with review off, every
   *  success lands here directly. */
  completae: number
  /** How many acta have reached fractus (a genuine generation FAILURE) */
  fractae: number
  /** How many pieces GENERATED AND AWAITING a reviewer's decision — a successful
   *  gen held by `reviewEnabled` (`exitus.reviewOutcome: 'pending'`). Real,
   *  paid-for work that has not yet been accepted or declined, so it counts
   *  toward neither `completae` nor `fractae`. Approval moves the piece to
   *  `completae`; rejection moves it to `reiectae`. Always 0 while review is off. */
  pendentes: number
  /** How many pieces a reviewer REJECTED (a successful gen the reviewer declined —
   *  distinct from `fractae`). Each rejection extends the dispatch budget by one
   *  (a replacement piece is generated) and is the single source of that budget. */
  reiectae: number

  /** Max concurrent acta — rate control for the fan-out */
  concurrentia: number

  /**
   * Opt-in DNA uniqueness: when true, no two pieces share the same trait
   * combination (across non-`bypassDNA` axes). The TraitMixer rerolls a
   * colliding piece deterministically until its DNA is unique (or the grid is
   * exhausted). Off (default) → duplicates allowed (variation-test behaviour).
   */
  dna?: boolean

  /**
   * When true, every completed piece is held for review (`reviewOutcome: 'pending'`)
   * and counts in `pendentes` — not `completae` — until a reviewer approves it.
   * Off → a successful gen auto-counts. Absent → the CollectioCursor's global
   * default applies.
   */
  reviewEnabled?: boolean

  status: CollectioStatus

  /**
   * When set, dispatching new pieces is held — orthogonal to `status` (a
   * `CollectioStatus` is NOT added for this; `agens` stays `agens` while
   * paused). A `Date` (not a boolean) for auditability: when the pause took
   * effect. Absent = not paused. Cleared (unset) on resume.
   */
  pausatum?: Date

  /** Total impetus consumed across all completed acta */
  impetusTotal: bigint

  /** "natum" = born — when this collection was initiated */
  natum: Date
  /** "completum" = completed — when all acta finished (or cancellata) */
  completum?: Date
}

/** "Collectiones" — nominative plural */
export type Collectiones = Collectio[]

/** Owner-scoped, cursor-paginated read opts for `Collectionum.listOwned` — the same shape
 *  `DatasetListOpts` uses, and for the same reason: the access predicate belongs IN THE QUERY,
 *  not in a post-filter over every collection in the store. */
export interface CollectioListOpts {
  /** The caller's funding identity, matched against `Collectio.by`. */
  by: Collectio['by']
  /**
   * FK[] -> Sodalitas. The teams the CALLER is a member of, resolved at the API layer from the
   * authenticated caller and never from a request parameter. A collection whose `sodalitasId`
   * is in this set is listed alongside the caller's own — the read half of the team overlay.
   * Absent/empty -> funder-only.
   */
  sodalitasIds?: string[]
  /** Opaque page cursor from a prior page; omit for the first page. */
  cursor?: string
  /** Page size (clamped 1..500; default 100). */
  limit?: number
}

export interface CollectioListPage {
  entries: Collectiones
  nextCursor?: string
}

/**
 * Collectionum — genitive plural "of the collections."
 * The batch store.
 */
export interface Collectionum {
  find(id: string): Promise<Collectio | null>
  list(filter?: Partial<Pick<Collectio, 'status'>>): Promise<Collectiones>
  /**
   * The caller's collections, newest first, owner-scoped and paged IN THE STORE. Optional:
   * an in-memory store may omit it, and `CrystalApi.listCollections` falls back to `list()`
   * plus an in-process ownership filter (the same fallback shape `Datasets.findOwned` has).
   * Every store a deployment actually runs on implements it — the fallback is a full scan.
   */
  listOwned?(opts: CollectioListOpts): Promise<CollectioListPage>
  listByStatus(status: CollectioStatus): Promise<Collectiones>
  create(collectio: Omit<Collectio, 'id' | 'natum' | 'acta' | 'completae' | 'fractae' | 'pendentes' | 'reiectae' | 'impetusTotal'>): Promise<Collectio>
  update(id: string, patch: Partial<Pick<Collectio, 'status' | 'acta' | 'completae' | 'fractae' | 'pendentes' | 'reiectae' | 'impetusTotal' | 'completum' | 'nomen' | 'descriptio' | 'modusId' | 'numerus' | 'tractus' | 'provenanceHash' | 'pausatum'>>): Promise<Collectio>
}
