// =============================================================================
// modelImportResolver — a Civitai / HuggingFace / direct-file URL → import plan
// =============================================================================
//
// Net-new #2 of docs/spec/model-import.md. The PURE, hermetic front half of
// "import by URL": parse the URL, scrape the origin's metadata, and produce a
// resolved plan the `ModelImporter` turns into a private `Intella`.
//
// This re-expresses the legacy `loraImportService.js` + the two import handlers
// (`loraImportApi.js` / `modelImportApi.js`) crystal-first. What carries over:
//   - Civitai page + `?modelVersionId` URLs, HF repo URLs, direct-file URLs
//   - metadata scrape (name / base → familia / triggers / tags / author / preview)
//   - base → checkpoint-family mapping (reject unsupported bases)
//   - the `r2.dev`-host download rejection policy
// What is DROPPED: the ComfyDeploy volume-fetch path — crystal installs via
// `ModelInstaller` from the origin source (a private import is origin-only; the R2
// mirror happens only on public promotion), so the origin download URL is all we
// resolve here.
//
// The one I/O seam is `JsonFetcher` (the origin metadata API), injected so the
// whole resolver is unit-testable against fixture JSON with no network.
// =============================================================================

import type { IntellaSource } from '../types/intelligendi.js'
import { classifyBaseModel, licenseCommercial, hfLicenseToId, civitaiCommercial, combineCommercial, type CommercialVerdict } from './modelLicense.js'

/** A refused import — a bad URL, an unsupported base, or a disallowed host. */
export class ModelImportError extends Error {
  /** HTTP status when the refusal came from an origin metadata fetch (401/403 → gated). */
  readonly status?: number
  constructor(message: string, status?: number) {
    super(message)
    this.name = 'ModelImportError'
    if (status !== undefined) this.status = status
  }
}

/**
 * A gated origin (private Civitai/HF) rejected the metadata fetch because no usable BYO token was
 * attached — the owner must connect (or reconnect) a `provider` secret before the import can proceed.
 * Distinct from a generic `ModelImportError` so the API can surface a typed `secret.required` signal
 * the frontend deep-links to Profile → Connected accounts (docs/handoff BYO-secrets §4 / F2).
 */
export class SecretRequiredError extends ModelImportError {
  constructor(readonly provider: ImportSecretProvider) {
    super(`this ${provider} model is gated — connect a ${provider} token to import it`, 401)
    this.name = 'SecretRequiredError'
  }
}

/** The origin metadata seam — a JSON GET. Injected (real impl below; fake in tests).
 *  `opts.headers` carries an owner's BYO auth for GATED origins (attached by `secretJsonFetcher`). */
export interface JsonFetcher {
  fetchJson(url: string, opts?: { headers?: Record<string, string> }): Promise<unknown>
}

/** The real fetcher — global fetch (Node 18+). Throws `ModelImportError` on a non-OK response. */
export const httpJsonFetcher: JsonFetcher = {
  async fetchJson(url: string, opts?: { headers?: Record<string, string> }): Promise<unknown> {
    const res = await fetch(url, opts?.headers ? { headers: opts.headers } : undefined)
    if (!res.ok) throw new ModelImportError(`origin metadata fetch failed: ${url} → ${res.status}`, res.status)
    return res.json()
  },
}

/** The BYO-secret providers whose metadata origins can be gated. */
export type ImportSecretProvider = 'civitai' | 'huggingface'

/** Which gated provider (if any) owns a metadata URL's host — drives BYO-token attachment. */
export function importSecretProviderForUrl(url: string): ImportSecretProvider | null {
  if (url.includes('civitai.com')) return 'civitai'
  if (url.includes('huggingface.co')) return 'huggingface'
  return null
}

/**
 * Wrap a base `JsonFetcher` so gated Civitai/HF metadata requests carry the owner's BYO token
 * as an `Authorization: Bearer` header. `resolveToken(provider)` is a server-side capability
 * (backed by `Secretarium.resolve`) — the plaintext is used to set the header and NEVER returned
 * to the caller. Auth-free hosts (and owners with no stored secret) pass through unchanged.
 */
export function secretJsonFetcher(
  base: JsonFetcher,
  resolveToken: (provider: ImportSecretProvider) => Promise<string | null>,
): JsonFetcher {
  return {
    async fetchJson(url: string, opts?: { headers?: Record<string, string> }): Promise<unknown> {
      const provider = importSecretProviderForUrl(url)
      const token = provider ? await resolveToken(provider) : null
      if (!token) return base.fetchJson(url, opts)
      const headers = { ...(opts?.headers ?? {}), Authorization: `Bearer ${token}` }
      return base.fetchJson(url, { headers })
    },
  }
}

/** The resolved plan the importer mirrors + registers. */
export interface ResolvedImport {
  genus: 'lora' | 'model'
  /** The LoRA-compat family key (exact-equality; see Intella.familia). */
  familia: string
  /** License id of the imported artifact (base license folded with the origin's own). Display + audit. */
  license: string
  /**
   * The descriptive base string this import was classified from (e.g. the Civitai
   * `version.baseModel`, the HF `base_model`/tag-list/repo string, or a direct file's parsed
   * filename stem) — the SAME string `requireBase()`/`classifyBaseModel` derived `familia`/
   * `license` from. Mirrors `Intella.baseModel` (docs/spec/model-base-provenance.md §3): every
   * genus gets one classifier-usable field, not "trained LoRAs use `baseModel`, imports fall back
   * to `nomen`."
   */
  baseModel: string
  /** Catalog-eligibility verdict (fail-closed). Only 'yes' may be promoted to the public catalog. */
  commercialUse: CommercialVerdict
  nomen: string
  slug: string
  trigger?: string
  /** ComfyUI dest relative to /root/ComfyUI/models/ — 'loras/<slug>.safetensors' etc. */
  dest: string
  description?: string
  tags?: Array<{ tag: string; source?: string }>
  /** Preview media (CSAM-scanned at import, fail-closed — see ModelImporter). */
  samples?: Array<{ url: string; prompt?: string }>
  /** External lineage backlink for the model card. */
  provenance?: { repo: string; base?: string }
  /** The origin download source — `sources[0]` on a private import (the pod fetches from here;
   *  a public promotion later prepends an our-bucket `miladystation` source ahead of it). */
  origin: IntellaSource
  /** Direct byte-download URL for the weights (== `origin.uri`; the promotion mirror fetches it). */
  downloadUrl: string
  /** Weight filename — the object name a promotion mirror hosts under. */
  filename: string
  /** Byte size when the origin metadata reports it. */
  sizeBytes?: number
}

/** Optional caller hints — used only where the origin can't determine a field (direct files). */
export interface ImportHint {
  /** genus for a direct-file URL (no scrape to infer it). Default 'lora'. */
  genus?: 'lora' | 'model'
}

const DISALLOWED_DOWNLOAD_HOSTS = ['r2.dev'] // vanity-host download policy (carried from legacy)

/**
 * Resolve a Civitai / HuggingFace / direct-file URL into an import plan.
 * Throws `ModelImportError` for an unsupported URL, an unmappable base model, or a
 * disallowed download host.
 */
export async function resolveImport(url: string, deps: { json: JsonFetcher }, hint: ImportHint = {}): Promise<ResolvedImport> {
  const u = (url ?? '').trim()
  if (!u) throw new ModelImportError('a model URL is required')

  let resolved: ResolvedImport
  try {
    if (u.includes('civitai.com')) {
      resolved = await resolveCivitai(u, deps.json)
    } else if (u.includes('huggingface.co')) {
      resolved = await resolveHuggingFace(u, deps.json)
    } else if (/\.(safetensors|ckpt)(\?|#|$)/i.test(u)) {
      resolved = resolveDirect(u, hint)
    } else {
      throw new ModelImportError('unsupported URL — provide a Civitai page, a HuggingFace repo, or a direct .safetensors/.ckpt link')
    }
  } catch (err) {
    // A gated origin rejecting the metadata fetch with 401/403 means the owner's BYO token is missing
    // or invalid — re-throw as a typed `SecretRequiredError` so the caller can point them at connecting
    // one, rather than a raw "fetch failed: … → 401" the frontend can't distinguish.
    const provider = importSecretProviderForUrl(u)
    if (provider && err instanceof ModelImportError && (err.status === 401 || err.status === 403)) {
      throw new SecretRequiredError(provider)
    }
    throw err
  }

  assertHostAllowed(resolved.downloadUrl)
  return resolved
}

// ── Civitai ───────────────────────────────────────────────────────────────

async function resolveCivitai(url: string, json: JsonFetcher): Promise<ResolvedImport> {
  const modelId = firstMatch(url, /civitai\.com\/models\/(\d+)/)
  if (!modelId) throw new ModelImportError('could not extract a Civitai model id from the URL')
  const versionId = firstMatch(url, /[?&]modelVersionId=(\d+)/)

  const data = asRecord(await json.fetchJson(`https://civitai.com/api/v1/models/${modelId}`))
  if (!data) throw new ModelImportError(`could not fetch Civitai metadata for model ${modelId}`)

  // Civitai `type` drives genus: LORA / LoCon / LyCORIS → lora, Checkpoint → model.
  const typeStr = String(data.type ?? '').toLowerCase()
  const genus: 'lora' | 'model' = typeStr.includes('lora') || typeStr.includes('lycoris') || typeStr.includes('locon') ? 'lora' : 'model'

  const versions = Array.isArray(data.modelVersions) ? data.modelVersions.map(asRecord).filter(Boolean) as Record<string, unknown>[] : []
  const version = (versionId ? versions.find((v) => String(v.id) === versionId) : versions[0]) ?? versions[0]
  if (!version) throw new ModelImportError(`no version data for Civitai model ${modelId}`)

  const files = Array.isArray(version.files) ? version.files.map(asRecord).filter(Boolean) as Record<string, unknown>[] : []
  const file = files.find((f) => weightUrl(String(f.name ?? '')) || weightUrl(String(f.downloadUrl ?? '')))
  if (!file?.downloadUrl) throw new ModelImportError('no .safetensors/.ckpt file found on the Civitai version')
  const downloadUrl = String(file.downloadUrl)

  const baseModelStr = String(version.baseModel ?? '')
  const { familia, license: baseLicense } = requireBase(baseModelStr)
  // Commercial verdict = the base license folded with Civitai's OWN per-model permission (a LoRA
  // whose uploader forbids commercial use can't out-license itself — most-restrictive wins).
  const commercialUse = combineCommercial(licenseCommercial(baseLicense), civitaiCommercial(data))
  const nomen = String(data.name ?? version.name ?? `civitai-${modelId}`)
  const filename = weightFilename(String(file.name ?? ''), downloadUrl, genus)
  const trigger = joinTriggers(version.trainedWords)
  const slug = slugify(filename.replace(/\.(safetensors|ckpt)$/i, '') || nomen)
  const description = descriptionOf(version.description ?? data.description)
  const tags = mapTags(data.tags, 'civitai')
  const previewUrl = firstImageUrl(version.images)
  const sizeBytes = sizeBytesOf(file)
  const author = asRecord(data.creator)?.username

  return {
    genus,
    familia,
    license: baseLicense,
    commercialUse,
    nomen,
    slug,
    baseModel: baseModelStr,
    ...(trigger ? { trigger } : {}),
    dest: destFor(genus, slug, filename),
    ...(description ? { description } : {}),
    ...(tags ? { tags } : {}),
    ...(previewUrl ? { samples: [{ url: previewUrl }] } : {}),
    provenance: { repo: `civitai:${modelId}`, base: baseModelStr },
    origin: {
      provenance: 'civitai',
      uri: downloadUrl,
      format: formatOf(filename),
      meta: {
        modelId: String(modelId),
        modelVersionId: String(version.id ?? versionId ?? ''),
        ...(author ? { author } : {}),
        ...(data.nsfw !== undefined ? { originNsfw: data.nsfw } : {}),
        ...(data.nsfwLevel !== undefined ? { originNsfwLevel: data.nsfwLevel } : {}),
      },
    },
    downloadUrl,
    filename,
    ...(sizeBytes !== undefined ? { sizeBytes } : {}),
  }
}

// ── HuggingFace ─────────────────────────────────────────────────────────────

async function resolveHuggingFace(url: string, json: JsonFetcher): Promise<ResolvedImport> {
  // `[^/?#]+` already stops the repo at the first `/` (…/tree/main), `?`, or `#`.
  const repo = firstMatch(url, /huggingface\.co\/([^/]+\/[^/?#]+)/)
  if (!repo) throw new ModelImportError('could not extract a HuggingFace repo id from the URL')

  const data = asRecord(await json.fetchJson(`https://huggingface.co/api/models/${repo}`))
  if (!data) throw new ModelImportError(`could not fetch HuggingFace metadata for ${repo}`)

  const cardData = asRecord(data.cardData) ?? {}
  const tagList = Array.isArray(data.tags) ? data.tags.map(String) : []
  const baseModel = String(cardData.base_model ?? cardData.baseModel ?? '')

  // Resolve the installable file FIRST (before family): only a ROOT-level single weight file works
  // via ModelInstaller (one URL → one dest). A repo whose weights live only in subfolders (`unet/…`,
  // `text_encoder/model.safetensors`) is a multi-file `diffusers` layout — reject it (with the
  // useful reason) rather than grab a random component or fail on an unmappable family first.
  const siblings = Array.isArray(data.siblings) ? data.siblings.map(asRecord).filter(Boolean) as Record<string, unknown>[] : []
  const isWeight = (s: Record<string, unknown>): boolean => weightUrl(String(s.rfilename ?? ''))
  const weight = siblings.find((s) => isWeight(s) && !String(s.rfilename).includes('/'))
  if (!weight) {
    if (siblings.some(isWeight)) {
      throw new ModelImportError(`'${repo}' looks like a multi-file diffusers repo (weights only in subfolders) — only single-file .safetensors/.ckpt models or LoRAs are supported`)
    }
    throw new ModelImportError(`no .safetensors/.ckpt file found in HuggingFace repo ${repo}`)
  }
  const filename = String(weight.rfilename)
  const downloadUrl = `https://huggingface.co/${repo}/resolve/main/${filename}`

  // A HF repo declaring a base_model (or tagged lora) is an adapter; otherwise a full model.
  const genus: 'lora' | 'model' = baseModel || tagList.some((t) => t.toLowerCase().includes('lora')) ? 'lora' : 'model'
  // Family: the declared base_model, else a family tag (flux/sdxl/sd15), else the repo name.
  const baseModelStr = baseModel || tagList.join(' ') || repo
  const { familia, license: baseLicense } = requireBase(baseModelStr)
  // The repo's OWN `cardData.license` is authoritative for the artifact and may be stricter than the
  // base (e.g. a cc-by-nc LoRA on an apache base) — fold, most-restrictive wins. Prefer the repo's
  // stated license id for display when known; keep the base id otherwise.
  const hfLicense = hfLicenseToId(cardData.license)
  const license = hfLicense !== 'unknown' ? hfLicense : baseLicense
  const commercialUse = combineCommercial(licenseCommercial(baseLicense), licenseCommercial(hfLicense))

  const nomen = String(cardData.title ?? repo.split('/')[1] ?? repo)
  const slug = slugify(filename.replace(/\.(safetensors|ckpt)$/i, '') || nomen)
  const trigger = joinTriggers(cardData.trigger_words ?? cardData.triggerWords ?? cardData.instance_prompt)
  const description = descriptionOf(cardData.description)
  const tags = mapTags(tagList, 'huggingface')
  const author = String(data.author ?? repo.split('/')[0] ?? '')
  const previewUrl = hfPreviewUrl(repo, siblings)

  return {
    genus,
    familia,
    license,
    commercialUse,
    nomen,
    slug,
    baseModel: baseModelStr,
    ...(trigger ? { trigger } : {}),
    dest: destFor(genus, slug, filename),
    ...(description ? { description } : {}),
    ...(tags ? { tags } : {}),
    ...(previewUrl ? { samples: [{ url: previewUrl }] } : {}),
    provenance: { repo, ...(baseModel ? { base: baseModel } : {}) },
    origin: {
      provenance: 'huggingface',
      uri: downloadUrl,
      format: formatOf(filename),
      meta: { repo, branch: 'main', filename, ...(author ? { author } : {}) },
    },
    downloadUrl,
    filename,
  }
}

// ── Direct file ───────────────────────────────────────────────────────────

function resolveDirect(url: string, hint: ImportHint): ResolvedImport {
  const genus = hint.genus ?? 'lora'
  const filename = decodeURIComponent((url.split('?')[0].split('#')[0].split('/').pop() ?? '').trim()) || 'model.safetensors'
  const stem = filename.replace(/\.(safetensors|ckpt)$/i, '')
  // No metadata to scrape — infer the family from the filename, else reject with guidance.
  const { familia, license } = classifyBaseModel(stem)
  if (!familia) {
    throw new ModelImportError(`could not determine the base model family from '${filename}' — import from a Civitai or HuggingFace page so the base can be read`)
  }
  // A bare file carries NO license metadata beyond what the base family implies; the base license
  // alone can't clear the commercial catalog for a direct upload → fail-closed 'unknown' unless the
  // base is unambiguously permissive (e.g. an apache-clean family inferred from the name).
  const commercialUse = licenseCommercial(license)
  const slug = slugify(stem)
  return {
    genus,
    familia,
    license,
    commercialUse,
    nomen: stem || slug,
    slug,
    baseModel: stem,
    dest: destFor(genus, slug, filename),
    origin: { provenance: 'custom', uri: url, format: formatOf(filename) },
    downloadUrl: url,
    filename,
  }
}

// ── Family + license classification ───────────────────────────────────────────

/**
 * The compat `familia` for a base string (thin wrapper over `classifyBaseModel`). NULL = no base
 * flow → not importable. `familia` is the COMPATIBILITY axis ONLY; the license is a separate axis
 * (schnell vs dev both → 'flux' but differ) — see `classifyBaseModel` / `modelLicense.ts`.
 */
export function mapToFamilia(text: string): string | null {
  return classifyBaseModel(text).familia
}

const SUPPORTED_FAMILIAE = 'flux, flux2, sdxl, sd15, chroma, krea2, zimage'

/** Classify a base string → its compat family (required, else reject) + base license id. */
function requireBase(baseModel: string): { familia: string; license: string } {
  const { familia, license } = classifyBaseModel(baseModel)
  if (!familia) {
    throw new ModelImportError(`unsupported or undetermined base model: '${baseModel || 'not specified'}' (supported: ${SUPPORTED_FAMILIAE})`)
  }
  return { familia, license }
}

// ── Helpers ───────────────────────────────────────────────────────────────

function assertHostAllowed(downloadUrl: string): void {
  let host: string
  try {
    host = new URL(downloadUrl).hostname
  } catch {
    throw new ModelImportError(`invalid download URL: ${downloadUrl}`)
  }
  if (DISALLOWED_DOWNLOAD_HOSTS.some((h) => host.includes(h))) {
    throw new ModelImportError(`downloads from '${host}' are not permitted`)
  }
}

function destFor(genus: 'lora' | 'model', slug: string, filename: string): string {
  if (genus === 'lora') return `loras/${slug}.safetensors`
  return `checkpoints/${slug}.${formatOf(filename)}`
}

function formatOf(filename: string): 'safetensors' | 'ckpt' {
  return /\.ckpt$/i.test(filename) ? 'ckpt' : 'safetensors'
}

function weightFilename(name: string, downloadUrl: string, genus: 'lora' | 'model'): string {
  const fromName = name && weightUrl(name) ? name : ''
  const fromUrl = (downloadUrl.split('?')[0].split('#')[0].split('/').pop() ?? '')
  const base = fromName || (weightUrl(fromUrl) ? fromUrl : '') || `${genus}.safetensors`
  return decodeURIComponent(base)
}

/** True when a name/URL points at a weight file we accept. */
function weightUrl(s: string): boolean {
  return /\.(safetensors|ckpt)(\?|#|$)/i.test(s)
}

function slugify(s: string): string {
  return (s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'model'
}

function joinTriggers(words: unknown): string | undefined {
  const arr = Array.isArray(words) ? words : typeof words === 'string' ? [words] : []
  const cleaned = arr.map((w) => String(w).trim()).filter((w) => w.length > 0 && w.length < 100)
  return cleaned.length ? cleaned.join(',') : undefined
}

function descriptionOf(raw: unknown): string | undefined {
  if (typeof raw !== 'string') return undefined
  const text = raw.replace(/<[^>]*>?/g, '').trim().slice(0, 1500)
  return text.length ? text : undefined
}

function firstImageUrl(images: unknown): string | undefined {
  if (!Array.isArray(images)) return undefined
  for (const img of images) {
    const url = asRecord(img)?.url
    if (typeof url === 'string' && url.length > 0) return url
  }
  return undefined
}

function hfPreviewUrl(repo: string, siblings: Record<string, unknown>[]): string | undefined {
  const img = siblings.find((s) => {
    const f = String(s.rfilename ?? '').toLowerCase()
    return /\.(png|jpg|jpeg|webp)$/.test(f) && /(preview|sample|example|cover|thumbnail)/.test(f)
  }) ?? siblings.find((s) => /\.(png|jpg|jpeg|webp)$/i.test(String(s.rfilename ?? '')))
  return img ? `https://huggingface.co/${repo}/resolve/main/${String(img.rfilename)}` : undefined
}

/** Normalise a raw tag list into the Intella `{ tag, source }[]` shape (or undefined if empty). */
function mapTags(tags: unknown, source: string): Array<{ tag: string; source?: string }> | undefined {
  if (!Array.isArray(tags)) return undefined
  const out = tags.map((t) => ({ tag: String(t).trim(), source })).filter((t) => t.tag.length > 0)
  return out.length ? out : undefined
}

function sizeBytesOf(file: Record<string, unknown> | undefined): number | undefined {
  if (!file) return undefined
  const kb = Number(file.sizeKB)
  return Number.isFinite(kb) && kb > 0 ? Math.round(kb * 1024) : undefined
}

function firstMatch(s: string, re: RegExp): string | undefined {
  const m = s.match(re)
  return m ? m[1] : undefined
}

function asRecord(v: unknown): Record<string, unknown> | undefined {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : undefined
}
