// =============================================================================
// HOSPITIUM — the identity-bearing half of a pod's hosting metadata
// =============================================================================
//
// "hospitium" — hospitality / a guest-host bond in Latin. The Roman institution
// of formal hospitium recorded the host-guest relationship outside the household
// proper; this collection records the identity side of pod hosting outside the
// Materia.
//
// Materia is identity-blind by invariant ("the pod does not know who is using it").
// Hosting economics, however, must know:
//   - who the HOST is (to credit hostCut + bootRecovered)
//   - who the ADMINS are in a group chat (to grant at-cost access)
//
// We keep those identity-bearing facts off the Materia and out of the pod's data
// path. The orchestration / dispatch / ledger layer reads Hospitium when it needs
// to make a pricing or routing decision; the Materia row itself remains free of
// anima identifiers.
//
// Lifecycle: created alongside Materia at warm-park; updated (admin refresh) by
// the platform adapter; kept past Materia termination for audit/billing trails.
// =============================================================================

/**
 * Hospitium — the host-guest bond record for one pod.
 *
 * Keyed by `materiaId` (1:1 with Materia). Read by the dispatch layer at every
 * `/make` to compute pricing tier + whether to set `modoHostAnimaId` on
 * `execution_spend`; updated when the host refreshes the admin set; never read
 * by the pod itself.
 */
/**
 * Either side of the AuctorKey union — identified anima OR anonymous arcanum
 * commitment. A host who runs identified receives hostCut as a `reward` signum to
 * their anima; a host who runs anonymously receives hostCut as an `arcanum` signum
 * keyed by the commitment (queryable via Signorum.balance({commitment})). Both
 * modes are first-class — no de-anonymizing pressure to earn from hosting.
 */
export type HostKey =
  | { animaId: string }
  | { commitment: string }

export interface Hospitium {
  id: string

  /**
   * The Materia (pod) this record pairs with. 1:1 — but OPTIONAL: a studio's host
   * record is created when the studio opens (keyed by `modoId`), before its pod
   * exists; `materiaId` is attached at park (`bindMateria`). Always present for a
   * gen-warm pod's record (no `modoId`) and for a bound studio.
   */
  materiaId?: string

  /**
   * The studio session (Modo) this record hosts. Present for STUDIO host records
   * (created by the `Conductor` at `openModo`, so an in-flight studio is owner-
   * scoped before its pod parks). Absent for plain gen-warm pod records.
   */
  modoId?: string

  /**
   * The economic owner — receives hostCut + accrues Materia.bootRecovered as guests
   * cook. Identified (animaId) or anonymous (commitment). The hostCut payout path
   * branches on this at signum-emission time.
   */
  hostKey: HostKey

  /**
   * Snapshot of the group chat's admins (animaIds) at provision time, resolved
   * via the platform adapter. Empty/absent for DM-provisioned pods. Group admins
   * ride this pod **at cost** — base impetus, no `modoHostAnimaId` set on their
   * executions, no boot-amortization surcharge. Refreshed on the bulletin's
   * `manage` action.
   */
  adminAnimaIds?: string[]

  /** When the hospitium was opened. */
  inceptum: Date

  /** Mirrors Materia.terminatum when the pod is reaped — kept for audit. */
  terminatum?: Date

  /**
   * Continuous cost the host has accrued for this studio running (impetus points).
   * Incremented by the studio billing tick (`Census`) every 60s + on phase
   * transitions: `secondsElapsed × Materia.impetusPerSecond`. Mirrored against the
   * earnings (sum of hostCut + hospitium signa) for the bulletin's net display.
   */
  costAccrued?: bigint

  /**
   * When the last billing tick was settled. Used by `Census` to compute
   * `secondsSinceLastTick × impetusPerSecond` for the next tick — survives
   * process restarts so we don't double-bill or skip windows.
   */
  lastBilledAt?: Date
}

/** "Hospitia" — nominative plural of hospitium. */
export type Hospitia = Hospitium[]

/**
 * HospitiumStore — persistence for the host-guest bond records.
 */
export interface HospitiumStore {
  create(input: Omit<Hospitium, 'id'>): Promise<Hospitium>
  findByMateriaId(materiaId: string): Promise<Hospitium | null>
  /** Find a studio's host record by its session id (`modoId`) — the owner-scope read
   *  for a studio, including an in-flight one whose pod hasn't parked yet. */
  findByModoId(modoId: string): Promise<Hospitium | null>
  /** Attach the parked pod to a studio's host record (keyed by `modoId`, since the
   *  in-flight record has no `materiaId` yet). Returns the updated record. */
  bindMateria(modoId: string, materiaId: string): Promise<Hospitium>
  update(
    materiaId: string,
    patch: Partial<Pick<Hospitium, 'adminAnimaIds' | 'terminatum' | 'costAccrued' | 'lastBilledAt'>>,
  ): Promise<Hospitium>
  /** Active hospitia (not terminated) — used by the billing ticker (which skips any
   *  that have no `materiaId` yet) and by studio listing. */
  findActive(): Promise<Hospitium[]>
}
