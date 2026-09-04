import { v4 as uuidv4 } from 'uuid'
import type { Actum } from '../types/actum.js'
import type { Intella, IntellaSource } from '../types/intelligendi.js'
import type { Uploader, ObjectStore } from './R2Uploader.js'
import type { MediaFetcher } from './MediaFetcher.js'
import type { AitkOutcome } from './aitoolkitRunnerClient.js'
import { buildAitkConfig, canonicalFamilia, resolveBasePreset, DEFAULT_SAMPLE_PROMPTS, parseSamplePrompts } from './aitkConfig.js'
import { classifyBaseModel, licenseCommercial, licenseNote } from './modelLicense.js'
import { parseManifest } from './datasetManifest.js'

// =============================================================================
// trainingFinalizer — a completed local training run's `resolveOutput` (Slice B)
// =============================================================================
//
// The `AitoolkitTrainingCursor` trains a LoRA onto the host disk and leaves the
// exitus open (`resolveOutput`, default `{ trained, steps }`). This wires the
// finality: a `completed` run's safetensors is
//   1. read off the host-mounted output dir (`LoraReader` — the impure shell),
//   2. hosted in OUR R2 bucket (`Uploader.put` → a durable miladystation URL),
//   3. registered as a private `lora` Intella carrying `familia` — so `/make`'s
//      trigger-map resolver finds it the moment training finishes.
// Exitus carries the ids (`loraId`, `loraUrl`) so the run receipt + Slice C's
// modus contract can surface them.
//
// custody = ours, access = private: training NEVER auto-publishes. Pushing the
// LoRA to HF / the feed / a mint stays a separate, user-invoked Editio step.
//
// The hosting + Intella mapping is the pure, hermetic core (injected fakes in
// tests). Only the `LoraReader` touches the filesystem; `fsLoraReader` is its
// production shell (untested, like `DockerAitkSpawner`).
// =============================================================================

/** The trained artifact lifted off the host after a completed run. */
export interface LoraArtifact {
  bytes: Buffer
  /** The safetensors basename (becomes the hosted object + the `dest` stem). */
  filename: string
}

/** Locate + read a completed run's LoRA off the host. Impure; injected. */
export type LoraReader = (jobId: string, outcome: AitkOutcome) => Promise<LoraArtifact>

/** The single Intella write seam training needs — `MongoIntella.upsert` satisfies it. */
export interface IntellaWriter {
  upsert(intella: Intella): Promise<void>
}

export interface TrainingFinalizerDeps {
  reader: LoraReader
  store: Uploader
  intellae: IntellaWriter
  /** R2 key prefix for hosted weights — default 'models' (matches BucketAdapter). */
  modelPrefix?: string
  /** Injectable id/clock for deterministic tests. */
  newId?: () => string
  now?: () => Date
}

/**
 * Build the production `resolveOutput` for the training cursor. Reads the trained
 * LoRA, hosts it in R2, registers it as an Intella, and returns the exitus ids.
 *
 * Inputs come off `actum.aditus` (the training modus' contract, Slice C):
 *   - `triggerWord` → the LoRA `trigger` + `slug` (slugified)
 *   - `familia` / `baseModel` → the compat key `/make` resolves on (REQUIRED for discovery)
 *   - `baseIntellaId` → provenance: the exact base it trained against (optional)
 *   - `ownerAnimaId` → owner of the private LoRA (optional)
 *   - `name` → display `nomen` (defaults to the trigger / jobId)
 *
 * A private LoRA is owner-scoped: `/make` resolves it ONLY for its `ownerAnimaId`.
 * So an owner-less run still hosts the weights + records the Intella, but that record
 * is archival (the headless-operator path) — not yet applicable until an owner is set.
 */
export function makeTrainingFinalizer(
  deps: TrainingFinalizerDeps,
): (actum: Actum, outcome: AitkOutcome) => Promise<Record<string, unknown>> {
  const prefix = deps.modelPrefix ?? 'models'
  const newId = deps.newId ?? uuidv4
  const now = deps.now ?? (() => new Date())

  return async (actum, outcome) => {
    const a = actum.aditus
    const jobId = String(a.jobId ?? actum.id)
    const trigger = typeof a.triggerWord === 'string' ? a.triggerWord.trim() : ''
    // slug = the published repo name + dest stem. Defaults to the trigger, but is overridable so a
    // model can publish under a name that differs from its invocation trigger (e.g. backlog repo
    // `333flux-klein` whose /make trigger stays `333`).
    const slugSource = (typeof a.slug === 'string' && a.slug.trim()) || trigger || jobId
    const slug = slugify(slugSource)
    // familia = the LoRA-compat key /make resolves on. `triggerMap` matches it by EXACT equality, so
    // every route into this field is canonicalised: an explicit `familia` selects the value, the
    // `baseModel` supplies it otherwise, and both then collapse aliases to the base flow's exact key
    // (e.g. 'krea-turbo' → 'krea2', 'z-image-turbo' → 'zimage'). Canonicalising the explicit branch
    // too closes the one path that could write an alias straight through; `canonicalFamilia` is
    // idempotent for already-canonical values, so a caller passing the exact key is unaffected.
    const explicitFamilia = typeof a.familia === 'string' && a.familia.trim() ? a.familia : ''
    const familia = canonicalFamilia(explicitFamilia || String(a.baseModel ?? ''))
    const nomen = (typeof a.name === 'string' && a.name.trim()) || trigger || jobId

    // Base descriptor (docs/spec/model-base-provenance.md): `a.baseModel` is a short preset ALIAS
    // ('klein-4b'), not a descriptive string — `classifyBaseModel`'s matchers need the real HF
    // identifier ('black-forest-labs/FLUX.2-klein-base-4B') to recognise it at all. Resolve the
    // alias to its preset descriptor when it names a trainable preset (the standard local-training
    // path — `buildAitkConfig` already resolved this same alias to LAUNCH the job, so this repeat
    // resolution only ever fails for a value that was never a preset key to begin with). Anything
    // else (a full descriptive string already, or unresolvable) falls back to the raw value —
    // matching the classifier's pre-existing behaviour for those inputs.
    let baseDescriptor: string
    try {
      baseDescriptor = resolveBasePreset(String(a.baseModel ?? '')).nameOrPath
    } catch {
      baseDescriptor = String(a.baseModel ?? '')
    }

    // License (SEPARATE axis from familia) — a trained LoRA inherits its BASE's license, so it's
    // classified from the resolved base descriptor. Recorded on the Intella (gate) AND surfaced on
    // the exitus receipt so the owner is told at completion whether the model is commercially
    // listable (training UX).
    const { license } = classifyBaseModel(baseDescriptor)
    const commercialUse = licenseCommercial(license)

    // Model-card enrichment (optional aditus): the requested step count, a human description,
    // and external retrain lineage (source repo + base) for the card's provenance backlink.
    const steps = typeof a.steps === 'number' ? a.steps : outcome.lastStep
    const description = typeof a.description === 'string' && a.description.trim() ? a.description.trim() : undefined
    const provRepo = typeof a.provenanceRepo === 'string' ? a.provenanceRepo.trim() : ''
    const provenance = provRepo
      ? { repo: provRepo, ...(typeof a.provenanceBase === 'string' && a.provenanceBase.trim() ? { base: a.provenanceBase.trim() } : {}) }
      : undefined

    // Repro artifacts (first-class on the Intella; the publisher commits them too):
    //  • samples — the pod's preview URLs paired with the prompts they were rendered from
    //    (DEFAULT_SAMPLE_PROMPTS, trigger-substituted, by index — the pod never reports prompts).
    //  • datasetItems — the training images + captions (from the run's dataset manifest).
    //  • configYaml — the ai-toolkit config, regenerated with a repo-relative dataset path so a
    //    downloader can reproduce against the committed `dataset/` folder.
    const samplePrompts = (parseSamplePrompts(a.samplePrompts) ?? DEFAULT_SAMPLE_PROMPTS)
      .map((p) => p.replace(/\[trigger\]/g, trigger || slug))
    const samples = (outcome.sampleUrls ?? [])
      .filter((u) => typeof u === 'string' && u.length > 0)
      .map((url, i) => (samplePrompts[i] ? { url, prompt: samplePrompts[i] } : { url }))
    const datasetItems = typeof a.dataset === 'string' ? (parseManifest(a.dataset) ?? undefined) : undefined
    let configYaml: string | undefined
    if (a.baseModel && typeof steps === 'number') {
      try {
        const cfgPrompts = parseSamplePrompts(a.samplePrompts)
        configYaml = buildAitkConfig({
          name: slug, datasetPath: 'dataset', triggerWord: trigger || slug,
          baseModel: String(a.baseModel), steps,
          ...(asPositiveInt(a.rank) ? { rank: asPositiveInt(a.rank)! } : {}),
          ...(cfgPrompts ? { samplePrompts: cfgPrompts } : {}),
        })
      } catch { /* config regeneration is best-effort — never block finality on it */ }
    }

    // 1. Lift the trained safetensors off the host.
    const { bytes, filename } = await deps.reader(jobId, outcome)

    // 2. Host it in OUR bucket → a durable, our-custody download URL.
    const id = newId()
    const loraUrl = await deps.store.put(`${prefix}/${id}/${filename}`, bytes, 'application/octet-stream')

    // 3. Register it as a private LoRA Intella so `/make` can apply it at once.
    const source: IntellaSource = { provenance: 'miladystation', uri: loraUrl, format: 'safetensors' }
    const intella: Intella = {
      id,
      nomen,
      genus: 'lora',
      architectura: 'lora',
      parametri: 0,
      sources: [source],
      dest: `loras/${slug}.safetensors`,
      sizeGb: bytes.length / 1e9,
      versio: '1.0.0',
      canonica: false,
      access: 'private',
      ...(familia ? { familia } : {}),
      // License axis (SEPARATE from familia): a LoRA inherits its base's license — a FLUX.1-dev-trained
      // LoRA is a Non-Commercial derivative and must NOT be publicly (commercially) catalogued. Recorded
      // so the publish gate enforces it uniformly with imports (modelLicense.ts). Fail-closed.
      license,
      commercialUse,
      // The classifier-usable base descriptor this license was derived from (Option A,
      // docs/spec/model-base-provenance.md) — always set alongside `license` from the SAME
      // `baseDescriptor`, so a later reclassify (or the backfill sweep) reads a value consistent
      // with what was actually recorded here. Omitted when there was no baseModel at all to derive
      // one from (the archival/owner-less-familia path above).
      ...(baseDescriptor ? { baseModel: baseDescriptor } : {}),
      ...(typeof a.baseIntellaId === 'string' ? { baseIntellaId: a.baseIntellaId } : {}),
      ...(trigger ? { trigger } : {}),
      slug,
      ...(typeof a.ownerAnimaId === 'string' ? { ownerAnimaId: a.ownerAnimaId } : {}),
      ...(description ? { description } : {}),
      ...(typeof steps === 'number' ? { trainingSteps: steps } : {}),
      ...(provenance ? { provenance } : {}),
      ...(samples.length ? { samples } : {}),
      ...(datasetItems && datasetItems.length ? { datasetItems } : {}),
      ...(configYaml ? { configYaml } : {}),
      natum: now(),
    }
    await deps.intellae.upsert(intella)

    // Cleanup (REMOTE success only): the run completed, so the rescued intermediate checkpoint is
    // no longer a resume anchor, and the pod-uploaded final is now redundant (re-hosted above to
    // models/<id>/). Sweep both scratch weights to reclaim space; KEEP samples/ — the Intella's
    // durable previews reference them. Best-effort + last (after the durable upsert); idempotent.
    // (A FAILED run never reaches here, so its checkpoint is preserved for resume.)
    const store = deps.store as Partial<ObjectStore>
    if (outcome.outputUrl && typeof store.del === 'function') {
      await store.del(`training/${jobId}/checkpoint.safetensors`).catch(() => {})
      await store.del(`training/${jobId}/${filename}`).catch(() => {})
    }

    // Receipt carries the license verdict + a plain-language note — so the training UX tells the
    // owner at completion whether the LoRA is publicly (commercially) listable or private-use-only.
    return { trained: true, steps: outcome.lastStep, loraId: id, loraUrl, license, commercialUse, licenseNote: licenseNote(commercialUse, license) }
  }
}

/** Lowercase, dash-joined slug for a trigger word — the ComfyUI `<lora:slug:w>` token + dest stem. */
function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'lora'
}

/** The finalizer closure shape `makeTrainingFinalizer` returns. */
export type TrainingFinalize = (actum: Actum, outcome: AitkOutcome) => Promise<Record<string, unknown>>

/**
 * Adapt the finalizer to the execution webhook's `resolveExitus` seam (Slice E). For a
 * completed training run (matched by `ministerium`), it reads the pod-uploaded LoRA URL off
 * the webhook's output items, treats the configured `aditus.steps` as the steps reached, and
 * runs finality → `{ trained, steps, loraId, loraUrl }`. Returns null for any other modus, so
 * the webhook falls back to the generic `projectExitus`.
 */
export function makeTrainingExitusResolver(
  finalize: TrainingFinalize,
  ministerium = 'aitoolkit',
): (
  actum: Actum,
  modus: { ministerium?: string } | null,
  outputItems: Array<{ url?: string; path?: string; kind?: string } | string>,
) => Promise<Record<string, unknown> | null> {
  return async (actum, modus, outputItems) => {
    if (modus?.ministerium !== ministerium) return null
    // Samples ride the same output[] channel, tagged `kind:'sample'`; the LoRA is the rest.
    const isSample = (it: typeof outputItems[number]): boolean => typeof it === 'object' && it?.kind === 'sample'
    const loraUrl = firstUrl(outputItems.filter((it) => !isSample(it)))
    if (!loraUrl) throw new Error('training finality: completion carried no LoRA output URL')
    const sampleUrls = outputItems
      .filter(isSample)
      .map((it) => (typeof it === 'object' ? it.url : undefined))
      .filter((u): u is string => typeof u === 'string' && u.length > 0)
    const steps = asPositiveInt(actum.aditus.steps) ?? 0
    return finalize(actum, { status: 'completed', lastStep: steps, outputUrl: loraUrl, ...(sampleUrls.length ? { sampleUrls } : {}) })
  }
}

/**
 * Wrap the finalizer so a LOCAL run surfaces its preview samples. The remote pod runner
 * (`aitktrainer.py`) uploads samples + rides them in the webhook → `outcome.sampleUrls`; the
 * local cursor's outcome is bare `{ status, lastStep }`, leaving the previews unread on disk.
 * This reads `<outputDir>/<jobId>/samples/`, uploads the END-OF-RUN images to R2, and injects
 * `sampleUrls` (prompt-index order) before delegating — so local-trained LoRAs carry the same
 * first-class previews as remote ones. A no-op if the outcome already carries samples (remote),
 * or on a non-completed run. Best-effort: a sample-upload failure never sinks finality.
 */
export function withLocalSamples(
  finalize: TrainingFinalize,
  deps: { outputDir: string; store: Pick<Uploader, 'put'>; jobIdOf?: (a: Actum) => string },
): TrainingFinalize {
  return async (actum, outcome) => {
    if (outcome.status === 'completed' && !outcome.sampleUrls?.length) {
      const jobId = deps.jobIdOf?.(actum) ?? String(actum.aditus.jobId ?? actum.id)
      const sampleUrls = await uploadLocalSamples(deps.outputDir, jobId, deps.store).catch(() => [])
      if (sampleUrls.length) outcome = { ...outcome, sampleUrls }
    }
    return finalize(actum, outcome)
  }
}

/**
 * Collect a local run's END-OF-RUN sample previews and host them in R2. ai-toolkit names samples
 * `<ts>__<step9>_<promptIdx>.<ext>` and writes one set at step 0 AND at the final step — so we keep
 * only the highest-step image per prompt index (sorted by index, pairing with the config's prompt
 * order) and skip the step-0 noise. Returns the hosted URLs in prompt-index order; [] if none.
 */
async function uploadLocalSamples(outputDir: string, jobId: string, store: Pick<Uploader, 'put'>): Promise<string[]> {
  const { readFile, readdir } = await import('node:fs/promises')
  const { join, extname } = await import('node:path')
  const dir = join(outputDir, jobId, 'samples')
  const IMG = new Set(['.png', '.jpg', '.jpeg', '.webp'])
  let names: string[]
  try { names = (await readdir(dir)).filter((n) => IMG.has(extname(n).toLowerCase())) } catch { return [] }

  // Parse `__<step9>_<idx>.<ext>`; keep the max-step image per prompt index.
  const parsed = names
    .map((name) => { const m = name.match(/__(\d+)_(\d+)\.[a-z]+$/i); return m ? { name, step: Number(m[1]), idx: Number(m[2]) } : null })
    .filter((p): p is { name: string; step: number; idx: number } => p !== null)
  if (parsed.length === 0) return []
  const maxStep = Math.max(...parsed.map((p) => p.step))
  const finals = parsed.filter((p) => p.step === maxStep).sort((a, b) => a.idx - b.idx)

  const urls: string[] = []
  for (const f of finals) {
    const ext = extname(f.name).toLowerCase()
    const contentType = ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : 'image/jpeg'
    const bytes = await readFile(join(dir, f.name))
    urls.push(await store.put(`training/${jobId}/samples/${String(f.idx).padStart(3, '0')}${ext}`, bytes, contentType))
  }
  return urls
}

/** The first resolvable media URL among the webhook's output items (string or `{ url }`). */
function firstUrl(items: Array<{ url?: string; path?: string; kind?: string } | string>): string | undefined {
  for (const it of items) {
    if (typeof it === 'string' && it.length > 0) return it
    if (it && typeof it === 'object' && typeof it.url === 'string' && it.url.length > 0) return it.url
  }
  return undefined
}

function asPositiveInt(v: unknown): number | undefined {
  const n = Number(v)
  return Number.isInteger(n) && n > 0 ? n : undefined
}

/**
 * Production `LoraReader`: read the trained safetensors off the host-mounted
 * ai-toolkit output dir. ai-toolkit writes `<outputDir>/<jobId>/<jobId>.safetensors`
 * (the final weights) alongside step checkpoints — prefer the final, else the
 * newest `.safetensors`. Untested filesystem shell (like `DockerAitkSpawner`).
 */
export function fsLoraReader(outputDir: string): LoraReader {
  return async (jobId) => {
    const { readFile, readdir, stat } = await import('node:fs/promises')
    const { join } = await import('node:path')
    const dir = join(outputDir, jobId)
    const names = (await readdir(dir)).filter((n) => n.endsWith('.safetensors'))
    if (names.length === 0) throw new Error(`training finality: no .safetensors in ${dir}`)
    const read = async (filename: string): Promise<LoraArtifact> => ({ bytes: await readFile(join(dir, filename)), filename })

    const final = `${jobId}.safetensors`
    if (names.includes(final)) return read(final)         // the canonical final weights
    // No final file — fall back to the most-recently-written checkpoint.
    let filename = names[0]
    let newest = -Infinity
    for (const n of names) {
      const m = (await stat(join(dir, n))).mtimeMs
      if (m > newest) { newest = m; filename = n }
    }
    return read(filename)
  }
}

/**
 * Remote `LoraReader` (Slice E): the pod uploaded its safetensors to R2 and reported the
 * URL on `outcome.outputUrl`; fetch those bytes for the same finality path. The finalizer
 * then re-hosts them under our durable `models/<id>/` key — one finality, two readers.
 * Hermetic (a fake `MediaFetcher` drives it in tests).
 */
export function urlLoraReader(fetcher: MediaFetcher): LoraReader {
  return async (_jobId, outcome) => {
    const url = outcome.outputUrl
    if (!url) throw new Error('training finality: remote run reported no outputUrl')
    const base = url.split('?')[0].split('#')[0].split('/').pop() || 'lora'
    const filename = base.endsWith('.safetensors') ? base : `${base}.safetensors`
    return { bytes: await fetcher.fetch(url), filename }
  }
}
