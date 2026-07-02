// =============================================================================
// ModelImporter — import a model/LoRA by URL as a private, owner-scoped Intella
// =============================================================================
//
// Tier 1 of docs/spec/model-import.md. Importing a Civitai / HuggingFace /
// direct-file URL creates an `Intella` owned by the importer that resolves ONLY
// for them (`access:'private'`, `ownerAnimaId`, `canonica:false`) and is usable
// in their flows at once — no gatekeeping on personal use.
//
// CUSTODY DECISION (2026-07-02): a private import is registered ORIGIN-ONLY for
// its WEIGHTS — `sources[0]` points at the origin (Civitai/HF/direct), NOT a copy
// in our R2. We deliberately do NOT custody third-party BYO weights for personal
// use (the `BYO = user` liability boundary; project_compliance_posture) and it
// saves storing every random import. The pod downloads the weights from the origin
// (auth-free origins work immediately; gated origins await the BYO-secrets seam).
// The R2 weight mirror happens ONLY on PUBLIC PROMOTION (BucketAdapter._hostModel).
//
// PREVIEW MEDIA is the exception: the small preview image(s) ARE re-hosted into our
// bucket (when a store is wired). Two reasons: (1) the CSAM/NCMEC scan must be
// meaningful — we host the exact bytes we display, not a URL an uploader can swap
// after the scan (no TOCTOU); (2) we control what renders in our UI/feed rather
// than hot-linking a third-party host. Ordering is fail-closed: SCAN the origin
// URL first (never write unscanned bytes to our bucket), then re-host on pass.
//
// Idempotent: the Intella id is DERIVED from (ownerAnimaId, origin uri), so
// re-importing the same URL upserts the same record instead of minting duplicates.
//
// The resolver is injected; the fetcher/store are optional (absent → previews stay
// origin-referenced, e.g. dev/tests). Unit-testable end-to-end with no network.
// =============================================================================

import { createHash } from 'node:crypto'
import type { Intella } from '../types/intelligendi.js'
import type { Uploader } from './R2Uploader.js'
import type { MediaFetcher } from './MediaFetcher.js'
import type { ModerationGate } from './ModerationGate.js'
import type { IntellaWriter } from './trainingFinalizer.js'
import { ModelImportError, resolveImport, type ImportHint, type JsonFetcher } from './modelImportResolver.js'
import { makeLogger } from '../lib/logger.js'

const log = makeLogger('cursor:import')

export interface ImportModelInput {
  url: string
  /** FK → Anima. The importer — owner of the private Intella. */
  ownerAnimaId: string
  /** genus hint for a direct-file URL (no scrape to infer it). Default 'lora'. */
  genus?: 'lora' | 'model'
}

export interface ModelImporterDeps {
  /** Origin metadata seam (Civitai/HF JSON). Injected → hermetic. */
  json: JsonFetcher
  /** The Intella write seam — `MongoIntella.upsert` satisfies it. */
  intellae: IntellaWriter
  /** Trust-boundary CSAM/NCMEC scan for preview media (fail-closed). */
  moderationGate: ModerationGate
  /** OUR R2 bucket — re-hosts PREVIEW media only (never weights). Absent → previews
   *  stay origin-referenced (dev/tests). */
  store?: Uploader
  /** Fetches preview bytes to re-host. Required alongside `store` to re-host previews. */
  fetcher?: MediaFetcher
  /** R2 key prefix for re-hosted previews — default 'model-previews'. */
  previewPrefix?: string
  now?: () => Date
}

export class ModelImporter {
  private readonly now: () => Date
  private readonly previewPrefix: string

  constructor(private readonly deps: ModelImporterDeps) {
    this.now = deps.now ?? (() => new Date())
    this.previewPrefix = deps.previewPrefix ?? 'model-previews'
  }

  /**
   * Import the URL as a private Intella owned by `ownerAnimaId`. Resolves + scrapes
   * origin metadata, CSAM-scans any preview media (fail-closed) then re-hosts it, and
   * registers the Intella ORIGIN-ONLY for weights (`sources[0]` = origin,
   * `access:'private'`, `canonica:false`). Idempotent per (owner, url). Throws
   * `ModelImportError` on a refused import.
   */
  async import(input: ImportModelInput): Promise<Intella> {
    if (!input.ownerAnimaId) throw new ModelImportError('an owner identity is required to import a model')
    const hint: ImportHint = input.genus ? { genus: input.genus } : {}
    const resolved = await resolveImport(input.url, { json: this.deps.json }, hint)

    // Deterministic id — same (owner, origin) re-import upserts the same record (dedup).
    const id = `import-${createHash('sha256').update(`${input.ownerAnimaId}|${resolved.origin.uri}`).digest('hex').slice(0, 24)}`

    // Gate (legal, always): any preview media crossing the trust boundary is CSAM/NCMEC-scanned
    // BEFORE we register or re-host anything. Fail-closed — the default gate DENIES when no real
    // scanner is configured (dev/staging opts in via MODERATION_ALLOW_UNSCANNED). We scan the ORIGIN
    // url so unscanned bytes never touch our bucket; on pass we re-host that exact media below.
    let samples = resolved.samples
    if (samples?.length) {
      const verdict = await this.deps.moderationGate.scan({
        ref: { kind: 'intella', id: `import:${resolved.slug}` },
        output: { samples },
        by: { animaId: input.ownerAnimaId },
      })
      if (!verdict.ok) throw new ModelImportError(`preview media rejected by the safety scan: ${verdict.reason}`)
      samples = await this.rehostPreviews(id, samples)
    }

    const intella: Intella = {
      id,
      nomen: resolved.nomen,
      genus: resolved.genus,
      architectura: resolved.genus === 'lora' ? 'lora' : 'unknown',
      parametri: 0,
      // Origin-only weights: the pod downloads from the origin. A public promotion later prepends
      // an our-bucket `miladystation` source (BucketAdapter + _reconcile).
      sources: [resolved.origin],
      dest: resolved.dest,
      sizeGb: (resolved.sizeBytes ?? 0) / 1e9,
      versio: '1.0.0',
      canonica: false,            // NOT on the public catalogue
      access: 'private',          // owner-scoped resolution (buildAccessOrClauses)
      ownerAnimaId: input.ownerAnimaId,
      auctor: input.ownerAnimaId,
      familia: resolved.familia,
      // License axis (SEPARATE from familia): recorded for display + audit + the public-promotion
      // commercial gate. A private import is allowed regardless; only PUBLIC promotion checks it.
      license: resolved.license,
      commercialUse: resolved.commercialUse,
      slug: resolved.slug,
      ...(resolved.trigger ? { trigger: resolved.trigger } : {}),
      ...(resolved.description ? { description: resolved.description } : {}),
      ...(samples?.length ? { samples } : {}),
      ...(resolved.tags?.length ? { tags: resolved.tags } : {}),
      ...(resolved.provenance ? { provenance: resolved.provenance } : {}),
      natum: this.now(),
    }
    await this.deps.intellae.upsert(intella)
    log.info('model imported (origin-only, private)', { id, genus: intella.genus, familia: intella.familia, provenance: resolved.origin.provenance, owner: input.ownerAnimaId })
    return intella
  }

  /**
   * Re-host scanned preview images into our bucket so what we display == what we scanned (and we
   * don't hot-link a swappable third-party URL). Best-effort per image: a fetch/upload failure
   * falls back to the origin URL — a preview must never sink an import. A no-op (returns the
   * origin samples) when no store/fetcher is wired.
   */
  private async rehostPreviews(
    id: string,
    samples: Array<{ url: string; prompt?: string }>,
  ): Promise<Array<{ url: string; prompt?: string }>> {
    const { store, fetcher } = this.deps
    if (!store || !fetcher) return samples
    return Promise.all(samples.map(async (s, i) => {
      try {
        const bytes = await fetcher.fetch(s.url)
        const ext = previewExt(s.url)
        const hosted = await store.put(`${this.previewPrefix}/${id}/${String(i).padStart(3, '0')}${ext}`, bytes, contentTypeFor(ext))
        return { url: hosted, ...(s.prompt ? { prompt: s.prompt } : {}) }
      } catch (err) {
        log.warn('preview re-host failed, keeping origin url', { id, url: s.url, error: String(err) })
        return s
      }
    }))
  }
}

/** The image extension of a preview URL (defaults to .jpg when absent/unknown). */
function previewExt(url: string): string {
  const base = url.split('?')[0].split('#')[0]
  const m = base.match(/\.(png|jpe?g|webp|gif)$/i)
  return m ? `.${m[1].toLowerCase()}` : '.jpg'
}

function contentTypeFor(ext: string): string {
  switch (ext) {
    case '.png': return 'image/png'
    case '.webp': return 'image/webp'
    case '.gif': return 'image/gif'
    default: return 'image/jpeg'
  }
}
