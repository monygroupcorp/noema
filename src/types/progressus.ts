// =============================================================================
// PROGRESSUS — the owned, runner-agnostic status report
// =============================================================================
//
// "Progressus" = a going-forward, an advance (Latin, from progredior: to step
// forth). A Progressus is one structured status report: where an Actum is in its
// lifecycle at a moment, plus optional progress / resources / parallel sub-reports.
// Every runner (ComfyUI, the TEE enclave, the trainer, hosting, downloading) emits
// a *stream* of them; the whole stream is persisted on the Actum (the timeline),
// and the stream is projected live to consumers (SSE, Telegram, frontend, analytics).
//
// WHY WE OWN IT: today our rich status is INHERITED from ComfyUI — comfyrunner
// parses ComfyUI's ~15 SSE event types into ad-hoc strings (`stage: 'progress:7/20'`),
// which is ComfyUI-shaped, stringly-typed, and ephemeral; every non-ComfyUI runner
// reinvents it. Progressus is the canonical model the *fundamentum* maps INTO, not
// one we inherit from whichever runtime happens to be richest. A new runner becomes
// "emit a Progressus," not "invent a status protocol." See docs/spec/runner-status.md.
//
// NAME: NOT `Nuntius` (that already names the allocutio inbound platform message,
// src/types/allocutio.ts) and NOT `Gradus` (compositus spell steps, `Modus.gradus`).
//
// VALUE ENUMS ARE ENGLISH (`Phasis`, units): the phase vocabulary is the OWNED
// internal taxonomy, kept English like `ActumStatus`'s neighbours read elsewhere —
// we Latinize the primitive (Progressus), not the lifecycle labels.
//
// PRIVACY: a Progressus rides on the Actum, which lives entirely on the ANONYMOUS
// side of the privacy partition — no identity columns, ever. Nothing on a Progressus
// may carry an animaId.
// =============================================================================

/**
 * Phasis — the canonical phase taxonomy (the OWNED vocabulary).
 *
 * Runner-agnostic: every runner maps its native events into exactly these. Specific
 * where the cost differs — the three faces of "loading" are SPLIT, because pulling a
 * multi-GB base image, downloading weights, and copying weights into VRAM are
 * independently slow and we want to measure each. Ordered roughly by lifecycle.
 *
 * These are OWNED: a richer native event never adds a `Phasis` — it maps to an
 * existing phase, with `target` for what it acts on and `message`/`progress` for the
 * native detail. A genuinely new phase is a deliberate spec change (keeps the
 * vocabulary small, shared, measurable).
 */
export type Phasis =
  | 'queued'        // accepted, awaiting a slot (warm-pool queue, scheduler)
  | 'provisioning'  // acquiring compute — pod/instance create (cold start)
  | 'pulling'       // fetching the RUNTIME / base image (the fundamentum) onto the host
  | 'attesting'     // TEE attestation + secure-tunnel handshake (TEE only)
  | 'downloading'   // fetching ARTIFACTS — models / loras / datasets / media inputs (target says which)
  | 'installing'    // installing custom nodes / deps
  | 'loading'       // copying weights into VRAM (target:'vram') — the GPU load, NOT a download
  | 'warming'       // post-load readiness (CUDA graphs, first-token warmup, sampler warmup)
  | 'executing'     // the actual work (inference steps, training steps, token stream)
  | 'uploading'     // pushing outputs out (R2, HF)
  | 'finalizing'    // settle / cleanup
  | 'cancelling'    // an in-flight cancel was requested
  | 'done'          // terminal — succeeded
  | 'failed'        // terminal — errored

/** Unit a `progress` measurement counts in. */
export type ProgressusUnit = 'items' | 'bytes' | 'steps' | 'pct'

/**
 * One progress measurement — the same shape across very different work:
 * model download `{done:2,total:5,unit:'items'}`, a single weight `{unit:'bytes'}`,
 * a sampler / training loop `{done:step,total:totalSteps,unit:'steps'}`, a token
 * stream `{done:tokens,unit:'items'}`. `total` is optional (open-ended streams).
 */
export interface ProgressusMensura {
  done: number
  total?: number
  unit: ProgressusUnit
}

/**
 * VRAM & friends — first-class, extensible, rides on any phase (not bolted on).
 */
export interface ProgressusResources {
  vramUsedMb?: number
  vramTotalMb?: number
  gpuUtilPct?: number
  diskUsedMb?: number
}

/**
 * The pod/instance identity + cost backing the run's compute. Rides on the cold-start
 * phase reports (provisioning/pulling) so a consumer can show "found a 4090 @ $X/hr" and
 * offer pod control (warm-window / destroy) — the StageInfo the legacy `actum.stage`
 * carried, now first-class on the timeline. Identity, not telemetry, so it's its own field
 * (VRAM lives on `resources`).
 */
export interface ProgressusPod {
  podId?: string
  gpuType?: string
  region?: string
  costPerHr?: number
}

/**
 * Progressus — one structured status report at a moment.
 *
 * `phase` is the coarse step (for the timeline + measurement); `target` is the
 * within-phase specificity (a `downloading` of a `model` is queryable apart from a
 * `downloading` of a `dataset`, without exploding the phase set). Concurrent work
 * nests via `parallel[]` instead of flattening to a string.
 */
export interface Progressus {
  /** The canonical, OWNED phase. */
  phase: Phasis
  /**
   * WHAT this phase acts on, for within-phase specificity:
   * 'fundamentum' | 'model' | 'lora' | 'dataset' | 'input' | 'vram' | 'output' | …
   * A free string by design — an unknown target is just carried, never rejected.
   */
  target?: string
  progress?: ProgressusMensura
  /** Estimated time remaining in this phase, ms. */
  etaMs?: number
  /** Human detail ("loading flux1-schnell into VRAM"). */
  message?: string
  resources?: ProgressusResources
  /** Pod/instance identity + cost backing this run (carried on cold-start phases). */
  pod?: ProgressusPod
  /** Sub-reports for concurrent work (multi-file download, fan-out, multi-GPU). */
  parallel?: Progressus[]
  /** When this report was emitted. */
  at: Date
}

/**
 * PhaseDurations — derived dwell-time per `(phase, target)`, the "how fast is each
 * step" substrate. Keyed `phase` when there's no target, else `phase/target`
 * (e.g. `'provisioning'`, `'pulling/fundamentum'`, `'downloading/model'`,
 * `'downloading/dataset'`, `'loading/vram'`, `'executing'`). Value is milliseconds.
 *
 * This is what `ActumExecutio`'s telemetry (provisionMs, downloadMs, …) unifies
 * into — derived from transition timestamps, not separately reported.
 */
export type PhaseDurations = Record<string, number>

// Derivation logic (phaseKey / rollupPhaseDurations) lives in the execution rail:
// src/execution/progressus.ts — this file stays pure type declarations, like the
// rest of src/types/.
