import type { MateriaStore, Materia } from '../types/materia.js'
import type { HospitiumStore, Hospitium } from '../types/hospitium.js'
import type { Signorum } from '../types/significandi.js'
import type { Nexus } from '../types/nexus.js'
import { bus } from '../lib/bus.js'
import { makeLogger } from '../lib/logger.js'

const log = makeLogger('crystal:studio-billing')

/** Materia statuses for which we run the billing meter. Terminated/null = skip. */
const BILLABLE_STATUSES = new Set(['idle', 'active', 'provisioning', 'bootstrapping'])

export interface StudioBillingDeps {
  hospitia: HospitiumStore
  materiae: MateriaStore
  signorum: Signorum
  nexus: Nexus
}

/**
 * Studio billing tick — the host's continuous per-time cost meter.
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
export function startStudioBilling(
  deps: StudioBillingDeps,
  intervalMs = 60_000,
): () => void {
  const tick = async (): Promise<void> => {
    try {
      const active = await deps.hospitia.findActive()
      for (const h of active) {
        await billOne(deps, h).catch(err =>
          log.warn('studio billing tick failed', { materiaId: h.materiaId, error: String(err) }))
      }
    } catch (err) {
      log.warn('studio billing sweep failed', { error: String(err) })
    }
  }

  const timer = setInterval(() => { void tick() }, intervalMs)
  if (typeof timer.unref === 'function') timer.unref()
  return () => clearInterval(timer)
}

/**
 * Bill a single Hospitium for one tick. Exported for direct invocation on phase
 * transitions (so we don't lose impetus straddling a 60s window when state
 * changes mid-window). Idempotent on no-elapsed-time.
 */
export async function billOne(
  deps: StudioBillingDeps,
  hospitium: Hospitium,
  now: Date = new Date(),
): Promise<{ requested: bigint; charged: bigint; drainEngaged: boolean }> {
  const materia = await deps.materiae.findById(hospitium.materiaId)
  if (!materia || !BILLABLE_STATUSES.has(materia.status)) {
    return { requested: 0n, charged: 0n, drainEngaged: false }
  }

  const lastBilledAt = hospitium.lastBilledAt ?? hospitium.inceptum
  const secondsElapsed = Math.floor((now.getTime() - lastBilledAt.getTime()) / 1000)
  if (secondsElapsed <= 0) {
    return { requested: 0n, charged: 0n, drainEngaged: false }
  }

  const requested = BigInt(secondsElapsed) * materia.impetusPerSecond
  if (requested === 0n) {
    // costPerSecond rounded to zero (free-tier or test pods) — just advance the clock.
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

  // Drain-on-zero: short-fall means the host couldn't cover the full ask.
  // Engage drainOnly mode so admission control refuses new guest gens; idle
  // reaper terminates when the queue drains.
  let drainEngaged = false
  if (charged < requested && !materia.drainOnly) {
    await deps.materiae.update(materia.id, { drainOnly: true }).catch(() => {})
    bus.emit('studio.draining', { materiaId: materia.id })
    log.info('studio entered drain mode', { materiaId: materia.id, requested: requested.toString(), charged: charged.toString() })
    drainEngaged = true
  }

  return { requested, charged, drainEngaged }
}
