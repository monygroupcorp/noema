// =============================================================================
// SCHOLIUM — community annotation on a Modus or Modos
// =============================================================================
//
// "Scholium" is a Latin borrowing from Greek "scholion" — a marginal annotation,
// a learned comment appended to a text. Spinoza used scholia in the Ethics to
// speak directly to the reader outside the formal propositions. Here: community
// notes appended to tool definitions (Modus) and model entries (Modos).
//
// Scholia power the catalog social layer: bug reports, fixes, tips, forks, and
// description corrections. The author (animaId) is always recorded. The item
// author can mark a scholium resoluta (resolved/settled).
//
// DECLENSION (Latin 2nd declension neuter):
//   scholium    — the note itself (nominative)
//   scholii     — of the note (genitive singular)
//   scholia     — the notes / plural form
//   scholiorum  — of the notes / the store (genitive plural) → Scholiorum
// =============================================================================

/** The kind of annotation this scholium represents */
export type ScholiumTag = 'bug' | 'fix' | 'fork' | 'tip' | 'correct'

/** Whether the annotation targets a Modus (tool) or a Modos (model) */
export type ScholiumTargetType = 'modus' | 'modos'

/**
 * Scholium — a tagged community annotation.
 *
 * A community member appends a scholium to a Modus or Modos entry.
 * The annotation carries a tag classifying its intent: bug report, fix,
 * fork notice, usage tip, or description correction.
 *
 * "resoluta" (settled/resolved) is set by the item author to close a bug
 * or acknowledge a correction — signalling the annotation has been acted upon.
 */
export interface Scholium {
  id: string
  /** FK → Anima. "animaId" = the soul who authored this annotation */
  animaId: string
  /** Whether this annotates a Modus (tool definition) or a Modos (model entry) */
  targetType: ScholiumTargetType
  /** FK → Modus.id or Modos.id — the item being annotated */
  targetId: string
  /** "corpus" = body — the text body of the annotation */
  corpus: string
  /** The classification tag — what kind of annotation this is */
  tag: ScholiumTag
  /** "natum" = born — when this annotation was first created */
  natum: Date
  /**
   * "resoluta" = settled/resolved — set by the item author when the annotation
   * has been addressed. Absence means the annotation is still open.
   */
  resoluta?: Date
}

/**
 * Scholiorum — genitive plural "of the scholia."
 * The community annotation store.
 */
export interface Scholiorum {
  /** Create a new annotation; id and natum are generated automatically */
  create(input: Omit<Scholium, 'id' | 'natum'>): Promise<Scholium>
  /** Find a single scholium by its id; null if not found */
  find(id: string): Promise<Scholium | null>
  /** All scholia for a given target, in insertion order */
  listByTarget(targetType: ScholiumTargetType, targetId: string): Promise<Scholium[]>
  /** All open (unresolved) bug-tagged scholia for a given target */
  listUnresolvedBugs(targetType: ScholiumTargetType, targetId: string): Promise<Scholium[]>
  /** Mark a scholium as resolved at the given timestamp; throws if not found */
  resolve(id: string, at: Date): Promise<Scholium>
}
