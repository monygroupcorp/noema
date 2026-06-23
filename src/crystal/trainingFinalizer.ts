import { v4 as uuidv4 } from 'uuid'
import type { Actum } from '../types/actum.js'
import type { Intella, IntellaSource } from '../types/intelligendi.js'
import type { Uploader } from './R2Uploader.js'
import type { AitkOutcome } from './aitoolkitRunnerClient.js'

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
    const slug = slugify(trigger || jobId)
    const familia = String(a.familia ?? a.baseModel ?? '').trim().toLowerCase()
    const nomen = (typeof a.name === 'string' && a.name.trim()) || trigger || jobId

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
      ...(typeof a.baseIntellaId === 'string' ? { baseIntellaId: a.baseIntellaId } : {}),
      ...(trigger ? { trigger } : {}),
      slug,
      ...(typeof a.ownerAnimaId === 'string' ? { ownerAnimaId: a.ownerAnimaId } : {}),
      natum: now(),
    }
    await deps.intellae.upsert(intella)

    return { trained: true, steps: outcome.lastStep, loraId: id, loraUrl }
  }
}

/** Lowercase, dash-joined slug for a trigger word — the ComfyUI `<lora:slug:w>` token + dest stem. */
function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'lora'
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
