// =============================================================================
// MandatumRunner — the standing order, driven off the store
// =============================================================================
//
// A Mandatum is a standing instruction ("keep trying to train this for me"). This
// runner is what makes one move: it claims due orders off the Mandatorum, watches the
// attempt each one is waiting on, and — when that attempt failed for a reason another
// machine could fix — asks again, on the hour, until the order is fulfilled, answered,
// or out of time.
//
// SHAPE: copied from `PublicationWorker` — the store IS the queue. `drainOnce()` is one
// pass over the claimable set; `start()` runs it on an interval, in-process, beside the
// other reapers. Durability lives in the store's atomic claim, not in this loop, so
// lifting it into its own container later is a thin entrypoint and no rewrite.
//
// TWO MODES, one discriminant. `pendens` (the attempt whose outcome is awaited) is set →
// WATCH: read that attempt's outcome and decide. `pendens` clear → FIRE: start the next
// attempt. One order therefore never has two runs in flight.
//
// MONEY: this runner decides WHEN to ask again and nothing else. Every attempt is an
// ordinary `invoke` through the same path the first one took, so every gate — freeze,
// content, admission cap, balance — runs again on its own terms, each attempt reserves
// and refunds exactly as a hand-clicked run does, and a failed attempt costs nothing.
// The runner cannot reserve, settle, or refund anything itself.
//
// GUARDS BEFORE EVERY FIRE, in order: the order is still active; the window has not
// closed; attempts remain; the payer still exists. A payer that has been erased ends the
// order — an erased account is not spent on, ever.
// =============================================================================

import type { Mandatum, Mandatorum } from '../types/mandatum.js'
import { retryVerdict } from '../lib/retryVerdict.js'
import { makeLogger } from '../lib/logger.js'

const log = makeLogger('mandatum:runner')

/** The one flow that opens a standing order today. The machinery is generic; the trigger is not. */
export const TRAINING_MODUS_ID = 'modus.aitoolkit-training'

/**
 * The order's terms, fixed rather than chosen: one day, hourly. A dialog asking a user to
 * design a retry policy is a worse product than a number that is simply right, and one day
 * is long enough to outlast the provider weather these retries exist for.
 */
export const ORDER_WINDOW_MS = 24 * 60 * 60_000
export const ORDER_MAX_RUNS = 24
export const HOURLY_CRON = '0 * * * *'

/** The outcome of the attempt an order is waiting on, as the runner needs to see it. */
export type AttemptOutcome =
  | { state: 'pending' }
  | { state: 'succeeded' }
  | { state: 'failed'; error: string }

export interface MandatumRunnerDeps {
  /** The standing-order store — the durable queue. */
  mandata: Pick<Mandatorum, 'claimDue' | 'update' | 'setNextFire'>
  /** Read the outcome of one attempt. `null` for an attempt that cannot be found (treated
   *  as still pending — a missing read is not evidence of failure). */
  outcome: (actumId: string) => Promise<AttemptOutcome | null>
  /**
   * Start one attempt for this order and return the new attempt's id. Runs the normal
   * invoke path as the order's payer, so every gate re-runs. Throws exactly what that path
   * throws — the runner reads the throw, it does not pre-judge it.
   */
  fire: (mandatum: Mandatum) => Promise<string>
  /** Is the payer still a live account? False → the order ends. Absent → assumed live. */
  payerLive?: (by: Mandatum['by']) => Promise<boolean>
  /** How long a claim is held (default 2 min — an attempt start is short; a crash recovers fast). */
  leaseMs?: number
  /** How often to re-check an attempt that is still running (default 60s). */
  pollMs?: number
  /** Cadence between attempts (default 1 hour). */
  retryMs?: number
  /** Injectable clock (tests). */
  now?: () => Date
}

/**
 * Error codes that mean "not now" rather than "not ever". A momentary balance dip or an
 * account held for review is a state that can change inside the order's window, so the
 * fire is SKIPPED — it costs the order nothing, it is not counted as an attempt, and the
 * next hour tries again. The window still ends the order on time.
 */
const TRANSIENT_AT_FIRE = new Set(['economy.insufficient_signa', 'auth.forbidden'])

function isTransientAtFire(err: unknown): boolean {
  const code = (err as { code?: unknown })?.code
  return typeof code === 'string' && TRANSIENT_AT_FIRE.has(code)
}

export class MandatumRunner {
  private readonly leaseMs: number
  private readonly pollMs: number
  private readonly retryMs: number
  private readonly now: () => Date
  private timer?: ReturnType<typeof setInterval>
  private draining = false

  constructor(private readonly deps: MandatumRunnerDeps) {
    this.leaseMs = deps.leaseMs ?? 2 * 60_000
    this.pollMs = deps.pollMs ?? 60_000
    this.retryMs = deps.retryMs ?? 60 * 60_000
    this.now = deps.now ?? (() => new Date())
  }

  /** Claim + handle every currently-claimable order, then return. Re-entrancy guarded, so
   *  an overlapping tick is a no-op. A handler that throws leaves its order claimed; the
   *  lapsed lease brings it back on a later pass. */
  async drainOnce(): Promise<void> {
    if (this.draining) return
    this.draining = true
    try {
      for (;;) {
        const m = await this.deps.mandata.claimDue(this.now(), this.leaseMs)
        if (!m) break
        try {
          await this.handle(m)
        } catch (err) {
          log.warn('order handling threw — will retry after the lease lapses', { mandatumId: m.id, error: String(err) })
        }
      }
    } finally {
      this.draining = false
    }
  }

  /** One order, one decision. */
  async handle(m: Mandatum): Promise<void> {
    if (m.status !== 'active') return

    if (m.pendens) {
      await this.watch(m, m.pendens)
      return
    }

    // The window is checked before the attempt limit so an order that ran out of time
    // reports that, which is the thing the holder is told.
    if (this.windowClosed(m) || this.attemptsSpent(m)) {
      await this.close(m, 'consumptum')
      return
    }
    if (this.deps.payerLive && !(await this.deps.payerLive(m.by))) {
      await this.close(m, 'defectus', 'revocatum')
      return
    }
    await this.fire(m)
  }

  /** Waiting on an attempt: read its outcome and decide. */
  private async watch(m: Mandatum, actumId: string): Promise<void> {
    const outcome = await this.deps.outcome(actumId)
    if (!outcome || outcome.state === 'pending') {
      // Still running — but never past the deadline: an attempt started inside the window
      // is always allowed to finish, since it is already paid for and may still land.
      await this.deps.mandata.setNextFire(m.id, new Date(this.now().getTime() + this.pollMs))
      return
    }

    if (outcome.state === 'succeeded') {
      await this.deps.mandata.update(m.id, { status: 'exhaustus', causa: 'impletum', pendens: undefined })
      log.info('order fulfilled', { mandatumId: m.id })
      return
    }

    const verdict = retryVerdict(outcome.error)
    if (verdict === 'quit') {
      await this.deps.mandata.update(m.id, { status: 'exhaustus', causa: 'defectus', pendens: undefined })
      log.info('order stopped on a real answer', { mandatumId: m.id })
      return
    }

    if (this.windowClosed(m) || this.attemptsSpent(m)) {
      await this.close(m, 'consumptum')
      return
    }
    await this.deps.mandata.update(m.id, { pendens: undefined })
    await this.deps.mandata.setNextFire(m.id, new Date(this.now().getTime() + this.retryMs))
    log.info('attempt failed on infrastructure — order rescheduled', { mandatumId: m.id, ignitions: m.ignitions })
  }

  /** Start the next attempt. */
  private async fire(m: Mandatum): Promise<void> {
    let actumId: string
    try {
      actumId = await this.deps.fire(m)
    } catch (err) {
      if (isTransientAtFire(err) || retryVerdict(err) === 'infra-retry') {
        // Nothing started, nothing reserved: not an attempt, just a later hour.
        await this.deps.mandata.setNextFire(m.id, new Date(this.now().getTime() + this.retryMs))
        log.info('fire skipped — retrying next cycle', { mandatumId: m.id, error: String(err) })
        return
      }
      await this.close(m, 'defectus')
      log.info('order stopped — dispatch refused', { mandatumId: m.id, error: String(err) })
      return
    }

    await this.deps.mandata.update(m.id, {
      acta: [...m.acta, actumId],
      ignitions: m.ignitions + 1,
      ignitum: this.now(),
      pendens: actumId,
    })
    await this.deps.mandata.setNextFire(m.id, new Date(this.now().getTime() + this.pollMs))
    log.info('order fired', { mandatumId: m.id, ignitions: m.ignitions + 1 })
  }

  private windowClosed(m: Mandatum): boolean {
    return m.finis !== undefined && new Date(m.finis).getTime() <= this.now().getTime()
  }

  private attemptsSpent(m: Mandatum): boolean {
    const max = m.schedula?.maxRuns
    return max !== undefined && m.ignitions >= max
  }

  private async close(m: Mandatum, causa: 'consumptum' | 'defectus', status: 'exhaustus' | 'revocatum' = 'exhaustus'): Promise<void> {
    await this.deps.mandata.update(m.id, { status, causa, pendens: undefined })
  }

  /** Run `drainOnce` on an interval (in-process). Returns this for chaining. */
  start(intervalMs = 30_000): this {
    if (this.timer) return this
    this.timer = setInterval(() => { void this.drainOnce() }, intervalMs)
    if (typeof this.timer.unref === 'function') this.timer.unref()
    log.info('mandatum runner started', { intervalMs, leaseMs: this.leaseMs, retryMs: this.retryMs })
    return this
  }

  stop(): void {
    if (this.timer) { clearInterval(this.timer); this.timer = undefined }
  }
}
