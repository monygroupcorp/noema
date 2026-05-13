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

export type ActumStatus =
  | 'nascens'     // initializing — execution has started, not yet running
  | 'agens'       // running — modus is actively executing on materia
  | 'completus'   // completed successfully — exitus is populated
  | 'fractus'     // failed — error is populated ("fractus" = broken in Latin)

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

  // ── Execution ───────────────────────────────────────────────────────────
  /** "aditus" = entrance in Latin — the inputs provided at cast time */
  aditus: Record<string, unknown>

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
  /**
   * Hard deadline for this execution.
   * A nascens actum past this timestamp is stuck — the cursor never reported back.
   * Recovery: find via Actorum.findExpired(), call ActumCompletor.fail() on each.
   * This releases all locked signa back to the payer with zero charge.
   */
  expirat: Date
}

/** "Acta" — nominative plural of actum. A series of acts. */
export type Acta = Actum[]
