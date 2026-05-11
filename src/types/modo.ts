// =============================================================================
// MODO — the runtime session context
// =============================================================================
//
// "Modo" is the ablative case of "modus" — meaning "by/in/through a mode."
// The ablative in Latin expresses the instrument or context of action.
// A modo is the live context within which modus executes.
//
// TRIAD: modus defines → modo executes → actum records
//
// A Modo is a persistent, billed session: one pod (materia) bound to one
// identity (via arcanum — anonymously) for a duration, executing many actum.
// The session is the unit of value, not the individual job.
//
// Lifecycle:
//   claiming    → session created, pod not yet provisioned
//   warming     → pod provisioning, models loading (typically 25–90 seconds)
//   active      → user can cast modus, impetus is accruing
//   idle        → no activity, warmth window countdown started (default 300s)
//                 pod still running — user is still billed — just quiet
//   hibernating → warmth window expired, pod terminated, volume retained
//   terminated  → final state — pod gone, volume may persist
//
// ANONYMOUS: Modo has NO identity columns — ever. The hop chain from a
// session back to a real user is deliberately indirect:
//   modo → actum.nullifier → signum(arcanum) → signum(deposit) → anima
// Three hops, access-controlled at each crossing.
// =============================================================================

export type ModoStatus =
  | 'claiming'
  | 'warming'
  | 'active'
  | 'idle'
  | 'hibernating'
  | 'terminated'

/**
 * Modo — a live compute session.
 *
 * One Modo = one Materia (pod) + many Actum (executions) + one volume
 * (persistent storage) + one Anima's Soul loaded — for a duration.
 */
export interface Modo {
  id: string

  /**
   * ── NO IDENTITY COLUMNS — EVER ──────────────────────────────────────────
   * The link from session back to identity deliberately crosses three hops:
   *   modo → actum.nullifier → signum(arcanum) → signum(deposit) → anima
   * Access-controlled at each crossing. Schema-enforced by absence.
   * ─────────────────────────────────────────────────────────────────────────
   */

  status: ModoStatus

  /** FK → Materia. The pod this session is running on. */
  materiamId?: string

  /**
   * Total impetus points accrued in this session so far.
   * "impetus" = force/impulse in Latin — the points consumed.
   * 1 point = $0.000337 = 1 second of RunPod SECURE pod-time.
   * This is a running total; source of truth is the sum of actum.impetus.
   */
  impetusAccrued: bigint

  /**
   * FK[] → Actum. All executions that ran within this session.
   * "acta" = nominative plural of actum — "the acts."
   */
  acta: string[]

  /**
   * Seconds of inactivity before the pod tears down.
   * Default: 300 (5 minutes). User-configurable per account.
   * During the warmth window the user is still billed — they're still renting.
   * After expiry: status → 'hibernating', pod terminates, volume persists.
   */
  idleWarmthSec: number

  /** "inceptum" = begun in Latin — when this session started */
  inceptum: Date
  /** "terminatum" = terminated — when this session ended */
  terminatum?: Date
}

/** Collection of modo instances */
export type Modes = Modo[]
