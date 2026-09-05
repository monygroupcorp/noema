import type { MateriaStore, Materia } from '../types/materia.js'
import type { HospitiumStore, Hospitium } from '../types/hospitium.js'
import type { Signorum } from '../types/significandi.js'
import type { ModoStore } from '../types/modo.js'
import type { Nexus } from '../types/nexus.js'
import { impetusForPodMs } from '../ledger/rates.js'
import { bus } from '../lib/bus.js'
import { makeLogger } from '../lib/logger.js'

const log = makeLogger('crystal:census')

/** Materia statuses for which we run the billing meter. Terminated/null = skip. */
const BILLABLE_STATUSES = new Set(['idle', 'active', 'provisioning', 'bootstrapping'])

/**
 * How long a draining studio may go on billing before the idle reaper takes it
 * whatever its status — the grace an in-flight gen has to finish in. Stamped onto
 * `Materia.drainUntil` the moment drain engages; that field says why a status-blind
 * deadline is needed at all.
 *
 * 15 minutes is not a new policy — it is the actum expiry the platform already
 * enforces (`DEFAULT_EXPIRAT_MS` in ActumInceptor). A gen still running past its own
 * expiry is one the expiry reaper has already failed, so a studio still draining past
 * that window is holding nothing this deadline could cut short.
 */
export const DRAIN_GRACE_MS = 15 * 60 * 1000

export interface CensusDeps {
  hospitia: HospitiumStore
  materiae: MateriaStore
  signorum: Signorum
  nexus: Nexus
  /** Session store — when present, Census ALSO enforces the studio's budget tessera
   *  (`maxImpetus` watchdog): a studio whose accrued spend crosses its authorized
   *  `sessionBudget` drains, independent of the host's balance. Absent → balance-only. */
  modos?: ModoStore
}

/**
 * Census — the host's continuous per-time cost reckoning (the studio billing tick).
 *
 * "census" = the periodic Roman assessment/reckoning; here, the recurring
 * assessment of impetus against each live hosted session.
 *
 * Every `intervalMs` (default 60s), walks active Hospitia and bills the host
 * `secondsSinceLastTick × Materia.impetusPerSecond` impetus. Implements:
 *
 *   - **Balance clamping**: if host's balance can't cover the full ask, debit
 *     only what's available; the shortfall is recorded by leaving `costAccrued`
 *     short of the conceptual debt.
 *   - **Drain-on-zero gating**: when clamping kicks in, set Materia.drainOnly
 *     and emit `studio.draining`. Admission control (refusing new guest gens)
 *     and the idle reaper's drain-terminate behavior are the consumers.
 *   - **Restart resilience**: `Hospitium.lastBilledAt` persists; on the next
 *     tick after a restart we bill from the last persisted timestamp, not the
 *     restart instant — no skipped windows, no double-bills.
 *
 * Returns a stop function (clears the interval). Same shape as `idleReaper`.
 */
export function startCensus(
  deps: CensusDeps,
  intervalMs = 60_000,
): () => void {
  const tick = async (): Promise<void> => {
    try {
      const active = await deps.hospitia.findActive()
      for (const h of active) {
        await censere(deps, h).catch(err =>
          log.warn('census tick failed', { materiaId: h.materiaId, error: String(err) }))
      }
    } catch (err) {
      log.warn('census sweep failed', { error: String(err) })
    }
  }

  const timer = setInterval(() => { void tick() }, intervalMs)
  if (typeof timer.unref === 'function') timer.unref()
  return () => clearInterval(timer)
}

/**
 * Assess (reckon + bill) a single Hospitium for one tick. Exported for direct
 * invocation on phase transitions (so we don't lose impetus straddling a 60s
 * window when state changes mid-window). Idempotent on no-elapsed-time.
 */
export async function censere(
  deps: CensusDeps,
  hospitium: Hospitium,
  now: Date = new Date(),
): Promise<{ requested: bigint; charged: bigint; drainEngaged: boolean }> {
  // An in-flight studio record (no pod parked yet) has no `materiaId` — nothing to
  // bill until its pod binds. Skip it cleanly.
  if (!hospitium.materiaId) return { requested: 0n, charged: 0n, drainEngaged: false }
  const materia = await deps.materiae.findById(hospitium.materiaId)
  if (!materia || !BILLABLE_STATUSES.has(materia.status)) {
    return { requested: 0n, charged: 0n, drainEngaged: false }
  }

  const lastBilledAt = hospitium.lastBilledAt ?? hospitium.inceptum
  const secondsElapsed = Math.floor((now.getTime() - lastBilledAt.getTime()) / 1000)
  if (secondsElapsed <= 0) {
    return { requested: 0n, charged: 0n, drainEngaged: false }
  }

  // Bill the elapsed window from the pod's real hourly cost, rounding ONCE — the
  // fidelity-correct charge (no per-second `ceil` skew). Legacy pods with no stored
  // `costPerHr` fall back to the coarse per-second rate.
  const requested = materia.costPerHr
    ? impetusForPodMs(secondsElapsed * 1000, materia.costPerHr)
    : BigInt(secondsElapsed) * materia.impetusPerSecond
  if (requested === 0n) {
    // Sub-rounding window or a free-tier/test pod — just advance the clock.
    await deps.hospitia.update(hospitium.materiaId, { lastBilledAt: now }).catch(() => {})
    return { requested: 0n, charged: 0n, drainEngaged: false }
  }

  // Clamp to available balance — the hook is pure and cannot read balance, so
  // clamping happens here in the side-effect layer.
  const balance = await deps.signorum.balance(hospitium.hostKey)
  const charged = balance < requested ? (balance > 0n ? balance : 0n) : requested

  if (charged > 0n) {
    const signa = await deps.nexus.emit({
      type: 'studio_spend',
      payload: {
        materiaId: hospitium.materiaId,
        hostKey: hospitium.hostKey,
        impetus: charged,
        seconds: secondsElapsed,
      },
    })
    if (signa.length) await deps.signorum.createMany(signa)
  }

  const newCost = (hospitium.costAccrued ?? 0n) + charged
  await deps.hospitia.update(hospitium.materiaId, {
    costAccrued: newCost,
    lastBilledAt: now,
  }).catch(() => {})

  // Two drain triggers, both engaging the SAME drainOnly mode (admission control
  // refuses new guest gens; the idle reaper terminates once the queue drains, or at
  // `drainUntil` if the pod never makes it back to idle):
  //   1. Balance shortfall — the host couldn't cover the full ask this tick.
  //   2. Budget exhaustion (the `maxImpetus` watchdog) — the studio's total accrued
  //      spend (warm-time `costAccrued` + run `impetusAccrued`) crossed the
  //      authorized session budget (the tessera valor). Only when a `modos` store
  //      is wired; absent → balance-only behavior (unchanged).
  const balanceShortfall = charged < requested
  const budgetExhausted = await isOverBudget(deps, materia, newCost)
  let drainEngaged = false
  if ((balanceShortfall || budgetExhausted) && !materia.drainOnly) {
    await deps.materiae.update(materia.id, {
      drainOnly: true,
      drainUntil: new Date(now.getTime() + DRAIN_GRACE_MS),
    }).catch(() => {})
    bus.emit('studio.draining', { materiaId: materia.id })
    log.info('studio entered drain mode', {
      materiaId: materia.id, reason: budgetExhausted ? 'budget' : 'balance',
      requested: requested.toString(), charged: charged.toString(),
    })
    drainEngaged = true
  } else if (materia.drainOnly && !materia.drainUntil) {
    // Already draining with no deadline on it: a studio that entered drain before
    // `drainUntil` existed, so nothing would ever reap it off `active`. Give it the
    // same grace from now rather than backfilling a deadline that may already have
    // passed — an in-flight gen on it is still owed its window.
    await deps.materiae.update(materia.id, {
      drainUntil: new Date(now.getTime() + DRAIN_GRACE_MS),
    }).catch(() => {})
  }

  return { requested, charged, drainEngaged }
}

/**
 * The `maxImpetus` watchdog check: true when the studio's bound session has a
 * budget tessera AND its total accrued spend (this tick's warm-time cost +
 * accumulated run impetus) has reached/exceeded it. Returns false when no `modos`
 * store is wired, no bound session exists, or the session opened with no budget.
 */
async function isOverBudget(deps: CensusDeps, materia: Materia, costAccruedNow: bigint): Promise<boolean> {
  if (!deps.modos) return false
  const modo = (await deps.modos.findActive().catch(() => []))
    .find(m => m.materiamId === materia.id)
  if (!modo) return false
  const budget = await deps.signorum.sessionBudget(modo.id).catch(() => 0n)
  if (budget <= 0n) return false
  return costAccruedNow + modo.impetusAccrued >= budget
}
