import type { Cursor, CursorResult } from '../types/cursus.js'
import type { Actum } from '../types/actum.js'
import type { Modus } from '../types/modus.js'
import type { AitkJobStore } from './AitkJobStore.js'
import type { AitkSpawner, AitkMount } from './AitkSpawner.js'
import { awaitViaPoll, type AitkOutcome } from './aitoolkitRunnerClient.js'
import { buildAitkConfig, type AitkConfigWriter } from './aitkConfig.js'

// =============================================================================
// AitoolkitTrainingCursor — the crystal-native training runtime (build #5)
// =============================================================================
//
// ministerium 'aitoolkit'. A LOCAL, self-hosted training cursor — it drives ostris/
// ai-toolkit on our own GPU, so (like the host-side ffmpeg/composite cursors) it reserves
// and charges 0n. `run()`:
//   1. seeds ai-toolkit's SQLite Job row (status:'queued') so UITrainer can UPDATE it,
//   2. launches the training container (the spawner returns once it's up),
//   3. polls the Job row to terminal via `awaitViaPoll`, recording the Progressus timeline
//      onto THIS Actum (so the full timeline + phaseDurations persist — unlike the TEE
//      session, which has no Actum).
// A `completed` outcome maps to the run's exitus; `error`/`stopped` throw so the Actum
// goes `fractus` and the locked signa are released.
//
// Synchronous by design: a local box has no completion webhook, so `run()` blocks for the
// training duration while the poll loop streams status. A remote/queued training variant
// would return `{ kind: 'async', externusJobId }` and complete via webhook — not this path.
//
// The modus OWNS the config. The user-facing inputs are a DATASET + a few knobs; the
// cursor SYNTHESISES the ai-toolkit yaml from them (`buildAitkConfig`, per base-model
// preset) and writes it via the injected `writeConfig` shell — users never hand a yaml.
//
// Inputs (aditus): `dataset` (container-visible image folder), `triggerWord`, `baseModel`
// (preset key), `steps` (total — drives the config + the executing progress/etaMs);
// optional `saveEvery`, `rank`, `jobId` (default = actum.id, becomes the run `name`),
// `gpuId`, `jobConfig`. `configPath` is an internal escape hatch (a pre-built yaml) —
// if present it's used as-is and no config is generated.
// =============================================================================

export interface AitoolkitTrainingCursorDeps {
  store: AitkJobStore
  spawner: AitkSpawner
  /** The ai-toolkit Docker image (e.g. 'stationthis-klein:1'). */
  image: string
  /** Bind mounts for the container (ai-toolkit clone, dataset, HF cache). */
  mounts?: AitkMount[]
  /** Container workdir (where run.py lives) — default '/aitk'. */
  workdir?: string
  /** `--shm-size` for the container (PyTorch DataLoader) — default '8g' (see AitkSpawner). */
  shmSize?: string
  /** Overall poll cap (ms) — a hung run trips this and fails. */
  timeoutMs?: number
  /** Poll cadence (ms) — default 2000. */
  pollIntervalMs?: number
  /**
   * Materialise a generated training config: write it, return the container-relative path
   * the spawner runs. Required for the high-level `dataset`/`baseModel` path; unused when
   * the aditus carries a ready `configPath`. (`fsConfigWriter` is the production shell.)
   */
  writeConfig?: AitkConfigWriter
  /**
   * Map a completed run to its exitus outputs (e.g. locate + host the LoRA safetensors).
   * Default: `{ trained: true, steps }`. The LoRA upload/registration is the publishing
   * arm's concern (training finality), injected here in production.
   */
  resolveOutput?: (actum: Actum, outcome: AitkOutcome) => Promise<Record<string, unknown>>
}

export class AitoolkitTrainingCursor implements Cursor {
  constructor(private readonly deps: AitoolkitTrainingCursorDeps) {}

  async reserve(modus: Modus, _aditus: Record<string, unknown>): Promise<bigint> {
    return modus.impetusFixum ?? 0n   // self-hosted on our GPU — no cost to self (host convention)
  }

  async run(actum: Actum): Promise<CursorResult> {
    const aditus = actum.aditus
    const jobId = String(aditus.jobId ?? actum.id)
    const cfgSteps = asPositiveInt(aditus.steps)
    const jobConfig = typeof aditus.jobConfig === 'string' ? aditus.jobConfig : undefined
    const gpuId = aditus.gpuId !== undefined ? String(aditus.gpuId) : undefined

    // The modus owns the config: synthesise the training yaml from the dataset + knobs,
    // unless a ready `configPath` is handed in (internal escape hatch).
    const configPath = String(aditus.configPath ?? '') || await this._generateConfig(jobId, aditus, cfgSteps)

    const startedAt = Date.now()

    // 1. Seed the Job row so ai-toolkit's UITrainer has a row to UPDATE.
    await this.deps.store.seed(jobId, { ...(gpuId ? { gpuIds: gpuId } : {}), ...(jobConfig ? { jobConfig } : {}) })

    // 2. Launch the training container (returns once it's up; the row drives from here).
    await this.deps.spawner.start({
      jobId, image: this.deps.image, configPath,
      ...(gpuId ? { gpuId } : {}),
      ...(this.deps.mounts ? { mounts: this.deps.mounts } : {}),
      ...(this.deps.workdir ? { workdir: this.deps.workdir } : {}),
      ...(this.deps.shmSize ? { shmSize: this.deps.shmSize } : {}),
    })

    // 3. Poll to terminal, recording the Progressus timeline onto this Actum.
    const outcome = await awaitViaPoll((id) => this.deps.store.read(id), {
      jobId,
      ...(cfgSteps !== undefined ? { cfgSteps } : {}),
      ...(this.deps.pollIntervalMs !== undefined ? { intervalMs: this.deps.pollIntervalMs } : {}),
      ...(this.deps.timeoutMs !== undefined ? { timeoutMs: this.deps.timeoutMs } : {}),
    })

    if (outcome.status !== 'completed') {
      throw new Error(`aitoolkit training ${outcome.status} at step ${outcome.lastStep}: ${outcome.message ?? 'no detail'}`)
    }

    const exitus = await (this.deps.resolveOutput?.(actum, outcome) ?? Promise.resolve({ trained: true, steps: outcome.lastStep }))
    return { kind: 'sync', exitus: { exitus, impetus: 0n, duratio: Date.now() - startedAt } }
  }

  /** Synthesise + write the ai-toolkit yaml from the high-level aditus; returns its path. */
  private async _generateConfig(jobId: string, aditus: Record<string, unknown>, steps: number | undefined): Promise<string> {
    const dataset = String(aditus.dataset ?? '')
    if (!dataset) throw new Error('aitoolkit training: `dataset` is required (the image folder), or pass a ready `configPath`')
    const baseModel = String(aditus.baseModel ?? '')
    if (!baseModel) throw new Error('aitoolkit training: `baseModel` is required to pick the config preset')
    if (!this.deps.writeConfig) throw new Error('aitoolkit training: no `writeConfig` configured to materialise the generated config')

    const saveEvery = asPositiveInt(aditus.saveEvery)
    const rank = asPositiveInt(aditus.rank)
    const yaml = buildAitkConfig({
      name: jobId,
      datasetPath: dataset,
      triggerWord: String(aditus.triggerWord ?? jobId),
      baseModel,
      steps: steps ?? 500,
      ...(saveEvery !== undefined ? { saveEvery } : {}),
      ...(rank !== undefined ? { rank } : {}),
    })
    return this.deps.writeConfig(jobId, yaml)
  }
}

function asPositiveInt(v: unknown): number | undefined {
  const n = Number(v)
  return Number.isInteger(n) && n > 0 ? n : undefined
}
