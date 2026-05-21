import type { MateriaStore } from '../types/materia.js'
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
): () => void {
  const sweep = async (): Promise<void> => {
    try {
      const reaped = await materiae.reapIdle(new Date())
      for (const m of reaped) {
        await terminatePod(m.externusId).catch(e =>
          log.warn('reap terminate failed', { externusId: m.externusId, error: String(e) }))
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
