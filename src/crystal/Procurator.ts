// =============================================================================
// PROCURATOR — the ring role that procures + manages a studio's Materia
// =============================================================================
//
// "procurator" = the Roman estate agent/steward who procures and manages
// property on the owner's behalf. Here it is the studio-provisioning ring role:
// the seam that brings a warm `Materia` (a live GPU pod) into being and parks it.
//
// This is a RING ROLE, not a provider. The provider implementations stay
// provider-named UNDER this interface — `SecurePodClient` (RunPod SECURE),
// `WarmPodClient` (warm-pool reuse) — so `Conductor` (the studio-lifecycle
// anchor) and the adapters compose against the role, never a concrete provider.
//
// Sibling to `Praefectus` (the warm-pool *scheduler* that PICKS a pod): the
// Praefectus chooses; the Procurator procures + parks. Conductor leases + binds.
// =============================================================================

import type { ProvisioningContext } from './RunPodCursor.js'
import type { StageInfo } from '../lib/bus.js'

/** Live provisioning telemetry callback — drives the bulletin journal / SSE. */
export type StudioStageCb = (stage: string, info?: StageInfo) => void

/** What a successful provision yields: the parked pod's id + cost telemetry. */
export interface StudioProvision {
  podId: string
  gpuType?: string
  costPerHr?: number
  provisionMs: number
}

/**
 * Procurator — procure + park a warm `Materia` for a studio (no gen submitted).
 *
 * `provisionStudio` provisions a pod, bootstraps the runtime to ready, and parks
 * it warm — pairing a `Hospitium` keyed by `provisioningContext.hostKey` when the
 * host is known. Returns the parked pod's handle, or `null` on provision failure.
 */
export interface Procurator {
  provisionStudio(
    opts?: { runtime?: string; warmMs?: number; provisioningContext?: ProvisioningContext },
    onStage?: StudioStageCb,
  ): Promise<StudioProvision | null>
}
