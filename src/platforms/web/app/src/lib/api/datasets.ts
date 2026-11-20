import { j } from './core';
import { authHeaders, readHeaders } from './session';

export interface DatasetSummary { id: string; name: string; images?: number; updatedAt?: string }

// Full dataset shape (GET /v1/data/datasets/full) — mirrors backend `types/dataset.ts#Dataset`.
export type DatasetModality = 'image' | 'video' | 'audio' | '3d';
export type DatasetCustody = 'sealed' | 'local' | 'remote';
// `captions` mirrors the server's `types/dataset.ts#Captionset`: caption text keyed by
// media id (never by position — media is append-only), sparse, and absent on captionsets
// written before the field existed.
export interface DatasetCaptionset { id: string; name: string; method: string; coverage: string; captions?: Record<string, string> }
// Mirrors the backend `types/dataset.ts#Fragment` (re-exported from `src/crystal/muse/taxonomy.ts`,
// which this app cannot import — `src/crystal` sits outside its `tsconfig.json`'s `include`). Kept
// as a flat union rather than importing the taxonomy's EXCLUSIVE/ATTRIBUTE tier split; the web app
// only needs to color-key a chip by category, not branch on tier.
export type FragmentCategory =
  | 'subject' | 'hair' | 'outfit' | 'pose' | 'expression' | 'props'
  | 'setting' | 'style' | 'palette' | 'lighting' | 'mood';
export interface Fragment { category: FragmentCategory; text: string; source: string; trigger: string }
export interface DatasetMediaItem {
  id: string; url: string; source: 'upload' | 'generation'; actumId?: string; addedAt: string;
  /** Freeform operator labels. Optional: items written before this field existed carry none. */
  tags?: string[];
  /** Freeform operator notes on this item. Optional for the same reason as `tags`. */
  notes?: string;
  /** The item's decomposed prompt fragments (Muse P0), filled out-of-band. Optional and commonly
   *  empty — an item nothing has decomposed yet is a valid, expected state, rendered as an empty
   *  garden, not an error. No live decompose happens from this field. */
  fragments?: Fragment[];
  /** Set when the item has been archived out of the working set. ISO string, as `addedAt` is;
   *  absent means live, including on an item written before the field existed. The item stays
   *  on the record so its caption and its fragments survive a restore, so this side is what
   *  stops rendering and counting it. */
  archivum?: string;
}
export interface DatasetVersionView { v: string; count: number; when: string }

export interface Dataset {
  id: string;
  owner: string;
  name: string;
  modality: DatasetModality;
  custody: DatasetCustody;
  media: DatasetMediaItem[];
  captionsets: DatasetCaptionset[];
  versions: DatasetVersionView[];
  natum: string;
  mutatum: string;
  /** Set when the set has been archived. Absent means live. An archived set is gone from both
   *  list routes, so it arrives here only as the response to an archive — which is what keeps
   *  the undo reachable on the screen that did it. */
  archivum?: string;
  /** Present with kind 'public' once published (setDatasetAccess) — listed in the catalog and
   *  readable/Muse-able by anyone. Absent means owner/team-only, the behaviour every dataset
   *  had before publishing existed. */
  access?: { kind: 'public' | 'private' };
}
// The body `POST /v1/data/datasets/:id/media` takes — the same discriminated ingestion
// shape as creation, minus the fields that only make sense when minting a set.
export type AddDatasetMediaRequest =
  | { source: 'upload'; mediaUrls: string[] }
  | { source: 'generation'; actumIds: string[] };
export type CreateDatasetRequest =
  | { source: 'upload'; name: string; modality: DatasetModality; custody?: DatasetCustody; mediaUrls: string[] }
  | { source: 'generation'; name: string; modality: DatasetModality; custody?: DatasetCustody; actumIds: string[] };

const datasetsApi = {
  // ── Training (modus.aitoolkit-training) — thin reads; launches go via createRun ──
  // Dataset list/create live under the internal data API (/v1/data/*). Kept thin:
  // the builder launches a training as a normal run, these only feed the picker/cost.
  listDatasets: () => fetch('/v1/data/datasets', { headers: readHeaders() })
    .then(j<{ datasets: DatasetSummary[] }>),
  // Full rich shape (custody, modality, captionsets, versions) — Datasets.tsx's live listing.
  listDatasetsFull: () => fetch('/v1/data/datasets/full', { headers: readHeaders() })
    .then(j<{ datasets: Dataset[] }>),
  createDataset: (body: CreateDatasetRequest) =>
    fetch('/v1/data/datasets', { method: 'POST', headers: authHeaders(), body: JSON.stringify(body) })
      .then(j<{ dataset: Dataset }>),
  // Append media to a dataset the caller owns. Same discriminated ingestion body as
  // `createDataset` and the same minting path server-side, so a set grows the way it was
  // seeded. APPEND-ONLY: nothing here removes, replaces or reorders media. The response
  // carries the WHOLE dataset back — a new version plus every captionset's recomputed
  // coverage — which is what a caller re-renders from; a locally patched copy would be a
  // version behind on both. A write, so it takes `authHeaders()` like its siblings: the
  // owner is resolved from the caller server-side and never from a parameter.
  addDatasetMedia: (id: string, body: AddDatasetMediaRequest) =>
    fetch(`/v1/data/datasets/${encodeURIComponent(id)}/media`, {
      method: 'POST', headers: authHeaders(), body: JSON.stringify(body),
    }).then(j<{ dataset: Dataset }>),
  // One dataset by id: list + find first (the caller's own datasets, cheap, and covers the
  // common case in one round trip), falling back to the direct read
  // (`GET /v1/data/datasets/:id`, noema-dataset-access-field) when the id isn't in that list —
  // which is exactly the case for a dataset the caller may READ but does not own: a public one
  // someone else made. `listDatasetsFull` stays owner+team scoped on purpose (mixing public
  // rows into it would conflate "your shelf" with "the catalog"), so this fallback is the only
  // way a public dataset's own id ever resolves here.
  getDatasetFull: (id: string) =>
    fetch('/v1/data/datasets/full', { headers: readHeaders() })
      .then(j<{ datasets: Dataset[] }>)
      .then(({ datasets }) => datasets.find((d) => d.id === id) ?? datasetsApi.getDataset(id)),
  // The direct single-dataset read. Resolves for the owner, a team member, or anyone when the
  // dataset's access is public; not_found otherwise (never forbidden — ids stay
  // non-enumerable). Auth required, unlike `listPublicDatasets` below — reading ONE dataset by
  // id still needs an identified caller, same as every other dataset route.
  getDataset: (id: string): Promise<Dataset | null> =>
    fetch(`/v1/data/datasets/${encodeURIComponent(id)}`, { headers: readHeaders() })
      .then(j<{ dataset: Dataset }>)
      .then(({ dataset }) => dataset)
      .catch(() => null),
  // Merge dataset `id` into an already-fetched list when it is missing from it — the fallback
  // every list-then-find screen needs (Datasets.tsx via Dataset.tsx/Muse.tsx) for a dataset the
  // caller may read but does not own: `listDatasetsFull` never contains it, so this is the one
  // extra request that makes it resolvable anyway. A no-op when `id` is absent, already
  // present, or unreadable by the caller (`getDataset` resolves null, not a thrown error).
  withDatasetFallback: async (ds: Dataset[], id: string | undefined): Promise<Dataset[]> => {
    if (!id || ds.some((d) => d.id === id)) return ds;
    const found = await datasetsApi.getDataset(id);
    return found ? [...ds, found] : ds;
  },
  // The public dataset catalog — every dataset with access.kind 'public', scoped to nobody in
  // particular. Public, no auth (mirrors listModels): browsing what the platform publishes
  // does not require an account, though USING one (spawning a Muse session, appending media)
  // still does.
  listPublicDatasets: (opts: { cursor?: string; limit?: number } = {}) => {
    const params = new URLSearchParams();
    if (opts.cursor) params.set('cursor', opts.cursor);
    if (opts.limit !== undefined) params.set('limit', String(opts.limit));
    const qs = params.toString();
    return fetch(`/v1/data/datasets/public${qs ? `?${qs}` : ''}`)
      .then(j<{ datasets: Dataset[]; nextCursor?: string }>);
  },
  // PATCH one caption inside one captionset. Captionsets are editable after generation; the
  // server recomputes that captionset's coverage from the captions present and returns the
  // whole dataset back.
  setCaption: (datasetId: string, captionsetId: string, mediaId: string, caption: string) =>
    fetch(
      `/v1/data/datasets/${encodeURIComponent(datasetId)}/captionsets/${encodeURIComponent(captionsetId)}/captions/${encodeURIComponent(mediaId)}`,
      { method: 'PATCH', headers: authHeaders(), body: JSON.stringify({ caption }) },
    ).then(j<{ dataset: Dataset }>),

  // ── Archive (the delete that strands nothing) ────────────────────────────
  // Archiving a set takes it out of both list routes and out of every picker built on them.
  // It is not an erasure: the record stays, so a Muse session naming it as a mother dataset,
  // a session dataset behind a saved piece and a past run's lineage all keep resolving. Each
  // of the four calls returns the WHOLE dataset back, which is what a caller re-renders from.
  // Writes, so they take `authHeaders()`: ownership is resolved from the caller server-side
  // and never from a parameter.
  // Publish (kind: 'public') or unpublish (kind: 'private') a dataset the caller owns — makes
  // it listed in GET /v1/data/datasets/public and readable/Muse-able by anyone, or takes it back
  // out. Owner-only, like archive/restore below; a team member's attempt 404s the same way.
  setDatasetAccess: (id: string, kind: 'public' | 'private') =>
    fetch(`/v1/data/datasets/${encodeURIComponent(id)}/access`, {
      method: 'POST', headers: authHeaders(), body: JSON.stringify({ kind }),
    }).then(j<{ dataset: Dataset }>).then(({ dataset }) => dataset),
  archiveDataset: (id: string) =>
    fetch(`/v1/data/datasets/${encodeURIComponent(id)}/archive`, { method: 'POST', headers: authHeaders() })
      .then(j<{ dataset: Dataset }>).then(({ dataset }) => dataset),
  restoreDataset: (id: string) =>
    fetch(`/v1/data/datasets/${encodeURIComponent(id)}/restore`, { method: 'POST', headers: authHeaders() })
      .then(j<{ dataset: Dataset }>).then(({ dataset }) => dataset),
  // One media item. The item leaves the dataset's working set — the media a caption pass or a
  // decompose reads, and every captionset's coverage, which the server recomputes against what
  // is left — while staying on the record, because caption maps and fragments are keyed on its
  // id and have to survive the restore.
  archiveDatasetMedia: (datasetId: string, mediaId: string) =>
    fetch(
      `/v1/data/datasets/${encodeURIComponent(datasetId)}/media/${encodeURIComponent(mediaId)}/archive`,
      { method: 'POST', headers: authHeaders() },
    ).then(j<{ dataset: Dataset }>).then(({ dataset }) => dataset),
  restoreDatasetMedia: (datasetId: string, mediaId: string) =>
    fetch(
      `/v1/data/datasets/${encodeURIComponent(datasetId)}/media/${encodeURIComponent(mediaId)}/restore`,
      { method: 'POST', headers: authHeaders() },
    ).then(j<{ dataset: Dataset }>).then(({ dataset }) => dataset),
};

export default datasetsApi;
