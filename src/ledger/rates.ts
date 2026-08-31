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
 * The platform REFERENCE pod rate, USD/hour — the rate at which one impetus point is
 * exactly one second of pod-time (3600 s × $1.2132/hr ÷ $0.000337 = 3600 pts). It had
 * been stated only in `IMPETUS_USD_RATE`'s prose above; exported here so seconds→impetus
 * conversions read it from code rather than restating it, and so a change to the reference
 * rate cannot silently desync a caller that was relying on the 1 s ≡ 1 impetus identity.
 */
export const REFERENCE_COST_PER_HR = 1.2132

/**
 * Micro-USD per impetus point — the integer form of IMPETUS_USD_RATE for exact bigint conversion
 * of USD revenue → credits at the deposit boundary. 1 impetus = $0.000337 = 337 micro-USD. This
 * is the CANONICAL buy/spend rate (== the published ratesApi rate, 2967 pts/USD); do NOT use the
 * legacy 0.00037 straggler (2703 pts/USD — a typo; the arcanum weiToCredits path was reconciled to
 * this canonical rate + funding on 2026-07-02).
 */
export const MICRO_USD_PER_IMPETUS = 337n

/** Convert a micro-USD amount to impetus points (floor). The buy-side conversion. */
export function usdMicroToImpetus(usdMicro: bigint): bigint {
  return usdMicro / MICRO_USD_PER_IMPETUS
}

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
 * The impetus cost of `ms` milliseconds of pod wall-time at a given hourly USD
 * rate — rounded ONCE over the whole window:
 *
 *   impetus = ceil((ms × costPerHr / 3_600_000) / IMPETUS_USD_RATE)
 *
 * This is the fidelity-correct conversion: rounding the *window* (not a per-second
 * rate) avoids the regressive `ceil`-every-second skew that over-charges cheap
 * pods. The single canonical pod-time→impetus function; `Census` (warm-time meter)
 * and boot-cost both bill through it. Ceil so the platform/host is never
 * under-credited by a rounding step. Zero/negative inputs → 0n.
 *
 * The ceil absorbs a relative 1e-9 of binary floating-point noise first. Windows that
 * are an exact whole number of points in decimal — e.g. 172 s at the reference rate,
 * which is exactly 172 — land a few ulps above the integer once divided, and a bare
 * `Math.ceil` would bill the next whole point for that artifact alone. The tolerance is
 * many orders of magnitude below one point, so it cannot mask real fractional usage.
 */
export function impetusForPodMs(ms: number, costPerHrUsd: number): bigint {
  if (ms <= 0 || costPerHrUsd <= 0) return 0n
  const usd = (ms / 3_600_000) * costPerHrUsd
  const points = usd / IMPETUS_USD_RATE
  return BigInt(Math.ceil(points - Math.abs(points) * 1e-9))
}

/**
 * Convert a pod's hourly USD rate into impetus points per second. COARSE — it
 * ceils to a whole impetus/sec, so it over-charges pods below the ~$1.21/hr
 * reference (a $0.69/hr pod rounds 0.57→1, a +76% skew). Retained only as a
 * display hint + a legacy fallback for Materiae with no stored `costPerHr`;
 * actual warm-time billing goes through `impetusForPodMs` (per-window).
 */
export function impetusPerSecondFromHourly(costPerHrUsd: number): bigint {
  const usdPerSecond = costPerHrUsd / 3600
  return BigInt(Math.ceil(usdPerSecond / IMPETUS_USD_RATE))
}

/**
 * The bootCost (in impetus) of a cold provisioning — stamped on
 * `Materia.bootCostImpetus` and amortized across guest runs. A window cost, so it
 * delegates to `impetusForPodMs` (round once over `billedMs`).
 */
export function computeBootCostImpetus(billedMs: number, costPerHrUsd: number): bigint {
  return impetusForPodMs(billedMs, costPerHrUsd)
}

// ── Reservation sizing (pod flows) ──────────────────────────────────────────
// What a pod flow holds up-front, before it runs. A reservation must be an UPPER
// BOUND on the real cost: settlement charges the measured cost and refunds the rest,
// but an under-reservation throws `Cursor overcharge` at completion. It is not a
// price — the user is charged what the run actually costs.

/**
 * Safety factor applied to a modelled reservation estimate.
 *
 * The two failure modes are not symmetric, and this factor is sized for the worse one:
 *
 *   too LARGE  — the hold is bigger than the run needs. Every impetus comes back at
 *                settlement, so nothing is spent; the cost is that the hold occupies
 *                purse headroom while it stands, which bounds how many runs of the flow
 *                can be in flight at once (see `reserveHeadroomImpetus`).
 *   too SMALL  — settlement measures a cost above the hold and `ActumCompletor` throws
 *                `Cursor overcharge`, so the run fails at the END, after the pod time has
 *                already been consumed. The caller gets nothing for compute that was
 *                really spent, and in a fan-out the failure lands mid-flight.
 *
 * An over-reservation is recoverable and an under-reservation is not, so the factor stays
 * generous: 2× the fitted estimate.
 *
 * What that 2× has to absorb, on the pod path: the billed window is the runner's own job
 * clock, and it opens BEFORE the weights are on disk — custom-node install, ComfyUI
 * restart and the full weight pull are all inside it, ahead of graph execution. Those
 * stages are network- and registry-bound rather than compute-bound, so they are the widest
 * part of the distribution and the part a fitted sample is least able to bound. Doubling
 * the whole estimate lets the download stage run better than twice as slow as the fit
 * before the reservation is breached.
 */
export const RESERVE_SAFETY_FACTOR = 2

/**
 * The reservation for a pod flow that carries no `Modus.pretium` curve — the bound every
 * un-modelled flow uses.
 *
 * Derivation: 2 × the observed cold-start p95 of 402 s, rounded up, taken across flows
 * rather than within one. Cold start is the worst realistic case (it carries a full weight
 * download inside the billed window), the 2× factor covers a flow slower than any yet
 * measured, and 900 sits above the highest cold wall-clock on record (511 s) while staying
 * well under the 1800 s job-timeout ceiling.
 *
 * Cross-flow is what makes it coarse: one number has to bound a 512² image flow and a video
 * flow with tens of gigabytes of weights, so it is set by the expensive end and every cheap
 * flow that lands on it reserves far above its own cost. That is the cost of the fallback,
 * not a defect in it — a flow escapes it by declaring its own `pretium` (see
 * `Modus.pretium`), which is a per-flow act that happens flow by flow as each accumulates
 * enough completed runs to fit a curve. Flows carrying a fitted curve today: `sd1-5`,
 * `krea-turbo`. Everything else — including every video, audio and 3D flow — reserves here.
 */
export const GENERIC_RESERVE_IMPETUS = 900n

/**
 * The purse headroom a fan-out needs, in impetus: the per-run reservation times the number
 * of pieces it keeps in flight. A `Collectio` with `concurrentia` C holds C reservations
 * simultaneously, so C × reserve — not the collection's eventual total cost — is what has
 * to fit in the purse for the fan-out to reach full width.
 *
 * The cold-start term is PER CONCURRENT SLOT, not per collection. `Cursor.reserve()` runs
 * before pod routing and cannot know whether a job will land warm, so every in-flight run
 * holds the full cold case; and that is not merely conservative bookkeeping — C dispatches
 * issued together all miss `Praefectus.findWarm` at the same instant and each provisions
 * its own pod, so C cold starts really are paid. A model that amortised one cold start
 * across a collection would under-reserve exactly the runs that pay one, which is the
 * failure mode `RESERVE_SAFETY_FACTOR` exists to avoid.
 *
 * Consequence for calibration: a per-flow curve's `baseSeconds` must stay the flow's whole
 * cold overhead. Shrinking it on the argument that most pieces in a large collection land
 * warm is the amortisation this function rules out.
 */
export function reserveHeadroomImpetus(perRunReserve: bigint, concurrentia: number): bigint {
  if (!Number.isFinite(concurrentia) || concurrentia <= 0) return 0n
  if (perRunReserve <= 0n) return 0n
  return perRunReserve * BigInt(Math.floor(concurrentia))
}

/**
 * The reservation implied by a flow's own cost curve, in impetus:
 *
 *   ceil( SAFETY × ( baseSeconds
 *                  + perStepSeconds      × steps
 *                  + perMegapixelSeconds × (width × height / 1e6) ) )
 *
 * Always the COLD case — `reserve()` is called before pod routing, so it cannot know
 * whether the job will land on a warm pod; `baseSeconds` therefore carries the flow's own
 * download + load overhead, the part of a cold run that falls inside the billed window.
 * There is no separate global download allowance: that stage is flow-specific (it is the
 * flow's own weight set) and already inside `baseSeconds`.
 *
 * Input resolution, per term: the run's own `aditus` value when it is a finite number,
 * else the flow's schema default (`Forma[key].default`) when that is a finite number. If
 * a term the curve needs has NEITHER, this returns `null` and the caller falls back to
 * `GENERIC_RESERVE_IMPETUS` — a missing term is never treated as 0, which would
 * under-reserve and trip `Cursor overcharge`.
 *
 * Seconds convert to impetus through `impetusForPodMs` at `REFERENCE_COST_PER_HR` rather
 * than relying on the 1 s ≡ 1 impetus identity, so the two cannot desync. Pure, no I/O —
 * it is reached from the public quote route.
 */
export function reservationImpetus(params: {
  pretium: Pretium
  /** The flow's declared input schema, for per-term defaults. */
  forma?: Forma
  /** The run's supplied inputs. */
  aditus?: Record<string, unknown>
}): bigint | null {
  const { pretium, forma, aditus } = params

  const resolve = (key: string): number | null => {
    const supplied = aditus?.[key]
    if (typeof supplied === 'number' && Number.isFinite(supplied)) return supplied
    const fallback = forma?.[key]?.default
    if (typeof fallback === 'number' && Number.isFinite(fallback)) return fallback
    return null
  }

  if (!Number.isFinite(pretium.baseSeconds)) return null
  let seconds = pretium.baseSeconds

  if (pretium.perStepSeconds !== undefined) {
    const steps = resolve('steps')
    if (steps === null) return null
    seconds += pretium.perStepSeconds * steps
  }

  if (pretium.perMegapixelSeconds !== undefined) {
    const width = resolve('width')
    const height = resolve('height')
    if (width === null || height === null) return null
    seconds += pretium.perMegapixelSeconds * ((width * height) / 1_000_000)
  }

  if (!Number.isFinite(seconds) || seconds <= 0) return null
  const estimate = impetusForPodMs(RESERVE_SAFETY_FACTOR * seconds * 1000, REFERENCE_COST_PER_HR)
  return estimate > 0n ? estimate : null
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
import type { Forma, Pretium } from '../types/modus.js'

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
