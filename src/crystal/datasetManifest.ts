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

import type { Corpus, Corporum } from '../types/corpus.js'

/** One training image: where to fetch it, and its caption if we have one. */
export interface ManifestItem {
  url: string
  caption?: string
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
 * Parse an inline manifest — a JSON array of `{url, caption?}`. Returns `null`
 * (not throws) when `raw` isn't a manifest, so the resolver can fall through to
 * a corpus lookup. Entries missing a string `url` are rejected (returns null).
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
    if (typeof url !== 'string' || !url) return null
    out.push(typeof caption === 'string' && caption.trim() ? { url, caption: caption.trim() } : { url })
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
