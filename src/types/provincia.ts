// =============================================================================
// PROVINCIA — a project (a named sphere of work an account owns)
// =============================================================================
//
// "Provincia" = a sphere of activity, an assigned charge/domain (Latin). A
// Provincia is the account-scoped WORKSPACE LENS: a named grouping of work
// (Dragon Game, Brand Identity, …) that files existing assets together. It is
// the durable, cross-device backbone of the web app's `Project`.
//
// OWNERSHIP BOUNDARY = THE ACCOUNT. A Provincia belongs to exactly one Anima
// (`animaId`). The active account selects the visible project set; there is no
// anonymous/commitment-owned project (the seam Keyring Decision 6 defined).
//
// HOLDINGS ARE REFERENCES, NOT COPIES. A project FILES existing assets — it
// does not own new nouns. `datasetIds`/`modelIds`/`collectionIds` are flat id
// references into the canonical asset stores (datasets / models(Intella) /
// collections(Collectio)) — the same convention every neighbor uses for
// id-reference lists (cf. `Editio.authorAnimaIds`, `Vestigium.intellaIds`).
// Counts and the scoped surfaces read these lengths; nothing is duplicated.
//
// SHARING references a Sodalitas (Team), it does not re-implement membership
// (Decision 6). `sodalitasId` is an optional FK into the team store; the member
// set of a shared project IS that team's `membra`. No second membership model.
//
// Deliberately lean: presentation hints (`ornatus`) are opaque to the backend;
// ephemeral view state (chat histories, canvases, favorite cards) stays
// client-local — it has no backend store to reference yet.
// =============================================================================

/** The kinds of asset a project can hold — selects one holding list. */
export type ProvinciaResKind = 'dataset' | 'model' | 'collection'

export interface Provincia {
  id: string
  /** FK → Anima. The owning account — the project's hard ownership boundary. */
  animaId: string
  /** "nomen" = name — the project's display name. */
  nomen: string
  /** Optional human description. */
  descriptio?: string
  /** Presentation hints (glyph + color). Opaque to the backend, pure display. */
  ornatus?: { glyph?: string; color?: string }
  /** FK[] → dataset ids (the training library). Filed references, not copies. */
  datasetIds: string[]
  /** FK[] → Intella ids (the model shelf). */
  modelIds: string[]
  /** FK[] → Collectio ids (published/draft collections). */
  collectionIds: string[]
  /** Optional FK → Sodalitas (Team) for the shared member set (Decision 6). */
  sodalitasId?: string
  /** "natum" = born — when the project was created. */
  natum: Date
  /** "mutatum" = changed — last update (holdings or metadata). */
  mutatum: Date
}

/** "Provinciae" — nominative plural. */
export type Provinciae = Provincia[]

/** The mutable fields a project's owner may patch (never `animaId`/`id`/timestamps). */
export type ProvinciaPatch = Partial<
  Pick<Provincia, 'nomen' | 'descriptio' | 'ornatus' | 'sodalitasId' | 'datasetIds' | 'modelIds' | 'collectionIds'>
>

/**
 * Provinciarum — genitive plural "of the projects." The project store.
 */
export interface Provinciarum {
  find(id: string): Promise<Provincia | null>
  create(input: Omit<Provincia, 'id' | 'natum' | 'mutatum'>): Promise<Provincia>
  /** Patch mutable fields (metadata or a holdings list). Bumps `mutatum`; an
   *  undefined value clears (unsets) that field. */
  update(id: string, patch: ProvinciaPatch): Promise<Provincia>
  /** Delete a project (its filed assets are untouched — holdings are references). */
  remove(id: string): Promise<void>
  /** Every project the given Anima owns. */
  listByOwner(animaId: string): Promise<Provinciae>
}
