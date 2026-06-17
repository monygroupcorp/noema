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
  // Stamped at dispatch by RunPodCursor when the actum lands on a warm Materia
  // with a paired Hospitium. The completor reads these to emit execution_spend
  // with the right impetus + host destination. All three fields are NON-IDENTITY
  // by construction — `pricingTier` is one of three labels; `baseImpetus` and
  // `finalImpetus` are numbers; the host's identity is re-derived from Hospitium
  // at emit time.

  /** Which pricing tier this run was assigned at dispatch — drives the spend math. */
  pricingTier?: 'owner' | 'admin' | 'guest'

  /**
   * Base impetus before any hosting surcharge — equals `actum.impetus` reservation.
   * Carried separately so hostCutHook can tax base only (not the warm surcharge,
   * which is independently compensated via hospitiumHook).
   */
  baseImpetus?: bigint

  /**
   * Total impetus actually spent on this run. Guest = baseImpetus + WARM_SURCHARGE_IMPETUS;
   * owner/admin = baseImpetus. Distinct from `actum.impetus`, which is the
   * reservation upper bound; the completor caps at that.
   */
  finalImpetus?: bigint
}

/** "Acta" — nominative plural of actum. A series of acts. */
export type Acta = Actum[]
