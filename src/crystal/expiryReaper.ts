import type { Actorum, ActumCompletor } from '../types/cursus.js'
import type { Actum } from '../types/actum.js'
import type { CompositusCursor } from './CompositusCursor.js'
import { makeLogger } from '../lib/logger.js'

const log = makeLogger('crystal:expiry-reaper')

// The single canonical failure reason for a cold-start-timeout actum. Kept in one
// place so boot recovery and the periodic reaper stamp the identical error string.
export const EXPIRED_ERROR = 'Actum expired — pod never reported back'

export interface ExpiryReaperDeps {
  actorum: Actorum
  completor: ActumCompletor
  compositusCursor: CompositusCursor
}

/**
 * Recover expired acta — the shared sweep body used by BOTH the boot-time recovery
 * (index.ts step 3c) and the periodic {@link startExpiryReaper} timer, so there is
 * exactly one fail path (no divergence).
 *
 * For each actum still in `{nascens,agens}` whose `expirat` has passed
 * (`Actorum.findExpired`), call `completor.fail()`. fail() kills any live pod and
 * `signorum.release()`s every locked signum — release-only, the user is charged
 * nothing. A compositus step additionally notifies its parent run of the failure
 * (`onStepComplete(..., false)`); the sweep bypasses the webhook, so the parent
 * must be failed directly.
 *
 * Money-safety: fail() re-reads the actum and no-ops on `completus|fractus`, so a
 * concurrent late webhook cannot cause a double-release. The predicate never
 * touches a still-live actum. Returns the number of acta reaped.
 */
export async function recoverExpiredActa(deps: ExpiryReaperDeps): Promise<number> {
  const { actorum, completor, compositusCursor } = deps
  const expired = await actorum.findExpired()
  if (!expired.length) return 0
  await Promise.all(expired.map(async (a: Actum) => {
    await completor.fail(a, EXPIRED_ERROR)
    // A recovered compositus step must fail its parent run too — the sweep bypasses
    // the webhook, so notify the engine directly (fails the parent + frees state).
    if (a.compositum) {
      await compositusCursor.onStepComplete(a.compositum.parentId, a, false).catch(() => {})
    }
  }))
  return expired.length
}

/**
 * Periodic expiry reaper. Without this, a cold-start-timeout actum's locked reserve
 * (up to the 30-min RunPod cap) stays locked against the user's balance until the
 * next process restart — the boot recovery was the ONLY caller of `findExpired`.
 * This runs that same recovery on an interval (default 60s).
 *
 * Returns a stop function (clears the interval).
 */
export function startExpiryReaper(deps: ExpiryReaperDeps, intervalMs = 60_000): () => void {
  const sweep = async (): Promise<void> => {
    try {
      const reaped = await recoverExpiredActa(deps)
      if (reaped) log.info('reaped expired acta', { count: reaped })
    } catch (err) {
      log.warn('expiry reaper sweep failed', { error: String(err) })
    }
  }

  const timer = setInterval(() => { void sweep() }, intervalMs)
  if (typeof timer.unref === 'function') timer.unref()
  return () => clearInterval(timer)
}
