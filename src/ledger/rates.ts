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
 * Flat per-guest-gen surcharge for landing on a warm pod (skip cold start).
 * Set platform-wide, not derived from this specific pod's accounting — guests
 * pay "the going rate to skip cold start anywhere," predictable across pods.
 *
 * 80 impetus ≈ $0.027. Calibrate by observation; revisit when we have data.
 */
export const WARM_SURCHARGE_IMPETUS = 80n

/**
 * Percentage of WARM_SURCHARGE_IMPETUS that flows to the host as the ambassador
 * bonus on every guest gen (hospitiumHook → `forma:'reward'` to animaId or
 * `forma:'arcanum'` to commitment, depending on HostKey discriminant). Platform
 * retains the rest. Symmetric with the 20% platform skim on hostCut.
 */
export const HOST_BONUS_RATE = 80n

/**
 * @deprecated Phase A/B leftover — the per-pod cold-start amortization model
 * was replaced by the flat `WARM_SURCHARGE_IMPETUS`. Kept exported so any
 * stragglers grep cleanly; remove in a follow-up cleanup PR.
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
 * Convert a USD amount into valor (impetus points) credited to a user — the
 * shared USD→valor step every funding rail funnels through after its own
 * token→USD conversion (ETH, ERC-20, OCT all land here identically).
 *
 *   valor = floor(usd / IMPETUS_USD_RATE)      // IMPETUS_USD_RATE === USD_PER_POINT
 *
 * FLOOR, unlike the cost helpers above which ceil: a deposit credits whole
 * points and rounds *down*, so a rounding step never over-credits the user.
 * Negative input clamps to 0n (a deposit can't subtract balance).
 */
export function usdToValor(usd: number): bigint {
  if (!(usd > 0)) return 0n
  return BigInt(Math.floor(usd / IMPETUS_USD_RATE))
}

/**
 * @deprecated Phase A/B leftover. Phase C uses a flat `WARM_SURCHARGE_IMPETUS`
 * instead — guest pricing no longer reads per-pod boot accounting. Retained
 * for a transitional window; remove in a follow-up cleanup PR.
 */
export function bootShare(bootCostImpetus = 0n, bootRecovered = 0n): bigint {
  if (bootCostImpetus <= 0n) return 0n
  if (bootRecovered >= bootCostImpetus) return 0n
  return (bootCostImpetus + BOOT_AMORTIZE_OVER - 1n) / BOOT_AMORTIZE_OVER
}

// ── The hosting tier decision (Phase B + Phase C reframe) ───────────────────

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
 * The impetus a runner pays for one gen. Guests pay the flat WARM_SURCHARGE
 * on top of the base reservation; owner + admin pay base. No Materia read —
 * the surcharge is platform-set, not per-pod.
 */
export function impetusFor(tier: PricingTier, baseImpetus: bigint): bigint {
  return tier === 'guest' ? baseImpetus + WARM_SURCHARGE_IMPETUS : baseImpetus
}

/**
 * The host's key for the spend event payload. Only set on guest runs with a
 * Hospitium; passes through both `{animaId}` (identified host → reward signum)
 * and `{commitment}` (anonymous host → arcanum signum) unchanged. The host-bound
 * hooks (hostCutHook, hospitiumHook) branch on the discriminant.
 */
export function modoHostFor(tier: PricingTier, hospitium: Hospitium | null): HostKey | undefined {
  if (tier !== 'guest' || !hospitium) return undefined
  return hospitium.hostKey
}
