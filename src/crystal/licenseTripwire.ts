// =============================================================================
// licenseTripwire — the conditional-license revenue safety valve (ADR-0012/0013 §5)
// =============================================================================
//
// `isCatalogEligible` admits `conditional` licenses (Krea 2 <$1M, Stability SD3/3.5) into the
// public catalog ON THE PROMISE that we watch company-wide revenue and pre-negotiate an enterprise
// license before crossing the cap. THIS is that watch. It compares the ONE company-wide trailing-
// 12-month USD revenue scalar `R` (the revenue book's rollup) against the tightest cap of any
// conditional model currently reachable in the public catalog, and fires an edge-triggered alert on
// band transitions so counsel acts BEFORE the crossing — a `breach` is a real compliance incident.
//
// CRYSTAL REDUCTION (docs/spec/conditional-license-revenue.md): the cap is a property of *us*
// (total revenue), not of any model's usage — so there is NO per-model revenue attribution here,
// just one scalar vs the min active cap. Cheap: one indexed range-sum + a min over a tiny set.
//
// The seam is `onThresholdBand` — fired on transitions only; the default wiring logs (breach LOUD).
// Everything richer (auto-open a task, gate new promotions at warn) is a later consumer of the seam.
// =============================================================================

import type { Redituum } from '../types/reditus.js'
import { USD } from '../types/reditus.js'
import type { Intellarum } from '../types/intelligendi.js'
import { activeConditionalLicenses, bindingCapUsd } from './modelLicense.js'
import { makeLogger } from '../lib/logger.js'

const log = makeLogger('license-tripwire')

/** Where `R` sits against the binding cap. Order = escalation; only 'breach' is over the cap. */
export type ThresholdBand = 'clear' | 'watch' | 'warn' | 'breach'

/**
 * Classify `R` (micro-USD) against `capMicroUsd` (micro-USD). `null` cap = no conditional model is
 * catalog-active → dormant → always 'clear'. Pure integer ratio math (cross-multiply, no float) so a
 * value summed against the $1M cap never drifts. Bands (spec §The tripwire):
 *   clear  R/cap < 0.75 · watch [0.75,0.90) · warn [0.90,1.00) · breach ≥ 1.00
 */
export function band(R: bigint, capMicroUsd: bigint | null): ThresholdBand {
  if (capMicroUsd === null || capMicroUsd <= 0n) return 'clear'
  const r100 = R * 100n
  if (r100 < capMicroUsd * 75n) return 'clear'
  if (r100 < capMicroUsd * 90n) return 'watch'
  if (r100 < capMicroUsd * 100n) return 'warn'
  return 'breach'
}

/** The context handed to the alert seam — the numbers a responder needs to act. */
export interface TripwireContext {
  /** Company-wide trailing-12mo USD revenue, micro-USD. */
  R: bigint
  /** The tightest active cap in WHOLE USD, or null when dormant (no conditional model catalog-active). */
  bindingCapUsd: number | null
  /** The distinct conditional license ids currently reachable in the public catalog. */
  licenses: string[]
}

/**
 * The alert seam: called on a band TRANSITION only (edge-triggered, no per-tick spam). Initial
 * wiring = log + ops alert; later consumers can auto-open tasks or gate promotions. May be async.
 */
export type OnThresholdBand = (
  prev: ThresholdBand | null,
  next: ThresholdBand,
  ctx: TripwireContext,
) => void | Promise<void>

/** The default seam: structured logs, LOUD on breach (a live compliance incident). */
export const logThresholdBand: OnThresholdBand = (prev, next, ctx) => {
  const detail = { prev, next, R_microUsd: ctx.R.toString(), bindingCapUsd: ctx.bindingCapUsd, licenses: ctx.licenses }
  switch (next) {
    case 'breach':
      log.error('LICENSE CAP BREACH — a conditional-licensed model is catalog-active while revenue is OVER its cap. Compliance incident: hold an enterprise license or DELIST now (ADR-0012).', detail)
      break
    case 'warn':
      log.warn('license cap WARN (≥90%) — pre-negotiate the enterprise license NOW, before crossing (ADR-0012).', detail)
      break
    case 'watch':
      log.warn('license cap WATCH (≥75%) — start the counsel/enterprise-license conversation.', detail)
      break
    default:
      log.info('license cap band cleared — back under 75% of the binding cap (or dormant).', detail)
  }
}

/** The persisted band state — one document, so transitions survive restarts. */
export interface TripwireBandState {
  band: ThresholdBand
  /** Trailing-12mo revenue at the last evaluation, micro-USD (audit). */
  R: bigint
  /** The binding cap (whole USD) at the last evaluation, or null when dormant. */
  bindingCapUsd: number | null
  /** When this state was written. */
  at: Date
}

/**
 * Persistence for the last band. A SINGLE-document store: the tripwire needs only "what band were we
 * in last time" to detect a transition across restarts.
 */
export interface TripwireBandStore {
  /** The last persisted state, or null before the first-ever evaluation. */
  last(): Promise<TripwireBandState | null>
  /** Overwrite the single state doc with the latest evaluation. */
  save(state: TripwireBandState): Promise<void>
}

/** In-memory band store (tests + the contract proof; the real store is Mongo). */
export class MemoryTripwireBandStore implements TripwireBandStore {
  private state: TripwireBandState | null = null
  async last(): Promise<TripwireBandState | null> { return this.state }
  async save(state: TripwireBandState): Promise<void> { this.state = state }
}

export interface TripwireDeps {
  redituum: Pick<Redituum, 'trailingUsdRevenue'>
  intellarum: Pick<Intellarum, 'list'>
  bandStore: TripwireBandStore
  /** Alert seam; defaults to `logThresholdBand`. */
  onThresholdBand?: OnThresholdBand
}

/** The result of one evaluation — the live figures + whether the band moved. */
export interface TripwireEvaluation extends TripwireContext {
  band: ThresholdBand
  prev: ThresholdBand | null
  /** True when the band differs from the last persisted band. */
  transitioned: boolean
}

/**
 * Compute the binding cap in micro-USD (bigint) for a set of active conditional licenses, or null
 * when none bind. Pure — shared by the evaluator and the read-only admin report.
 */
export function bindingCapMicroUsd(licenses: Iterable<string>): bigint | null {
  const capUsd = bindingCapUsd(licenses)
  return capUsd === null ? null : BigInt(capUsd) * USD
}

/**
 * One evaluation pass: read `R`, find the catalog-active conditional licenses + their binding cap,
 * classify the band, and — on a TRANSITION — fire the seam, then persist the new band. Idempotent
 * within a band: repeated calls at the same band don't re-alert (persisted-state comparison). The
 * dormant baseline (first-ever eval landing on 'clear') does NOT alert. `now` is injectable for tests.
 */
export async function evaluateTripwire(deps: TripwireDeps, now: Date = new Date()): Promise<TripwireEvaluation> {
  const R = await deps.redituum.trailingUsdRevenue(now)
  const models = await deps.intellarum.list()
  const licenses = activeConditionalLicenses(models)
  const capMicro = bindingCapMicroUsd(licenses)
  const capUsd = bindingCapUsd(licenses)
  const next = band(R, capMicro)

  const prevState = await deps.bandStore.last()
  const prev = prevState?.band ?? null
  const transitioned = prev !== next

  // Fire on a real transition. Suppress the dormant baseline (no prior state, landing on 'clear') —
  // booting into a quiet state is not an event worth an ops alert.
  const shouldAlert = transitioned && !(prev === null && next === 'clear')
  if (shouldAlert) {
    await (deps.onThresholdBand ?? logThresholdBand)(prev, next, { R, bindingCapUsd: capUsd, licenses })
  }

  await deps.bandStore.save({ band: next, R, bindingCapUsd: capUsd, at: now })
  return { band: next, prev, transitioned, R, bindingCapUsd: capUsd, licenses }
}

/**
 * Start the tripwire on an interval (edge-triggered per evaluation via the persisted band). The cap
 * is a slow-moving compliance line, so the default cadence is generous (every 6h); latency only
 * bounds how quickly a crossing is noticed, not correctness. Returns a stop() handle. Mirrors
 * `startSubsidySweeper`, plus one IMMEDIATE evaluation at startup so a state that changed while the
 * process was down (or a deploy landing into `breach`) is caught now rather than up to a cycle later
 * — safe because it's edge-triggered off the persisted band, so it only alerts on a real transition.
 * Pass `immediate: false` to skip the boot-time tick (tests that drive `evaluateTripwire` directly).
 */
export function startLicenseTripwire(
  deps: TripwireDeps,
  opts: { intervalMs?: number; onError?: (err: unknown) => void; now?: () => Date; immediate?: boolean } = {},
): { stop: () => void } {
  const intervalMs = opts.intervalMs ?? 6 * 60 * 60 * 1000 // every 6 hours
  const tick = (): void => {
    evaluateTripwire(deps, (opts.now ?? (() => new Date()))()).catch(err => opts.onError?.(err))
  }
  if (opts.immediate !== false) tick()   // boot-time evaluation (edge-triggered → no spam on a steady band)
  const handle = setInterval(tick, intervalMs)
  if (typeof handle.unref === 'function') handle.unref()
  return { stop: () => clearInterval(handle) }
}
