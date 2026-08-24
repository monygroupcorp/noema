import type { Actorum, ActumCompletor } from '../types/cursus.js'
import type { Actum } from '../types/actum.js'
import type { Progressus } from '../types/progressus.js'
import type { CompositusCursor } from './CompositusCursor.js'
import { makeLogger } from '../lib/logger.js'

const log = makeLogger('crystal:expiry-reaper')

// The single canonical failure reason for a cold-start-timeout actum. Kept in one
// place so boot recovery and the periodic reaper stamp the identical error string.
export const EXPIRED_ERROR = 'Actum expired — pod never reported back'

/**
 * The default first-heartbeat window: how long a pod has to say its first word after the host
 * has locked a machine for it.
 *
 * The clock starts at the POD LOCK, not at dispatch and not at the host's handover report — so
 * the window excludes the queue wait (which is not the pod's to answer for) and includes the
 * host-side bootstrap plus the pod's own startup, which is the whole of the interval a healthy
 * run needs before it can report.
 *
 * A run that carries no `firstHeartbeatDeadlineMs` is not subject to this at all; a cursor opts
 * in per run and may override the value (see `Actum.firstHeartbeatDeadlineMs`). The number is a
 * DURATION and nothing else — it never reaches `reserve()`, a quote, or a ledger lock.
 */
export const FIRST_HEARTBEAT_DEADLINE_MS = 10 * 60 * 1000  // 10 minutes

/** The canonical failure reason for a pod that was locked and then never reported in. Distinct
 *  from {@link EXPIRED_ERROR}: this one names WHAT went silent and WHEN, rather than reporting
 *  only that the run's outer deadline elapsed. */
export const SILENT_POD_ERROR = 'Pod never reported in — no status post within the first-heartbeat deadline'

/**
 * Is this host-side phase report the POD LOCK — the moment a machine is ours and reachable?
 *
 * That report is a `provisioning` phase carrying the pod's identity; the reports around it
 * carry none (the acquisition attempt has no pod yet, and everything after it is a different
 * phase). See `coldStartProgressus`, which is what builds it.
 */
export function isPodLockedReport(p: Omit<Progressus, 'at'>): boolean {
  return p.phase === 'provisioning' && !!p.pod?.podId
}

/**
 * Has this run been locked to a machine that then never spoke? True only for a run that opted
 * into a first-heartbeat deadline, has a pod lock behind it, has no pod report at all, and whose
 * window has elapsed.
 */
export function isFirstHeartbeatOverdue(a: Actum, now: Date): boolean {
  if (a.firstHeartbeatDeadlineMs === undefined) return false   // opt-in — an un-armed run is never swept here
  if (!a.podLockedAt || a.firstPodReportAt) return false       // not started, or the pod already spoke
  return now.getTime() - a.podLockedAt.getTime() >= a.firstHeartbeatDeadlineMs
}

/**
 * The failure reason a reaped run is stamped with: the sweep's own reason PLUS the last thing
 * the run actually reported.
 *
 * The sweep's reason describes the sweep, not the run — every run it fails gets the same
 * sentence. The last timeline entry is the only surviving account of what the run was doing
 * (pod-side logs die with the pod), so it is carried into `acta.error` rather than left to be
 * reconstructed from the timeline by hand.
 */
export function reapError(actum: Actum, reason: string): string {
  const last = actum.progressus?.at(-1)
  if (!last) return reason
  const where = last.target ? `${last.phase}/${last.target}` : last.phase
  const detail = last.message ? `${where} — ${last.message}` : where
  return `${reason} (last report: ${detail} at ${last.at.toISOString()})`
}

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
  await Promise.all(expired.map((a: Actum) => failStuck({ completor, compositusCursor }, a, EXPIRED_ERROR)))
  return expired.length
}

/**
 * Fail one stuck actum and notify its compositus parent — the shared body of every sweep in
 * this file, so the expiry sweep and the first-heartbeat sweep cannot diverge on what failing
 * means. The reason is composed with the run's last report (`reapError`) before it is stamped.
 *
 * fail() kills any live pod, then release-only's every locked signum: the payer is charged
 * nothing. It re-reads the actum and no-ops on `completus|fractus`, so a late webhook racing a
 * sweep cannot double-release.
 */
async function failStuck(
  deps: Pick<ExpiryReaperDeps, 'completor' | 'compositusCursor'>,
  actum: Actum,
  reason: string,
): Promise<void> {
  await deps.completor.fail(actum, reapError(actum, reason))
  // A recovered compositus step must fail its parent run too — the sweep bypasses
  // the webhook, so notify the engine directly (fails the parent + frees state).
  if (actum.compositum) {
    await deps.compositusCursor.onStepComplete(actum.compositum.parentId, actum, false).catch(() => {})
  }
}

/**
 * Fail every run whose pod was locked and then went silent past its first-heartbeat window.
 *
 * The gap this closes: after the host launches a detached pod it stops watching. A pod that
 * dies before its first status post — a missing or unusable environment variable, a failed
 * import, a segfault, an OOM-kill, a webhook rejected on every delivery attempt — leaves the
 * host with nothing to observe, so the run stays `agens` until `expirat`, holding the payer's
 * reservation locked and a GPU billed for the whole of it. This bounds that to the window the
 * dispatching cursor armed (see `FIRST_HEARTBEAT_DEADLINE_MS`).
 *
 * Candidates come from `findInFlight()` — the nascens/agens runs that hold a pod handle — and
 * are narrowed by `isFirstHeartbeatOverdue`, so a run that never opted in, is not yet locked to
 * a machine, or has already been heard from is never touched.
 *
 * Returns the number of runs reaped.
 */
export async function recoverSilentPods(deps: ExpiryReaperDeps, now: Date = new Date()): Promise<number> {
  const { actorum, completor, compositusCursor } = deps
  const inFlight = await actorum.findInFlight()
  const silent = inFlight.filter((a: Actum) => isFirstHeartbeatOverdue(a, now))
  if (!silent.length) return 0
  await Promise.all(silent.map((a: Actum) => failStuck({ completor, compositusCursor }, a, SILENT_POD_ERROR)))
  return silent.length
}

/**
 * Periodic expiry reaper. Without this, a cold-start-timeout actum's locked reserve
 * (up to the 30-min RunPod cap) stays locked against the user's balance until the
 * next process restart — the boot recovery was the ONLY caller of `findExpired`.
 * This runs that same recovery on an interval (default 60s), and on the same tick runs the
 * first-heartbeat sweep (`recoverSilentPods`) — the much shorter deadline that catches a pod
 * which was locked and then never spoke, rather than waiting out the run's whole terminus.
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
    // The two sweeps are independent: a silent pod is reaped on its own (much shorter) window
    // long before its `expirat`, and one sweep throwing must not cost the other its tick.
    try {
      const reaped = await recoverSilentPods(deps)
      if (reaped) log.info('reaped silent pods', { count: reaped })
    } catch (err) {
      log.warn('first-heartbeat sweep failed', { error: String(err) })
    }
  }

  const timer = setInterval(() => { void sweep() }, intervalMs)
  if (typeof timer.unref === 'function') timer.unref()
  return () => clearInterval(timer)
}
