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
//   nascens    → created, not yet executing
//   agens      → executing — some acta running, others queued
//   completa   → all acta completed (some may be fractus)
//   cancellata → cancelled mid-run
// =============================================================================

export type CollectioStatus = 'nascens' | 'agens' | 'completa' | 'cancellata'

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

  /** FK → Modus. The modus that was expanded across the parameter grid */
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

  /** FK[] → Actum. The executions this collection spawned */
  acta: string[]
  /** How many acta have reached completus AND count toward the target (approved
   *  when review is on; all successes when it is off) */
  completae: number
  /** How many acta have reached fractus (a genuine generation FAILURE) */
  fractae: number
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

  status: CollectioStatus

  /** Total impetus consumed across all completed acta */
  impetusTotal: bigint

  /** "natum" = born — when this collection was initiated */
  natum: Date
  /** "completum" = completed — when all acta finished (or cancellata) */
  completum?: Date
}

/** "Collectiones" — nominative plural */
export type Collectiones = Collectio[]

/**
 * Collectionum — genitive plural "of the collections."
 * The batch store.
 */
export interface Collectionum {
  find(id: string): Promise<Collectio | null>
  list(filter?: Partial<Pick<Collectio, 'status'>>): Promise<Collectiones>
  listByStatus(status: CollectioStatus): Promise<Collectiones>
  create(collectio: Omit<Collectio, 'id' | 'natum' | 'acta' | 'completae' | 'fractae' | 'reiectae' | 'impetusTotal'>): Promise<Collectio>
  update(id: string, patch: Partial<Pick<Collectio, 'status' | 'acta' | 'completae' | 'fractae' | 'reiectae' | 'impetusTotal' | 'completum' | 'numerus'>>): Promise<Collectio>
}
