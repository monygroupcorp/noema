// =============================================================================
// MODUS — the fractal tool primitive
// =============================================================================
//
// The word "modus" is Latin second-declension masculine for "measure, manner,
// way." Spinoza used it technically: a modus is a finite expression of infinite
// substance (here: materia, the compute substrate). Aristotle: form (modus)
// imposed on matter (materia) produces a result (actum).
//
// A modus is FRACTAL: it can be an atomic leaf (atomicus) that runs one
// operation, or a composed tree (compositus) whose children are other modi.
// This single primitive replaces what were previously called "tools" (atomic),
// "spells" (sequential compositions), and "cook" (batch/expression grids).
//
// TRIAD: modus defines → modo executes → actum records
//
// DECLENSION (how the word inflects — each form has a meaning in the codebase):
//   modus    — the class, the primitive itself (nominative)
//   modi     — of the modus / its parameters (genitive singular)
//   modorum  — of the modes / the registry (genitive plural)  → Modorum
//   modum    — the modus being acted on (accusative)
//   modo     — by/in/through a mode — the runtime session (ablative) → Modo type
// =============================================================================

/** Whether a modus is a leaf operation or a tree of other modi */
export type ModusGenus = 'atomicus' | 'compositus'

/** A single named port (input or output) on a modus */
export interface Porta {
  // "porta" = gate/door in Latin — an opening in the modus boundary
  type: string          // canonical type name: 'text' | 'image' | 'video' | 'audio' | 'int' | 'float'
  required?: boolean
  default?: unknown
  description?: string
}

/**
 * The full input or output schema of a modus.
 * "forma" = shape/form in Latin — the declared shape of what enters or exits.
 * aditus (entrance) and exitus (exit) are both Forma.
 */
export type Forma = Record<string, Porta>

/**
 * A single step within a compositus modus.
 * "gradus" = step/degree in Latin — root of the English word "gradient."
 * A compositus modus is an ordered list of gradus, each invoking a child modus.
 */
export interface Gradus {
  /** "ordine" = in order — the position of this step in the sequence (0-indexed) */
  ordine: number
  /** Which modus to invoke at this step */
  modusId: string
  /**
   * "condicio" = condition — an optional expression string that must evaluate
   * to true for this step to run. Uses the expression system (expr-eval).
   * Example: "input.width > 512"
   */
  condicio?: string
  /** If true, this step can run in parallel with adjacent steps at the same ordine */
  parallel?: boolean
}

/**
 * Modus — the fractal tool primitive.
 *
 * Atomic modus (genus: 'atomicus'):
 *   A leaf operation. Has aditus/exitus schema. No gradus. Executes one thing.
 *   These are what the platform's Essentia catalog is made of.
 *
 * Composed modus (genus: 'compositus'):
 *   A tree of other modi wired by gradus steps and condicio expressions.
 *   This is how "spells" (sequential) and "cook" (batch/expression) are expressed.
 *   Can contain other compositus modi — fractal depth is unlimited.
 */
export interface Modus {
  id: string
  /** "nomen" = name in Latin */
  nomen: string
  genus: ModusGenus
  /** Semantic version string e.g. "1.0.0" */
  versio: string
  /**
   * Content-addressed SHA-256 hash of the modus definition.
   * Locks the definition at a point in time. Changing any field changes the hash.
   * Used to verify that the modus that ran matches the modus that was quoted.
   */
  contentHash: string

  /** Input schema — "aditus" = entrance in Latin */
  aditus: Forma
  /** Output schema — "exitus" = exit in Latin */
  exitus: Forma

  /** Ordered steps — present only when genus is 'compositus' */
  gradus?: Gradus[]

  /**
   * Which execution service (cursor) handles this modus.
   * "ministerium" = service/office in Latin — the function assigned to this modus.
   * Maps to a registered Cursor in the Cursorum.
   * Examples: 'runpod', 'openai', 'replicate', 'comfyui', 'local'
   * Absent on compositus modi — execution is handled by their constituent atomici.
   */
  ministerium?: string

  /**
   * Fixed impetus cost for this modus, if cost is known at definition time.
   * "fixum" = fixed/fastened in Latin.
   * Present for third-party API tools (OpenAI, Replicate, etc.) where cost
   * is deterministic. Absent for pod-based tools where actual cost depends
   * on runtime duration: impetus = Materia.impetusPerSecond × Actum.duratio.
   */
  impetusFixum?: bigint

  /** "auctor" = author/creator in Latin — the animaId of who created this modus */
  auctor?: string
  /** True = platform-owned canonical modus. False = community-published. */
  canonica: boolean

  /** Community star count — embedded count for fast catalog sorting */
  stellae?: number

  /** "natum" = born — when this modus was first registered */
  natum: Date
  /** "mutatum" = changed — when this modus was last modified */
  mutatum: Date
}

/** "Modi" — nominative plural of modus. A collection of modi. */
export type Modi = Modus[]

/**
 * Modorum — genitive plural "of the modes."
 * The registry that owns, stores, and resolves all modus definitions.
 */
export interface Modorum {
  find(id: string, versio?: string): Promise<Modus | null>
  register(modus: Modus): Promise<void>
  list(filter?: Partial<Pick<Modus, 'genus' | 'canonica' | 'auctor'>>): Promise<Modi>
}
