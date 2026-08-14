import type { Actum } from '../types/actum.js'
import type { Modus } from '../types/modus.js'
import type { Captionset, Datasets } from '../types/dataset.js'
import type { MediaFetcher } from './MediaFetcher.js'

// =============================================================================
// captionFinalizer — a completed caption run → a persisted captionset
// =============================================================================
//
// The finality half of the dataset caption job, shaped like `trainingFinalizer`: an
// injected impure reader, a pure core, one store write.
//
// The pod uploaded a JSON object mapping `DatasetMediaItem.id → caption` and reported its
// URL on the completion webhook. This fetches that map, validates it against the dataset,
// writes it as a `Captionset`, and returns the exitus the run receipt carries.
//
// Two properties this file owns:
//
//  · IDENTITY IS ECHOED, NEVER RECOMPUTED. The pod names staged files by manifest index, so
//    an index is not an identity: `media` is append-only and can grow while a pod runs, which
//    would silently re-point an index at a different item. The manifest carries each item's id
//    out and the harvest carries it back, so nothing here derives a media id from a position.
//
//  · KEYS ARE VALIDATED HERE. `Datasets.addCaptionset` writes whatever keys it is handed and
//    derives `coverage` from their count; key validation against `dataset.media` lives at the
//    API layer, which this path does not go through (it calls the store directly, exactly as
//    `trainingFinalizer` calls `intellae.upsert` directly). So an id that is not on the dataset
//    fails the job here rather than being written — a caption bound to nothing would still be
//    counted, and `coverage` would read complete.
// =============================================================================

/** Fetch the harvested `{mediaId: caption}` map the pod uploaded. Impure; injected. */
export type CaptionHarvestReader = (url: string) => Promise<Record<string, string>>

export interface CaptionFinalizerDeps {
  reader: CaptionHarvestReader
  datasets: Pick<Datasets, 'find' | 'addCaptionset'>
  /** Captioner recorded on the captionset — default 'Qwen3-VL', the model the pod config runs. */
  method?: string
}

/** The completion shape the caption finalizer needs off the webhook. */
export interface CaptionOutcome {
  /** URL of the JSON `{mediaId: caption}` object the pod uploaded. */
  outputUrl?: string
}

/** The finalizer closure `makeCaptionFinalizer` returns. */
export type CaptionFinalize = (actum: Actum, outcome: CaptionOutcome) => Promise<Record<string, unknown>>

/**
 * Build the caption job's finality: read the harvest, validate it against the dataset, and
 * persist it as a captionset.
 *
 * Inputs come off `actum.aditus` (the caption modus' contract):
 *   - `dataset` → the dataset the captionset is attached to (REQUIRED)
 *   - `name`    → the captionset's display name (defaults to a generated one)
 *   - `jobId`   → the run handle the captionset id is derived from (defaults to the actum id)
 *
 * The captionset id is derived from the job id, so re-running a caption pass under the same job
 * REPLACES its captionset rather than appending a second one (`addCaptionset` replaces by id).
 * Hand-edits made through `setCaption` are simply later writes onto the same captionset.
 *
 * `coverage` is deliberately not computed here — the store derives it from the captions actually
 * present over the media count, and a second computation is a second thing to drift.
 */
export function makeCaptionFinalizer(deps: CaptionFinalizerDeps): CaptionFinalize {
  const method = deps.method ?? 'Qwen3-VL'

  return async (actum, outcome) => {
    const a = actum.aditus
    const datasetId = typeof a.dataset === 'string' ? a.dataset.trim() : ''
    if (!datasetId) throw new Error('caption finality: run carried no `dataset`')
    const jobId = String(a.jobId ?? actum.id)

    const url = outcome.outputUrl
    if (!url) throw new Error('caption finality: completion carried no caption output URL')

    const dataset = await deps.datasets.find(datasetId)
    if (!dataset) throw new Error(`caption finality: dataset not found: ${datasetId}`)

    // Read the harvest, then bind every key to a media item that is actually on the dataset. An
    // unknown id fails the job: it must never be written and never counted (see the header).
    const harvest = await deps.reader(url)
    const known = new Set(dataset.media.map((m) => m.id))
    const captions: Record<string, string> = {}
    for (const [mediaId, caption] of Object.entries(harvest)) {
      if (!known.has(mediaId)) {
        throw new Error(`caption finality: harvested caption for an id that is not on dataset ${datasetId}`)
      }
      if (typeof caption !== 'string') {
        throw new Error(`caption finality: harvested caption is not text for one of the dataset's media items`)
      }
      const text = caption.trim()
      if (text) captions[mediaId] = text
    }

    const captionset: Captionset = {
      id: `captionset-${jobId}`,
      name: (typeof a.name === 'string' && a.name.trim()) || `Captions ${jobId}`,
      method,
      // Placeholder: `addCaptionset` derives the real value from the captions present over the
      // dataset's media count. Carried only because the field is required on the type.
      coverage: '',
      captions,
    }

    const updated = await deps.datasets.addCaptionset(datasetId, captionset)
    if (!updated) throw new Error(`caption finality: dataset not found at write: ${datasetId}`)
    const written = updated.captionsets.find((c) => c.id === captionset.id)

    return {
      captionsetId: captionset.id,
      captioned: Object.keys(captions).length,
      coverage: written?.coverage ?? '',
    }
  }
}

/**
 * Adapt the finalizer to the execution webhook's `resolveExitus` seam. For a completed caption
 * run (matched by `ministerium`) it reads the harvest URL off the webhook's output items and runs
 * finality → `{ captionsetId, captioned, coverage }`. Returns null for any other modus, so the
 * webhook falls through to the next resolver / the generic `projectExitus`.
 */
export function makeCaptionExitusResolver(
  finalize: CaptionFinalize,
  ministerium = 'aitkcaption',
): ExitusResolver {
  return async (actum, modus, outputItems) => {
    if (modus?.ministerium !== ministerium) return null
    const url = firstUrl(outputItems)
    if (!url) throw new Error('caption finality: completion carried no caption output URL')
    return finalize(actum, { outputUrl: url })
  }
}

/** The webhook's `resolveExitus` shape — a completion either resolves to an exitus or declines. */
export type ExitusResolver = (
  actum: Actum,
  modus: Modus | null,
  outputItems: Array<{ url?: string; path?: string; kind?: string } | string>,
) => Promise<Record<string, unknown> | null>

/**
 * Compose several ministerium-specific exitus resolvers into the ONE `resolveExitus` slot the
 * webhook router has, returning the first non-null result.
 *
 * The slot is single, and each resolver already declines (returns null) for a ministerium that
 * is not its own — that is what makes composition safe and what makes replacement dangerous:
 * passing one resolver alone in that slot leaves the other's completions to fall through to the
 * generic projection, so a finished training run would no longer host its LoRA or register its
 * Intella while still reporting success. Order does not matter; reachability does.
 */
export function composeExitusResolvers(...resolvers: Array<ExitusResolver | undefined>): ExitusResolver | undefined {
  const active = resolvers.filter((r): r is ExitusResolver => typeof r === 'function')
  if (active.length === 0) return undefined
  if (active.length === 1) return active[0]
  return async (actum, modus, outputItems) => {
    for (const resolve of active) {
      const resolved = await resolve(actum, modus, outputItems)
      if (resolved !== null) return resolved
    }
    return null
  }
}

/** The first resolvable URL among the webhook's output items (string or `{ url }`). */
function firstUrl(items: Array<{ url?: string; path?: string; kind?: string } | string>): string | undefined {
  for (const it of items) {
    if (typeof it === 'string' && it.length > 0) return it
    if (it && typeof it === 'object' && typeof it.url === 'string' && it.url.length > 0) return it.url
  }
  return undefined
}

/**
 * Production `CaptionHarvestReader`: the pod uploaded the `{mediaId: caption}` map to R2 and
 * reported its URL; fetch those bytes and parse them. Hermetic in tests (a fake `MediaFetcher`).
 * A body that is not a flat JSON object of strings fails the job rather than being coerced.
 */
export function urlCaptionHarvestReader(fetcher: MediaFetcher): CaptionHarvestReader {
  return async (url) => {
    const bytes = await fetcher.fetch(url)
    let parsed: unknown
    try {
      parsed = JSON.parse(bytes.toString('utf8'))
    } catch {
      throw new Error('caption finality: harvested captions are not valid JSON')
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('caption finality: harvested captions are not a {mediaId: caption} object')
    }
    return parsed as Record<string, string>
  }
}
