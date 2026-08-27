// =============================================================================
// ACTUM — the discrete execution report
// =============================================================================
//
// "Acta est fabula" — the act is done (said at the end of Roman theatrical
// performances). An actum is the immutable record of one modus execution.
//
// TRIAD: modus defines → modo executes → actum records
//
// Actum covers two kinds of events, both of which are "acts":
//   1. Modus execution — a tool ran, produced output, cost impetus
//   2. Spend event — an arcanum signum was consumed to open a modo (session)
//      In this case nullifier is set (the one-time ZK spend proof).
//
// ANONYMOUS HALF: Actum has no identity columns — it lives entirely on the
// anonymous side of the privacy partition. The link from actum back to a
// real user crosses: actum.nullifier → signum(arcanum) → signum(deposit) → anima
// (three hops, access-controlled at each).
//
// IMPETUS: The economic unit. 1 impetus point = $0.000337 = 1 second of
// RunPod SECURE pod-time. impetus on actum records the total points consumed.
// =============================================================================

import type { GpuClass } from './materia.js'
import type { Progressus, PhaseDurations } from './progressus.js'
export type { GpuClass }

/**
 * ModelRef — one model the Compiler must ensure is on the pod's volume: a role
 * (`unet` / `lora` / `checkpoint` / …), the Intella id to resolve, and the volume
 * `dest`. `url` + `dest` are filled in by `Compiler._resolveModels` from the Intella
 * record when only the id is known (as for host-pinned models). The shape mirrors a
 * workflow template's `requiredModels[]` entry.
 */
export interface ModelRef {
  role: string
  id: string
  url?: string
  dest: string
  sizeBytes?: number
}

export type ActumStatus =
  | 'nascens'     // initializing — execution has started, not yet running
  | 'agens'       // running — modus is actively executing on materia
  | 'completus'   // completed successfully — exitus is populated
  | 'fractus'     // failed — error is populated ("fractus" = broken in Latin)

/**
 * ComputeStrategy — how the user wants this generation dispatched.
 *
 * 'performance' — dedicated pod, user-selected GPU class, highest cost, immediate.
 * 'standard'    — on-demand pod, platform-chosen GPU, default experience.
 * 'economy'     — queued; dispatched against a warm pod another user left idle.
 *                 Cheaper (no cold-start cost); wait time is non-deterministic.
 */
export type ComputeStrategy = 'performance' | 'standard' | 'economy'

/**
 * Actum — the discrete execution report for a single modus run.
 *
 * Created when a modus is cast. Updated as execution progresses.
 * Immutable once status reaches 'completus' or 'fractus'.
 */
export interface Actum {
  id: string
  /** FK → Modus. Which modus was executed. */
  modusId: string
  /**
   * The exact version of the modus at cast time — locked in, immutable.
   * "versio" = version in Latin. Ensures the record is a faithful receipt.
   */
  modusVersiono: string

  // ── Location — no identity columns ──────────────────────────────────────
  /** FK → Modo. The session this actum ran within. Optional: some actum run outside sessions. */
  modoId?: string
  /**
   * FK → Dictum. The conversation turn that spawned this execution.
   * Absent for acta spawned from canvas workflows, API calls, or Mandatora.
   * "dictumId" — origin conversation turn.
   */
  dictumId?: string
  /** FK → Materia. The physical pod that executed this actum. */
  materiamId?: string

  /**
   * Compositus linkage — set ONLY on the child step acta of a compositus run.
   * Marks this actum as step `ordine` of the parent compositus actum `parentId`.
   * Non-identity by construction: both are actum ids. Lets the execution webhook
   * route a completed step back to the CompositusCursor (which threads sibling
   * exitus into the next step's aditus) and lets restart-rehydrate reconstruct
   * in-flight chains via `Actorum.findInFlight()` grouped by `parentId`. The
   * parent actum itself carries no `compositum`. (ADR-0008.)
   */
  compositum?: { parentId: string; ordine: number }

  // ── Compute spec ────────────────────────────────────────────────────────
  /**
   * How the user dispatched this generation.
   * Absent: treated as 'standard'. Recorded at cast time from either the
   * user's Anima preference or the per-run advanced settings override.
   */
  computeStrategy?: ComputeStrategy
  /**
   * GPU class the user requested. Only meaningful when computeStrategy is
   * 'performance'. Absent: platform picks a suitable default.
   */
  gpuClass?: GpuClass

  // ── Cost ────────────────────────────────────────────────────────────────
  /**
   * Total impetus points spent on this execution.
   * "impetus" = force/impulse in Latin — a vector (has direction: payer → platform/creator)
   * not just a scalar. 1 point = $0.000337 = 1 second of RunPod SECURE.
   */
  impetus: bigint
  /** FK[] → Signum. The specific signa consumed to pay for this actum. */
  signaConsumed: string[]

  /**
   * ZK spend proof — present when an arcanum-forma signum was consumed.
   * Posted once to open a modo (session). A nullifier can only be used once;
   * attempting to reuse it is rejected. Prevents double-spend without
   * revealing which commitment was spent.
   */
  nullifier?: string

  /**
   * Bursa bearer token — present when the run was paid for by an anonymous
   * credit purse. Used for ownership checks: the presenter of this token owns
   * the run. Mutually exclusive with nullifier.
   */
  bursaToken?: string

  // ── Execution ───────────────────────────────────────────────────────────
  /** "aditus" = entrance in Latin — the inputs provided at cast time */
  aditus: Record<string, unknown>

  /**
   * Opaque routing hint when the runner deep-linked into a specific host's pod
   * (e.g. /start pod_<token>). Non-identity by design — the token is an
   * unguessable random string that the cursor passes to Praefectus.findByShareToken
   * at dispatch. Absent for ordinary `/make` invocations.
   */
  shareTokenHint?: string

  /**
   * Models the host pinned onto the studio's loadout via `Mod • → Add`, threaded from
   * dispatch to the Compiler (which unions them into `spec.models` so any missing weights
   * download on this gen). First-class + typed — NOT smuggled through `aditus`. Absent for
   * ordinary `/make` invocations.
   */
  pinnedModels?: ModelRef[]

  /**
   * The external system's job identifier — set when cursor returns { kind: 'async' }.
   * Used by the webhook inbound handler to look up the Actum for completion.
   * "externus" = external; this ID lives in the external system, not ours.
   */
  externusJobId?: string

  /**
   * Per-job callback credential, minted when the run is dispatched and carried as the last path
   * segment of the callback URL handed to the pod (`…/webhooks/runpod/<nonce>`). The inbound
   * webhook resolves the actum by this value and requires it to be the same actum the reported
   * job id resolves to, so a callback is admitted only for the job it reports.
   *
   * Same lifecycle as `externusJobId` — written in the same patch at dispatch — but STABLE across
   * a pod retry (which rotates `externusJobId`), so the lookup is keyed on the nonce, never on the
   * job id.
   *
   * Absent on acta dispatched before this field existed; those complete over the nonce-less
   * callback route (see `webhookRouter`).
   */
  callbackNonce?: string

  /**
   * True when `externusJobId` is a DEDICATED one-shot pod (e.g. a training pod) that
   * must be terminated when the run ends — on success as well as failure. Warm/pooled
   * pods (the `make` path) leave this unset: `complete()` keeps them alive for reuse and
   * the idle reaper sweeps them. Set by the cursor that launched the dedicated pod.
   */
  oneshotPod?: boolean

  /**
   * The latest checkpoint a long run (training) has rescued to durable storage, updated as the
   * pod reports them on `/runner/status`. The RESUME ANCHOR: if the pod is hard-killed (no
   * completion/failure webhook), the host still holds `{url, step}` here, so a resume run can
   * continue from it (`aditus.resumeFrom = url`, remaining steps = total − step).
   */
  resumeCheckpoint?: { url: string; step: number }

  // ── First-heartbeat deadline (host liveness for a detached pod) ─────────
  /**
   * Opt-in first-heartbeat window in milliseconds, written at dispatch by a cursor that launches
   * a DETACHED pod — one whose only channel back to us is `POST /runner/status`.
   *
   * Present → once the host has locked a machine for this run (`podLockedAt`), the pod has this
   * long to say its first word. Absent → the run carries no first-heartbeat deadline and is
   * bounded only by `expirat`. That is where every run whose runner is parsed IN-PROCESS stays:
   * for those the host, not the pod, is the reporter, so pod silence means nothing.
   *
   * OPT-IN RATHER THAN GLOBAL because the window is only meaningful next to the work the host
   * does between locking a machine and the pod's first word. A caption pod installs a small
   * runtime; other detached rails clone a repository and install a large dependency tree, which
   * is legitimately slower than a window short enough to be useful here.
   */
  firstHeartbeatDeadlineMs?: number

  /**
   * When the host locked a machine for this run — SSH reachable, no pod-side work started yet.
   * The START of the first-heartbeat clock: later than dispatch (which includes the queue wait)
   * and earlier than the host's own handover report.
   */
  podLockedAt?: Date

  /**
   * When the pod first reported for itself over `POST /runner/status`. Its presence DISARMS the
   * first-heartbeat deadline — from here on the run is bounded by `expirat` again. Host-side
   * phase reports never set it: the deadline exists to catch a pod that cannot speak, so only
   * the pod's own voice clears it.
   */
  firstPodReportAt?: Date

  /**
   * SHA-256 content address of the CompiledSpec that was submitted.
   * "sha256:<hex>" — links this execution to its exact deployment bundle.
   * Set by RunPodCursor after compilation; absent on non-RunPod cursors.
   */
  deploymentHash?: string

  status: ActumStatus
  /** "exitus" = exit in Latin — the outputs produced by the modus */
  exitus?: Record<string, unknown>
  /** Error message if status is 'fractus' */
  error?: string

  // ── Timing ──────────────────────────────────────────────────────────────
  /** "inceptum" = begun in Latin — when execution started */
  inceptum: Date
  /** "completum" = completed in Latin — when execution finished */
  completum?: Date
  /** Wall-clock execution time in milliseconds */
  duratio?: number

  /** Pod execution telemetry — see ActumExecutio. Absent for non-pod cursors. */
  executio?: ActumExecutio

  // ── Status timeline (Progressus) ────────────────────────────────────────
  /**
   * The ordered, persisted timeline of status reports for this run — every phase
   * transition + log message + error, each timestamped. This IS "all the logs":
   * states are queryable later and each step's duration is measurable. The runner
   * emits a stream via `POST /runner/status`; the sink appends here. The LATEST
   * report is `progressus.at(-1)` — derived, not a separate field. Per-tick numeric
   * progress (sampler 7→8→9, byte samples) is NEVER persisted here — that's
   * live-only (bus/SSE); durations come from transition timestamps. See
   * src/types/progressus.ts + docs/spec/runner-status.md §7.
   */
  progressus?: Progressus[]
  /**
   * Derived on completion from `progressus` — dwell-time per `(phase, target)`, the
   * "how fast is each step" substrate, cross-run queryable. `ActumExecutio`'s
   * telemetry (provisionMs, downloadMs, …) unifies into this. See `rollupPhaseDurations`.
   */
  phaseDurations?: PhaseDurations

  /**
   * Hard deadline for this execution.
   * A nascens actum past this timestamp is stuck — the cursor never reported back.
   * Recovery: find via Actorum.findExpired(), call ActumCompletor.fail() on each.
   * This releases all locked signa back to the payer with zero charge.
   */
  expirat: Date
}

/**
 * Pod execution telemetry — provisioning, model-download, and inference metrics.
 *
 * Written onto the actum by the cursor *as the job runs* (before completion), so
 * the data is durable and survives the webhook boundary: the completion webhook
 * runs in a fresh trace context with none of this in-flight state, so it reads
 * these metrics back off the actum to build the wide analytics event.
 */
export interface ActumExecutio {
  /**
   * Private generation (noema-347): this run's outputs were dispatched to the private-outputs
   * bucket, so the completion path stores opaque markers rather than URLs.
   *
   * A per-RUN fact stamped at dispatch, NOT a preference read at completion — the preference
   * can change while a run is in flight, and a warm pod is shared across owners, so privacy
   * can never ride the pod. Absent/false reads as a public run everywhere.
   */
  privateOutputs?: boolean
  /** Pod creation → RunPod API reporting RUNNING with an SSH port. Absent on warm reuse. */
  provisionMs?: number
  /** Actum start → sshd actually accepting connections. */
  sshReadyMs?: number
  /** Wall-clock spent downloading models this run (0 when all were already present). */
  downloadMs?: number
  /** Count of models fetched this run. */
  modelsDownloaded?: number
  /** Count of models already present on the pod (warm reuse). */
  modelsReused?: number
  /**
   * intellaIds present on the studio's volume after this run. The webhook
   * set-unions this into `Materia.installedModels` so the bulletin's
   * `Mod • → View loadout` reflects reality. Optional — older comfyrunners
   * that don't report it cause no harm.
   */
  modelsInstalled?: string[]
  /** Total bytes fetched this run. */
  downloadBytes?: number
  /** comfyrunner-reported inference time. */
  executionMs?: number
  /** GPU class the pod ran on, when known. */
  gpuType?: string
  /** RunPod pod id that actually ran the job (final, post-retry). */
  podId?: string
  /** true = a pod was provisioned for this run; false = warm pod reuse. */
  coldStart?: boolean
  /** Pod hourly rate in USD, captured from RunPod at provision. Used to derive cost. */
  costPerHr?: number
  /**
   * Authoritative billed wall-time in ms, when the cursor knows it (e.g. the dev
   * fake reporting a realistic pod lifetime). Cost derivation prefers this over
   * the actum's inceptum→completum delta. Real clients leave it unset.
   */
  billedMs?: number

  // ── Hosting / pricing decision (Phase B + Phase C reframe) ──────────────────
  // `pricingTier` is stamped at dispatch by RunPodCursor when the actum lands on a
  // warm Materia with a paired Hospitium; the two amounts are written at completion
  // by ActumCompletor, which is where the measured cost is known. The spend hooks
  // read them to emit execution_spend with the right impetus + host destination.
  // All three fields are NON-IDENTITY by construction — `pricingTier` is one of
  // three labels; `baseImpetus` and `finalImpetus` are numbers; the host's identity
  // is re-derived from Hospitium at emit time.

  /** Which pricing tier this run was assigned at dispatch — drives the spend math. */
  pricingTier?: 'owner' | 'admin' | 'guest'

  /**
   * The measured cost basis, before any hosting surcharge: the cursor's metered pod
   * wall-clock for this run (NOT the `actum.impetus` reservation). Written at
   * completion and carried separately so hostCutHook can tax base only (not the warm
   * surcharge, which is independently compensated via hospitiumHook).
   */
  baseImpetus?: bigint

  /**
   * Total impetus actually spent on this run — what was settled. Guest =
   * baseImpetus + WARM_SURCHARGE_IMPETUS; owner/admin = baseImpetus; capped at
   * `actum.impetus`, which is the reservation upper bound, not a cost.
   */
  finalImpetus?: bigint
}

/** "Acta" — nominative plural of actum. A series of acts. */
export type Acta = Actum[]
