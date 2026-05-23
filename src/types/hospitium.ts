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

  /** The Materia this hosting record pairs with. 1:1. */
  materiaId: string

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
}

/** "Hospitia" — nominative plural of hospitium. */
export type Hospitia = Hospitium[]

/**
 * HospitiumStore — persistence for the host-guest bond records.
 */
export interface HospitiumStore {
  create(input: Omit<Hospitium, 'id'>): Promise<Hospitium>
  findByMateriaId(materiaId: string): Promise<Hospitium | null>
  update(materiaId: string, patch: Partial<Pick<Hospitium, 'adminAnimaIds' | 'terminatum'>>): Promise<Hospitium>
}
