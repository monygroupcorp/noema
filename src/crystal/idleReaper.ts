import type { MateriaStore } from '../types/materia.js'
import { bus } from '../lib/bus.js'
import { makeLogger } from '../lib/logger.js'

const log = makeLogger('crystal:reaper')

/**
 * Idle-pod reaper. Periodically terminates warm pods that have sat idle past
 * their warmUntil deadline (default 1 min past their last job). Without this, a
 * keep-warm pod bills indefinitely until a follow-up job happens to reuse it.
 *
 * Returns a stop function (clears the interval).
 */
export function startIdleReaper(
  materiae: MateriaStore,
  terminatePod: (externusId: string) => Promise<void>,
  intervalMs = 30_000,
  /** Is a non-terminal actum still bound to this Materia? Threaded into `reapIdle`
   *  so an idle+draining pod whose warm-pod release ran ahead of its completion
   *  webhook isn't reaped out from under the still-unsettled result. Omitted →
   *  reapIdle's default (reap an idle draining pod on sight). */
  hasLiveActum?: (materiaId: string) => Promise<boolean>,
): () => void {
  const sweep = async (): Promise<void> => {
    try {
      const reaped = await materiae.reapIdle(new Date(), hasLiveActum)
      for (const m of reaped) {
        await terminatePod(m.externusId).catch(e =>
          log.warn('reap terminate failed', { externusId: m.externusId, error: String(e) }))
        // Tell the UI a warm pod just died so its session bulletin can freeze to a receipt.
        bus.emit('pod.reaped', { externusId: m.externusId })
        log.info('reaped idle pod', { materiaId: m.id, externusId: m.externusId, gpu: m.gpu })
      }
    } catch (err) {
      log.warn('idle reaper sweep failed', { error: String(err) })
    }
  }

  const timer = setInterval(() => { void sweep() }, intervalMs)
  if (typeof timer.unref === 'function') timer.unref()
  return () => clearInterval(timer)
}
