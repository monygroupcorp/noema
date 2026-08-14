// =============================================================================
// DATASET — the training-data primitive
// =============================================================================
//
// train-overview.md: the DATASET is the primitive — media + versions +
// captionsets; trainings derive from a Dataset; trained models land on the
// model shelf. Mirrors `Collectio`'s shape: an owner-scoped, media-bearing,
// versioned record with its own Mongo store (see `src/crystal/MongoDataset.ts`).
//
// Two projections off one store (mirrors the `FlowSummary` precedent —
// `CrystalApi.listFlows`/`listMyFlows` project a `Modus[]` down to a compact
// catalog shape): `Dataset` is the FULL rich shape a dataset's own screen
// renders; `DatasetSummary` is the thin shape a picker (e.g. a training-run
// builder) consumes. Both read off the same underlying Mongo document.
// =============================================================================

export type DatasetModality = 'image' | 'video' | 'audio' | '3d'
export type DatasetCustody = 'sealed' | 'local' | 'remote'

/** One caption pass over (some or all of) a dataset's media. */
export interface Captionset {
  id: string
  name: string
  /** How the captions were produced, e.g. 'Florence-2', 'WD14', 'manual'. */
  method: string
  /** How much of the dataset's media this pass covers, e.g. "12/12". Derived from
   *  the captions actually present over `media.length` — never caller-supplied. */
  coverage: string
  /** Caption text per media item, keyed by `DatasetMediaItem.id`. Sparse: a media item
   *  with no caption in this pass simply has no key. Keyed by media id rather than by
   *  position because `media` is append-only — a positional key re-binds to a different
   *  item as soon as media is added. Optional on read: documents written before this
   *  field existed carry none. */
  captions?: Record<string, string>
}

/** The display string for how much of a dataset's media a caption pass covers, derived
 *  from the captions actually present over the media count. Derived in ONE place so a
 *  captionset can never report a coverage its caption map does not support. */
export function captionCoverage(captions: Record<string, string> | undefined, mediaCount: number): string {
  return `${Object.keys(captions ?? {}).length}/${mediaCount}`
}

/** One media item comprising a dataset — either dropped in directly (R2
 *  signed-PUT upload) or seeded from an existing generation's output. */
export interface DatasetMediaItem {
  id: string
  url: string
  source: 'upload' | 'generation'
  /** FK -> Actum. Present iff source === 'generation' — the run this media came from. */
  actumId?: string
  addedAt: Date
}

/** One snapshot of the dataset's media set — grows as media is added. */
export interface DatasetVersion {
  v: string
  count: number
  when: Date
}

/**
 * Dataset — the training-data primitive.
 *
 * Ownership key `owner: string` (an Anima id), matching `Provincia.owner`'s
 * pattern. `Dataset.id` stays a plain string to match `Provincia.datasetIds`
 * (`src/allocutio/api/types.ts:106`), which already reads it read-only.
 */
export interface Dataset {
  id: string
  owner: string
  name: string
  modality: DatasetModality
  custody: DatasetCustody
  media: DatasetMediaItem[]
  captionsets: Captionset[]
  versions: DatasetVersion[]
  /** "natum" = born — when this dataset was created */
  natum: Date
  /** "mutatum" = changed — when this dataset was last modified */
  mutatum: Date
}

/** Thin projection of a Dataset for pickers (e.g. the training-run builder).
 *  Mirrors `lib/api.ts`'s existing client-side `DatasetSummary` shape exactly —
 *  do not add fields the picker doesn't need. */
export interface DatasetSummary {
  id: string
  name: string
  images?: number
  updatedAt?: string
}

/** Owner-scoped, cursor-paginated read opts — mirrors the `GET /v1/me/runs` precedent. */
export interface DatasetListOpts {
  owner: string
  cursor?: string
  limit?: number
}

export interface DatasetListPage {
  entries: Dataset[]
  nextCursor?: string
}

export interface DatasetSummaryListPage {
  entries: DatasetSummary[]
  nextCursor?: string
}

/** Input to create a drop-media dataset: media already uploaded via
 *  `POST /storage/uploads/sign` (R2 signed-PUT), referenced by URL. */
export interface CreateDatasetFromUpload {
  source: 'upload'
  name: string
  modality: DatasetModality
  custody?: DatasetCustody
  /** URLs/keys returned by the storage-sign flow. */
  mediaUrls: string[]
}

/** Input to create a seed-from-generation dataset: media resolved from an
 *  existing Actum's exitus (an already-completed run this caller owns). */
export interface CreateDatasetFromGeneration {
  source: 'generation'
  name: string
  modality: DatasetModality
  custody?: DatasetCustody
  /** FK[] -> Actum. Each must be owned by the caller and completus. */
  actumIds: string[]
}

export type CreateDatasetInput = CreateDatasetFromUpload | CreateDatasetFromGeneration

/**
 * Datasets — genitive plural "of the datasets."
 * The dataset store. Serves both the full rich shape (`list`) and the thin
 * summary projection (`listSummaries`) off ONE underlying collection.
 */
export interface Datasets {
  create(input: Omit<Dataset, 'id' | 'natum' | 'mutatum'>): Promise<Dataset>
  find(id: string): Promise<Dataset | null>
  list(opts: DatasetListOpts): Promise<DatasetListPage>
  listSummaries(opts: DatasetListOpts): Promise<DatasetSummaryListPage>
  /** Attach a captionset, replacing any captionset already carrying the same id (a
   *  re-run of a caption pass must not leave two). Bumps `mutatum`. Returns the updated
   *  dataset, or null when the dataset does not exist.
   *
   *  Owner scoping is deliberately NOT a store concern — it is resolved at the API layer
   *  from the authenticated caller (see `CrystalApi.getDataset`), so no caller can supply
   *  an owner to this seam. */
  addCaptionset(datasetId: string, captionset: Captionset): Promise<Dataset | null>
  /** Set exactly one caption inside exactly one captionset, recompute that captionset's
   *  `coverage` from the captions actually present, and bump `mutatum`. Returns null when
   *  the dataset or the captionset does not exist — an unknown captionset is never created
   *  implicitly. Owner scoping lives at the API layer, as above. */
  setCaption(datasetId: string, captionsetId: string, mediaId: string, caption: string): Promise<Dataset | null>
}
