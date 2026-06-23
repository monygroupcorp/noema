import type { Cursor, CursorResult } from '../types/cursus.js'
import type { Actum } from '../types/actum.js'
import type { Modus } from '../types/modus.js'
import type { AitkJobStore } from './AitkJobStore.js'
import type { AitkSpawner, AitkMount } from './AitkSpawner.js'
import { awaitViaPoll, type AitkOutcome } from './aitoolkitRunnerClient.js'

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
// Inputs (aditus): `jobId` (default = actum.id, MUST match the config `name`), `steps`
// (total, for executing progress + etaMs), `configPath` (container-relative training yaml),
// `jobConfig` (optional JSON string stored on the Job row), `gpuId`.
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
    const configPath = String(aditus.configPath ?? '')
    if (!configPath) throw new Error('aitoolkit training: `configPath` is required (the container-relative training yaml)')
    const jobConfig = typeof aditus.jobConfig === 'string' ? aditus.jobConfig : undefined
    const gpuId = aditus.gpuId !== undefined ? String(aditus.gpuId) : undefined

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
}

function asPositiveInt(v: unknown): number | undefined {
  const n = Number(v)
  return Number.isInteger(n) && n > 0 ? n : undefined
}
