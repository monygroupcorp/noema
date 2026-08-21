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

import type { Fragment } from '../crystal/muse/taxonomy'

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
  /** Freeform operator labels. Optional: documents written before this field existed carry none. */
  tags?: string[]
  /** Freeform operator notes on this item. Optional for the same reason as `tags`. */
  notes?: string
  /** The item's decomposed prompt fragments (Muse — `src/crystal/muse/garden.ts`).
   *
   *  Written by the decompose job (`modus.dataset-decompose`,
   *  `src/crystal/MuseDecomposeCursor.ts`): a metered run over one captionset that decomposes
   *  each caption and writes the fragments back onto the media item that caption belongs to.
   *  That job is the only writer — `scripts/muse-roll.ts` prints a garden to the terminal and
   *  persists nothing.
   *
   *  Optional and commonly empty: an item nothing has decomposed yet is a valid, expected state,
   *  not an error — render it as an empty garden. Nothing decomposes live from this field; a
   *  decompose is always a run. */
  fragments?: Fragment[]
  /** When this item was archived. Absent means live.
   *
   *  A timestamp rather than a boolean, following the collection's own `natum`/`mutatum`
   *  naming: it records WHEN, and it makes a restore the removal of the field rather than a
   *  second flag to keep in step with the first.
   *
   *  Archived media leaves the working set — the caption manifest, the decompose, the
   *  summary count, the coverage denominator and Muse's fragment pool all read `liveMedia`
   *  — but the item itself stays on the record, because a captionset's caption map, an
   *  item's fragments and a past run's lineage are all keyed on `DatasetMediaItem.id`. */
  archivum?: Date
}

/** Archived — a dataset or a media item carrying an `archivum` timestamp. Absent means live. */
export function isArchived(x: { archivum?: Date }): boolean {
  return x.archivum != null
}

/** The media of a dataset still in the working set: everything not archived, in array order.
 *  Derived in ONE place so every reader of "the media of this dataset" agrees on what the set
 *  is — the caption manifest, the decompose, the summary count, the coverage denominator and
 *  Muse's fragment pool all resolve through here. */
export function liveMedia(media: DatasetMediaItem[]): DatasetMediaItem[] {
  return media.filter((m) => !isArchived(m))
}

/** A captionset's coverage over a dataset's LIVE media: the captions bound to a live media
 *  item, over the live media count. Archiving media moves BOTH sides of the fraction, so a
 *  pass reading `7/9` reads `7/7` once the two uncaptioned items are archived, rather than
 *  reporting a shortfall against images no longer in the set. Formats through
 *  `captionCoverage`, so the string is still built in exactly one place. */
export function coverageOver(captions: Record<string, string> | undefined, media: DatasetMediaItem[]): string {
  const live = liveMedia(media)
  const liveIds = new Set(live.map((m) => m.id))
  const bound = Object.fromEntries(Object.entries(captions ?? {}).filter(([mediaId]) => liveIds.has(mediaId)))
  return captionCoverage(bound, live.length)
}

/** One snapshot of the dataset's media set — grows as media is added. */
export interface DatasetVersion {
  v: string
  count: number
  when: Date
}

/**
 * The version string a media append records next, derived from the versions already on the
 * dataset. Derived in ONE place so the store and any double standing in for it cannot diverge.
 *
 * Scheme: `createDataset` mints `1.0.0` at creation, and an append takes the MINOR component —
 * `1.0.0` -> `1.1.0` -> `1.2.0`. Minor rather than patch because an append changes what the
 * dataset IS (its media set, and with it every captionset's coverage denominator), which is an
 * additive change to the record rather than a correction to it. A last entry that does not parse
 * as `x.y.z`, and an empty `versions`, both resolve to `1.1.0` — the first append off an
 * unreadable or absent history.
 */
export function nextDatasetVersion(versions: DatasetVersion[]): string {
  const last = versions[versions.length - 1]
  const m = last ? /^(\d+)\.(\d+)\.(\d+)$/.exec(last.v) : null
  if (!m) return '1.1.0'
  return `${m[1]}.${Number(m[2]) + 1}.0`
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
  /** When this dataset was archived. Absent means live.
   *
   *  An archived dataset is gone from `list` and `listSummaries` — the two reads a person's
   *  own listing and every picker are built on — and is unusable from them. It is NOT erased:
   *  `find` still resolves it, because a Muse session names a mother dataset, a saved piece
   *  lands in a session dataset, and a past run's lineage names media that must still resolve.
   *  Restoring is the removal of this field. */
  archivum?: Date
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

/** Media dropped in directly: already uploaded via `POST /storage/uploads/sign`
 *  (R2 signed-PUT), referenced by URL. */
export interface IngestMediaFromUpload {
  source: 'upload'
  /** URLs/keys returned by the storage-sign flow. */
  mediaUrls: string[]
}

/** Media resolved from an existing Actum's exitus (an already-completed run this
 *  caller owns). */
export interface IngestMediaFromGeneration {
  source: 'generation'
  /** FK[] -> Actum. Each must be owned by the caller and completus. */
  actumIds: string[]
}

/** How media enters a dataset. ONE discriminated shape, shared by dataset creation and by a
 *  later append, so both routes take the same body and mint items through the same path —
 *  a second ingestion shape would be a second place for the two to drift. */
export type IngestMediaInput = IngestMediaFromUpload | IngestMediaFromGeneration

/** Input to create a drop-media dataset. */
export interface CreateDatasetFromUpload extends IngestMediaFromUpload {
  name: string
  modality: DatasetModality
  custody?: DatasetCustody
}

/** Input to create a seed-from-generation dataset. */
export interface CreateDatasetFromGeneration extends IngestMediaFromGeneration {
  name: string
  modality: DatasetModality
  custody?: DatasetCustody
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
  /** Append media to a dataset. APPEND-ONLY: the supplied items are added after the media
   *  already present and nothing existing is replaced, reordered or dropped — every captionset's
   *  caption map is keyed on `DatasetMediaItem.id`, so a replace would detach every caption on
   *  the dataset.
   *
   *  Three things move together with the append, because all three are derived from the media
   *  set: `mutatum` is bumped (it is the pagination sort key), a `DatasetVersion` is appended
   *  whose `count` is the media count AFTER the append (`nextDatasetVersion` picks the string),
   *  and every existing captionset's `coverage` is recomputed against the new media count — a
   *  pass that read `7/7` reads `7/9` once two items land, rather than continuing to claim a
   *  completeness it no longer has.
   *
   *  Returns the updated dataset, or null when the dataset does not exist. Owner scoping is
   *  deliberately NOT a store concern — it is resolved at the API layer from the authenticated
   *  caller, as it is for `addCaptionset`/`setCaption`. */
  addMedia(datasetId: string, items: DatasetMediaItem[]): Promise<Dataset | null>
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
  /** Replace exactly one media item's decomposed fragments and bump `mutatum`. Returns null
   *  when the dataset does not exist or the media id does not name an item on it — a media id
   *  is never created implicitly, and fragments are never written positionally, because `media`
   *  is append-only and a positional write re-binds to a different item as soon as media is
   *  added. Owner scoping lives at the API layer, as above. */
  setFragments(datasetId: string, mediaId: string, fragments: Fragment[]): Promise<Dataset | null>
  /** Archive a dataset: stamp `archivum` and bump `mutatum`. `list` and `listSummaries` stop
   *  returning it; `find` still does, so every reference into it keeps resolving. Idempotent —
   *  an already-archived dataset keeps its original `archivum` and is returned unchanged.
   *  Returns null when the dataset does not exist. Owner scoping is resolved at the API layer
   *  from the authenticated caller, as it is for every other method here. */
  archiveDataset(datasetId: string): Promise<Dataset | null>
  /** Restore an archived dataset: remove `archivum` and bump `mutatum`. Idempotent on a live
   *  dataset. Returns null when the dataset does not exist. */
  restoreDataset(datasetId: string): Promise<Dataset | null>
  /** Archive ONE media item: stamp its `archivum`, bump `mutatum`, and recompute every
   *  captionset's `coverage` against the media that is left. The recomputation is not optional
   *  — coverage is stored, not derived at read time, so an archive that skipped it would leave
   *  a pass reading `7/9` against images no longer in the set. Idempotent. Returns null when
   *  the dataset does not exist or the media id names no item on it. */
  archiveMedia(datasetId: string, mediaId: string): Promise<Dataset | null>
  /** Restore ONE archived media item: remove its `archivum`, bump `mutatum`, and recompute
   *  every captionset's `coverage` against the media that is back. Idempotent. Returns null
   *  when the dataset does not exist or the media id names no item on it. */
  restoreMedia(datasetId: string, mediaId: string): Promise<Dataset | null>
}
