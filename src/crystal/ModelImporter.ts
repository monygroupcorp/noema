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
// PREVIEW MEDIA: the small preview image(s) are CSAM/NCMEC-scanned at their ORIGIN
// url, always, before anything is registered or re-hosted. On a PASS they are
// re-hosted into our bucket (when a store is wired) for two reasons: (1) the scan
// stays meaningful — we host the exact bytes we display, not a URL an uploader can
// swap after the scan (no TOCTOU); (2) we control what renders in our UI/feed
// rather than hot-linking a third-party host.
//
// On a NON-PASS the import PROCEEDS and the previews stay origin-referenced —
// hot-linked, never copied (ruling 2026-08-11, noema-192). A private import is
// owner-only and is not a moderation boundary; PUBLIC PROMOTION is, and it re-scans
// independently (CrystalApi `isModelPromotion`). Relaxing (1) and (2) is deliberate
// and scoped to the private case: the owner is the only viewer and chose the URL
// themselves. noema-193 restores both at promotion. The invariant that does NOT
// relax: unscanned bytes are never written to our bucket.
//
// Idempotent: the Intella id is DERIVED from (ownerAnimaId, origin uri), so
// re-importing the same URL upserts the same record instead of minting duplicates.
//
// The resolver is injected; the fetcher/store are optional (absent → previews stay
// origin-referenced, e.g. dev/tests). Unit-testable end-to-end with no network.
// =============================================================================

import { createHash } from 'node:crypto'
import type { Intella, IntellaContentRating } from '../types/intelligendi.js'
import type { Uploader } from './R2Uploader.js'
import type { MediaFetcher } from './MediaFetcher.js'
import type { ModerationGate } from './ModerationGate.js'
import type { IntellaWriter } from './trainingFinalizer.js'
import { ModelImportError, resolveImport, type ImportHint, type JsonFetcher } from './modelImportResolver.js'
import { makeLogger } from '../lib/logger.js'

const log = makeLogger('cursor:import')

export interface ImportModelInput {
  url: string
  /** Generic owner key (`ownerKeyOf(auctor)`). The importer — owner of the private Intella.
   *  Anon-capable: a Bursa purse is a valid owner. */
  ownerKey: string
  /** Owner's animaId when the owner is an anima (populates `Intella.ownerAnimaId` for display +
   *  legacy resolution). Absent for a purse/commitment owner. */
  ownerAnimaId?: string
  /** genus hint for a direct-file URL (no scrape to infer it). Default 'lora'. */
  genus?: 'lora' | 'model'
}

export interface ModelImporterDeps {
  /** Origin metadata seam (Civitai/HF JSON) for AUTH-FREE origins. Injected → hermetic. */
  json: JsonFetcher
  /** Owner-scoped gated fetcher factory — wraps `json` with the owner's BYO token (server-side,
   *  `Secretarium.resolve` in the closure). Present → gated Civitai/HF metadata scrape works;
   *  absent → gated origins fall back to the auth-free `json` (public metadata only). A legitimate
   *  `resolve` consumer per the Secretarium ASYMMETRY — never exposed to CrystalApi/router. */
  gatedFetcherFor?: (ownerKey: string) => JsonFetcher
  /** The Intella write seam — `MongoIntella.upsert` satisfies it. `find` is an OPTIONAL read the
   *  same store already exposes: when present (as on `MongoIntella`), a re-import reads the
   *  existing record so a rating a human already decided is never rewritten by the derivation
   *  below. A writer without `find` (read-less fakes) simply derives on every import. */
  intellae: IntellaWriter & { find?(id: string): Promise<Intella | null> }
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

/**
 * Derive an imported model's adult-content rating from the origin's own flag.
 *
 * Pure — takes the raw `origin.meta` the resolver captured (the origin's fields are stored
 * unmapped there) and returns a rating. No I/O, no clock, no deps, and it never throws:
 * `origin.meta` is a loosely-typed record and a malformed value must not sink an import.
 *
 *   `originNsfw` true  (or the string `'true'`)  → 'explicit'
 *   `originNsfw` false (or the string `'false'`) → 'sfw'
 *   absent, or any other value                   → 'untriaged'
 *
 * ONLY that boolean is read. Civitai publishes a numeric `nsfwLevel` alongside it, and that
 * number is an AGGREGATE BITMASK OVER THE COMMUNITY IMAGES POSTED TO A MODEL'S GALLERY — not a
 * statement about the model. Probed against the live API on 2026-08-10: DreamShaper reads 15,
 * Juggernaut XL 31, Pony Diffusion V6 XL 7 and a hands-fixing LoRA 31, every one of them with the
 * boolean `false`, because somebody posted a spicy image to the gallery. Thresholding that number
 * would rate the most mainstream checkpoints in existence as adult and hide them from the catalog.
 * Do not "improve" this function by reading the level — the guard test
 * `tests/unit/architecture/importContentRating.test.ts` enforces its absence.
 *
 * 'suggestive' is unreachable from here BY DESIGN: the origin publishes a binary, so a binary is
 * all that can honestly be derived. It stays a human-triage-only value.
 */
export function deriveImportContentRating(
  meta: Record<string, unknown> | undefined,
): IntellaContentRating {
  const flag = meta?.['originNsfw']
  if (flag === true || flag === 'true') return 'explicit'
  if (flag === false || flag === 'false') return 'sfw'
  return 'untriaged'
}

export class ModelImporter {
  private readonly now: () => Date

  constructor(private readonly deps: ModelImporterDeps) {
    this.now = deps.now ?? (() => new Date())
  }

  /**
   * Import the URL as a private Intella owned by `ownerAnimaId`. Resolves + scrapes
   * origin metadata, CSAM-scans any preview media, and registers the Intella
   * ORIGIN-ONLY for weights (`sources[0]` = origin, `access:'private'`,
   * `canonica:false`). The scan is unconditional; its VERDICT decides only whether
   * the previews are re-hosted into our bucket (pass) or left origin-referenced
   * (non-pass) — a non-pass does not refuse the import (noema-192; public promotion
   * re-scans independently and IS the moderation boundary). Idempotent per
   * (owner, url). Throws `ModelImportError` when the owner identity is missing or
   * the URL cannot be resolved to a supported origin.
   */
  async import(input: ImportModelInput): Promise<Intella> {
    if (!input.ownerKey) throw new ModelImportError('an owner identity is required to import a model')
    const hint: ImportHint = input.genus ? { genus: input.genus } : {}
    // Gated origins (private Civitai/HF) need the owner's BYO token; the factory wraps `json` with
    // it server-side. Auth-free origins (and owners with no stored secret) use plain `json`.
    const json = this.deps.gatedFetcherFor ? this.deps.gatedFetcherFor(input.ownerKey) : this.deps.json
    const resolved = await resolveImport(input.url, { json }, hint)

    // Deterministic id — same (owner, origin) re-import upserts the same record (dedup). The dedup
    // key is the animaId for anima owners (STABLE — keeps existing import ids) and the ownerKey for
    // a purse/commitment owner (no animaId to key on).
    const idOwner = input.ownerAnimaId ?? input.ownerKey
    const id = `import-${createHash('sha256').update(`${idOwner}|${resolved.origin.uri}`).digest('hex').slice(0, 24)}`

    // Gate (legal, always): any preview media crossing the trust boundary is CSAM/NCMEC-scanned
    // BEFORE we register or re-host anything. Fail-closed — the default gate DENIES when no real
    // scanner is configured (dev/staging opts in via MODERATION_ALLOW_UNSCANNED). We scan the ORIGIN
    // url so unscanned bytes never touch our bucket; on pass we re-host that exact media below.
    let samples = resolved.samples
    if (samples?.length) {
      const verdict = await this.deps.moderationGate.scan({
        ref: { kind: 'intella', id: `import:${resolved.slug}` },
        output: { samples },
        // Attribute to the anima when there is one; a purse/commitment import scans unattributed.
        ...(input.ownerAnimaId ? { by: { animaId: input.ownerAnimaId } } : {}),
      })
      // Non-fatal (noema-192): a non-pass keeps the previews origin-referenced instead of sinking
      // the import. Skipping rehostPreviews is what holds the real invariant — no unscanned bytes
      // reach our bucket. The scan itself stays unconditional so the verdict is still billed/cached.
      if (verdict.ok) {
        samples = await rehostPreviews(id, samples, this.deps)
      } else {
        log.warn('preview scan did not pass; previews stay origin-referenced (not re-hosted)', {
          id,
          reason: verdict.reason,
        })
      }
    }

    // Rating: DERIVED as a default, never a downgrade. `upsert` is a full replace on the
    // deterministic id, so a re-import would otherwise reset a rating a human already decided.
    // Read the existing record first (through the read the store already exposes) and keep any
    // decided rating; only an absent or 'untriaged' one is (re-)derived. A read failure is
    // non-fatal — fall back to the derived value rather than sink the import.
    let decided: IntellaContentRating | undefined
    try {
      decided = (await this.deps.intellae.find?.(id))?.contentRating
    } catch (err) {
      log.warn('could not read the existing record; deriving the rating', { id, error: String(err) })
    }
    const rating = decided && decided !== 'untriaged' ? decided : deriveImportContentRating(resolved.origin.meta)

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
      contentRating: rating,      // derived from the origin's own flag (spec §9)
      access: 'private',          // owner-scoped resolution (buildAccessOrClauses)
      ownerKey: input.ownerKey,   // generic owner (Bursa-capable) — the resolution gate
      // Legacy display/resolution field — only when the owner is an anima.
      ...(input.ownerAnimaId ? { ownerAnimaId: input.ownerAnimaId } : {}),
      auctor: input.ownerAnimaId ?? input.ownerKey,
      familia: resolved.familia,
      // License axis (SEPARATE from familia): recorded for display + audit + the public-promotion
      // commercial gate. A private import is allowed regardless; only PUBLIC promotion checks it.
      license: resolved.license,
      commercialUse: resolved.commercialUse,
      // The same classifier-usable base descriptor `familia`/`license` were derived from (§3,
      // docs/spec/model-base-provenance.md) — imports already classify correctly; this just gives
      // every genus one consistent field for a later reclassify to read.
      ...(resolved.baseModel ? { baseModel: resolved.baseModel } : {}),
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

}

/**
 * Re-host scanned preview images into our bucket so what we display == what we scanned (and we
 * don't hot-link a swappable third-party URL). Best-effort per image: a fetch/upload failure
 * falls back to the origin URL — a preview must never sink an import. A no-op (returns the
 * origin samples) when no store/fetcher is wired.
 *
 * Exported standalone (not just a `ModelImporter` private method) so another scan-then-store
 * caller — the legacy-preview rescan migration — reuses this EXACT logic rather than
 * reimplementing it and drifting apart from the import path.
 */
export async function rehostPreviews(
  id: string,
  samples: Array<{ url: string; prompt?: string }>,
  deps: Pick<ModelImporterDeps, 'store' | 'fetcher' | 'previewPrefix'>,
): Promise<Array<{ url: string; prompt?: string }>> {
  const { store, fetcher } = deps
  if (!store || !fetcher) return samples
  const previewPrefix = deps.previewPrefix ?? 'model-previews'
  return Promise.all(samples.map(async (s, i) => {
    try {
      const bytes = await fetcher.fetch(s.url)
      const ext = previewExt(s.url)
      const hosted = await store.put(`${previewPrefix}/${id}/${String(i).padStart(3, '0')}${ext}`, bytes, contentTypeFor(ext))
      return { url: hosted, ...(s.prompt ? { prompt: s.prompt } : {}) }
    } catch (err) {
      log.warn('preview re-host failed, keeping origin url', { id, url: s.url, error: String(err) })
      return s
    }
  }))
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
