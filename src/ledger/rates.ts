// =============================================================================
// rates — platform-wide economic constants
// =============================================================================
// One named home for the platform's economic dials. JSDoc has documented these
// numbers in five places; this is where the *code* reads them from. Treat as
// platform constants, not per-host knobs — those are explicitly out of scope
// for v1 of the hosting layer.

/**
 * USD value of one impetus point.
 * 1 impetus point = $0.000337 = 1 second of RunPod SECURE pod-time at the
 * platform reference rate ($1.2132/hr). A pod that costs more per hour simply has
 * a proportionally higher `Materia.impetusPerSecond`.
 */
export const IMPETUS_USD_RATE = 0.000337

/**
 * Target number of guest gens across which a host's cold-start cost is amortized:
 *
 *   bootShare(materia) = ceil(materia.bootCostImpetus / BOOT_AMORTIZE_OVER)
 *
 * The surcharge stops once `Materia.bootRecovered >= bootCostImpetus`. Smaller =
 * faster recovery, higher per-guest premium; larger = gentler per guest, more
 * gens before host breaks even. 5 is a defensible starting point — dial later.
 */
export const BOOT_AMORTIZE_OVER = 5n

// ── helpers ─────────────────────────────────────────────────────────────────

/**
 * Convert a pod's hourly USD rate into impetus points per second (the figure
 * stored on `Materia.impetusPerSecond`). Used when provisioning a pod whose
 * hourly cost is known from the provider.
 */
export function impetusPerSecondFromHourly(costPerHrUsd: number): bigint {
  const usdPerSecond = costPerHrUsd / 3600
  return BigInt(Math.ceil(usdPerSecond / IMPETUS_USD_RATE))
}

/**
 * Compute the bootCost (in impetus points) of a cold provisioning — the figure
 * stamped on `Materia.bootCostImpetus` and amortized across guest runs.
 *
 *   bootCostImpetus = ceil((billedMs × costPerHr / 3_600_000) / IMPETUS_USD_RATE)
 *
 * Ceil so the host is never under-credited by a rounding step.
 */
export function computeBootCostImpetus(billedMs: number, costPerHrUsd: number): bigint {
  if (billedMs <= 0 || costPerHrUsd <= 0) return 0n
  const usd = (billedMs / 3_600_000) * costPerHrUsd
  return BigInt(Math.ceil(usd / IMPETUS_USD_RATE))
}

/**
 * The bootShare a guest pays per gen until the host's cold start is recovered.
 * Returns 0 once `bootRecovered >= bootCostImpetus`.
 */
export function bootShare(bootCostImpetus = 0n, bootRecovered = 0n): bigint {
  if (bootCostImpetus <= 0n) return 0n
  if (bootRecovered >= bootCostImpetus) return 0n
  // ceil division of bigints: (a + b - 1n) / b
  return (bootCostImpetus + BOOT_AMORTIZE_OVER - 1n) / BOOT_AMORTIZE_OVER
}

// ── The hosting tier decision (Phase B) ─────────────────────────────────────

import type { Materia } from '../types/materia.js'
import type { Hospitium, HostKey } from '../types/hospitium.js'

export type PricingTier = 'owner' | 'admin' | 'guest'

/**
 * The dispatch-time pricing tier. Reads the hosting metadata only; pure.
 *
 *   owner — runner key matches the host key (animaId↔animaId or commitment↔commitment).
 *   admin — identified runner is in the group's snapshotted admin set.
 *   guest — everyone else, including the defensive fallback for unknown shape /
 *           missing Hospitium (a pod with no hosting record gets treated as if
 *           guests pay normal — the dispatch layer can't make any other call).
 *
 * Note: admin requires an identified runner. Anonymous (commitment-only) runners
 * cannot be admins by construction — admin sets are resolved from platform user
 * identifiers via the IdentityResolver, which always yields animaIds.
 */
export function tierOf(runnerKey: HostKey | undefined, hospitium: Hospitium | null): PricingTier {
  if (!runnerKey || !hospitium) return 'guest'
  const host = hospitium.hostKey
  // Owner — same discriminant + same identifier.
  if ('animaId' in runnerKey && 'animaId' in host && runnerKey.animaId === host.animaId) return 'owner'
  if ('commitment' in runnerKey && 'commitment' in host && runnerKey.commitment === host.commitment) return 'owner'
  // Admin — identified runner, listed in the admin snapshot.
  if ('animaId' in runnerKey && hospitium.adminAnimaIds?.includes(runnerKey.animaId)) return 'admin'
  return 'guest'
}

/**
 * The impetus a runner pays for one gen, given their tier + the pod's bootCost.
 * Owner + admin pay base; guest pays base + the amortizing bootShare.
 */
export function impetusFor(tier: PricingTier, materia: Materia, baseImpetus: bigint): bigint {
  if (tier !== 'guest') return baseImpetus
  return baseImpetus + bootShare(materia.bootCostImpetus, materia.bootRecovered)
}

/**
 * The `modoHostAnimaId` value the spend event should carry — only set on guest
 * runs with an identified host. Anonymous-host payouts wait for Phase C, which
 * widens the spend payload to a full HostKey and branches the hostCutHook to
 * mint an arcanum signum.
 */
export function modoHostFor(tier: PricingTier, hospitium: Hospitium | null): { animaId: string } | undefined {
  if (tier !== 'guest' || !hospitium) return undefined
  if ('animaId' in hospitium.hostKey) return { animaId: hospitium.hostKey.animaId }
  return undefined
}
