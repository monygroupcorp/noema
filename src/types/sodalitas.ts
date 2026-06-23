// =============================================================================
// SODALITAS — a team (a fellowship of Animae that co-owns work)
// =============================================================================
//
// "Sodalitas" = a fellowship / association / brotherhood (Latin, from sodalis:
// a companion, comrade). A Sodalitas is the shared collaborative-identity
// construct (spec §4f): mutable membership, owns the *workspace* and the work
// that accrues in it (today: a Collectio).
//
// Deliberately lean — flat membership, no roles/permissions hierarchy (that is
// explicitly deferred). It is NOT an `Animarum` (the economic-group construct
// with discount/pooled-signa/rate-limit rules); a Sodalitas carries no economic
// governance, only who collaborates. Per-artifact ownership SPLITS are NOT
// stored here — they are snapshotted onto the artifact (the Collectio) at
// creation/freeze, derived from the membership at that moment.
// =============================================================================

export interface Sodalitas {
  id: string
  /** "nomen" = name — the team's display name. */
  nomen: string
  /** FK[] → Anima. The members (always includes `auctor`). Mutable. */
  membra: string[]
  /** FK → Anima. Who created the team. "auctor" = author/creator. */
  auctor: string
  /** "natum" = born — when the team was created. */
  natum: Date
}

/** "Sodalitates" — nominative plural. */
export type Sodalitates = Sodalitas[]

/**
 * Sodalitatum — genitive plural "of the fellowships." The team store.
 */
export interface Sodalitatum {
  find(id: string): Promise<Sodalitas | null>
  create(sodalitas: Omit<Sodalitas, 'id' | 'natum'>): Promise<Sodalitas>
  /** Patch mutable fields — membership and name. */
  update(id: string, patch: Partial<Pick<Sodalitas, 'membra' | 'nomen'>>): Promise<Sodalitas>
  /** Every team the given Anima is a member of. */
  listByMember(animaId: string): Promise<Sodalitates>
}
