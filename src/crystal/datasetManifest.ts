// =============================================================================
// Dataset → manifest resolver (remote training)
// =============================================================================
//
// The LOCAL training cursor reads a dataset from a path on the operator's disk.
// A REMOTE pod has no such disk — it pulls each image over the network. Rather
// than tarball + ship the whole dataset (legacy `DatasetPacker`), we hand the
// pod a small MANIFEST: one `{ url, caption? }` per image. User uploads already
// live in R2 as individual objects, and captions live in Mongo (the Corpus'
// `exemplaria[].titulus`), so the manifest is just a projection of what we have.
//
// The pod downloads each `url` in parallel (the same media-fetch mechanism
// inference uses) and writes a `NNN.txt` sidecar from `caption`, yielding the
// image+caption directory ai-toolkit expects.
//
// One resolver, two inputs:
//   • a `corpusId`        → looked up via `Corporum` → projected to a manifest
//   • an inline manifest  → a JSON `[{url,caption?}]` string, passed through
// The inline form lets a one-off stager (e.g. the koh spike) hand a manifest
// directly before the dataset lives in a Corpus; production resolves by id.
//
// A Dataset projects here too (`datasetToManifest`), for the batch caption job: same wire
// shape, each entry additionally carrying the media item's `id` so the pod can echo it back
// on the harvest instead of the host re-deriving identity from a position. That projection
// takes an optional captionset to EXTEND, and stages only the media that captionset does not
// already cover.

import type { Corpus, Corporum } from '../types/corpus.js'
import { liveMedia } from '../types/dataset.js'
import type { Captionset, Dataset, DatasetMediaItem } from '../types/dataset.js'

/** One training image: where to fetch it, and its caption if we have one. */
export interface ManifestItem {
  url: string
  caption?: string
  /**
   * Stable identity of the source item (a `DatasetMediaItem.id`) — OPTIONAL and additive.
   *
   * The pod names every staged file by MANIFEST INDEX (`stage_dataset` writes `0000.png`), so an
   * index is the only handle a pod-side artifact carries on its own. A dataset's `media` array is
   * append-only, so an index mapped back to a media item AFTER the job ran can land on a different
   * item than the one that was staged. Echoing the id out through the manifest and back in through
   * the harvest takes the index out of the round trip entirely.
   *
   * Optional because `corpusToManifest` / `parseManifest` are shared with the training launch,
   * which has no dataset media ids to supply — a manifest without ids is valid input, not an error.
   */
  id?: string
}

/** The wire shape handed to the pod — one entry per image. */
export type DatasetManifest = ManifestItem[]

/** An exemplar counts as a training image when its MIME type is an image/*. */
function isImage(genus: string): boolean {
  return genus.startsWith('image/')
}

/**
 * Project a Corpus to a manifest — its image exemplaria, each with its caption
 * (`titulus`) when present. Non-image exemplaria (text pairs, etc.) are dropped:
 * an image LoRA trains on images. Pure + deterministic (order preserved).
 */
export function corpusToManifest(corpus: Corpus): DatasetManifest {
  return corpus.exemplaria
    .filter(e => isImage(e.genus))
    .map(e => {
      const caption = e.titulus?.trim()
      return caption ? { url: e.ref, caption } : { url: e.ref }
    })
}

/**
 * The live media a caption pass has work to do on.
 *
 * With no `captionset`, that is the whole working set — the pass mints a new captionset and
 * captions everything in it. Given a captionset to EXTEND, it is the live media that captionset
 * carries no non-empty caption for: the pass adds to the layer rather than rebuilding it.
 *
 * Archived media is never work: a caption pass captions the working set, and an archived item
 * has left it. Coverage is read off the caption MAP rather than the stored `coverage` string, so
 * the set of work is derived from the captions that actually exist.
 *
 * Pure + deterministic (media order preserved). Shared by the launcher, which stages exactly
 * this, and by the cursor, which refuses a pass with nothing in it before a pod is provisioned.
 */
export function uncoveredMedia(dataset: Dataset, captionset?: Captionset | null): DatasetMediaItem[] {
  const live = liveMedia(dataset.media)
  if (!captionset) return live
  const captions = captionset.captions ?? {}
  return live.filter(m => {
    const text = captions[m.id]
    return typeof text !== 'string' || text.trim() === ''
  })
}

/**
 * Project a Dataset to a manifest — the media a caption pass has work to do on (see
 * `uncoveredMedia`) in array order, each carrying the media item's `id` so a pod-side artifact
 * can be bound back to the exact item that was staged (see `ManifestItem.id`).
 *
 * FILTERING IS WHAT SAVES THE SPEND. The pod's captioner runs with `recaption: false` and skips
 * an image that arrives with a `.txt` sidecar, so shipping the existing captions instead would
 * also avoid re-captioning — but the pod DOWNLOADS every url in the manifest before it can skip
 * anything. Work an extending pass is not doing should never leave the server, so the media is
 * dropped here rather than the captions being shipped for the pod to skip on.
 *
 * Emits NO `caption` field. A staged image is one this pass is captioning, and handing the
 * captioner a caption for it would make the pass return a copy of what it was given.
 */
export function datasetToManifest(dataset: Dataset, captionset?: Captionset | null): DatasetManifest {
  return uncoveredMedia(dataset, captionset).map(m => ({ url: m.url, id: m.id }))
}

/**
 * Parse an inline manifest — a JSON array of `{url, caption?, id?}`. Returns `null`
 * (not throws) when `raw` isn't a manifest, so the resolver can fall through to
 * a corpus lookup. Entries missing a string `url` are rejected (returns null); an
 * absent `id` is valid input (the training path never supplies one).
 */
export function parseManifest(raw: string): DatasetManifest | null {
  const trimmed = raw.trim()
  if (!trimmed.startsWith('[')) return null
  let parsed: unknown
  try {
    parsed = JSON.parse(trimmed)
  } catch {
    return null
  }
  if (!Array.isArray(parsed)) return null
  const out: DatasetManifest = []
  for (const item of parsed) {
    if (!item || typeof item !== 'object') return null
    const url = (item as Record<string, unknown>).url
    const caption = (item as Record<string, unknown>).caption
    const id = (item as Record<string, unknown>).id
    if (typeof url !== 'string' || !url) return null
    out.push({
      url,
      ...(typeof caption === 'string' && caption.trim() ? { caption: caption.trim() } : {}),
      ...(typeof id === 'string' && id ? { id } : {}),
    })
  }
  return out
}

/** Resolve a dataset reference (a corpusId or an inline manifest) to a manifest. */
export interface DatasetResolver {
  resolve(ref: string): Promise<DatasetManifest>
}

/**
 * The production resolver: an inline JSON manifest passes through; otherwise the
 * ref is a `corpusId` looked up via `Corporum` and projected. Throws when the
 * corpus is missing or yields no training images — a remote train can't proceed
 * without a dataset, so fail loud at resolve time, not on the pod.
 */
export function makeDatasetResolver(deps: { corpora: Corporum }): DatasetResolver {
  return {
    async resolve(ref: string): Promise<DatasetManifest> {
      const inline = parseManifest(ref)
      if (inline) {
        if (inline.length === 0) throw new Error('dataset manifest is empty')
        return inline
      }
      const corpus = await deps.corpora.find(ref)
      if (!corpus) throw new Error(`dataset not found: ${ref}`)
      const manifest = corpusToManifest(corpus)
      if (manifest.length === 0) throw new Error(`dataset ${ref} has no image exemplaria`)
      return manifest
    },
  }
}
