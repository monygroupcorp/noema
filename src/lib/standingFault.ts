import { makeLogger } from './logger.js'

type Logger = ReturnType<typeof makeLogger>

/**
 * How long a condition must stay clear before its return is news rather than a flap.
 * The request loops this exists to silence re-derive their state about once a minute, so
 * anything that comes back inside a minute of clearing never actually went away.
 */
export const SETTLE_MS = 60_000

/**
 * A standing fault does not become news by repeating.
 *
 * A condition that holds until someone changes the deployment, reported from a path that
 * runs once per request, is one `log.error` line per request for as long as the fault
 * lasts — and the real errors around it are unreadable. A finalized ceremony whose
 * proving key was not on the server put 60 of every 107 production log lines through that
 * path, on a monitor polling every 60 seconds.
 *
 * So a condition is an error the first time it is seen, and while it still holds its
 * repeats go to `debug` — off in production, back with `DEBUG=<component>`. The condition
 * is keyed, so a fault that changes (a different key, a different failure) is news again,
 * and so is the same one recurring after it had genuinely cleared.
 *
 * Every standing condition is remembered, not just the most recent one: more than one can
 * hold at a time, and a caller that flaps between two of them is not two new faults per
 * request. Keys are short strings naming conditions the deployment is actually in, so the
 * set is bounded by the deployment and not by traffic.
 *
 * A clear only counts if the condition stays clear. An intermittent dependency — a
 * database that answers one request and refuses the next — otherwise clears and re-arms
 * the same fault on alternating requests, and reporting each re-arm is the same flood one
 * condition over: half of every request pair, for as long as the flapping lasts. So a
 * fault returning within `SETTLE_MS` of its clear never settled, and its return is a
 * repeat rather than news. Only an absence that outlasts that window makes it news again.
 */
export function faultReporter(log: Logger, now: () => number = Date.now) {
  const standing = new Set<string>()
  /** When each condition last stopped holding — absent until one has actually cleared. */
  const clearedAt = new Map<string, number>()
  return {
    report(key: string, msg: string, fields: Record<string, unknown>): void {
      const cleared = clearedAt.get(key)
      const flapped = cleared !== undefined && now() - cleared < SETTLE_MS
      if (standing.has(key) || flapped) {
        standing.add(key)
        log.debug(msg, { ...fields, standing: true })
        return
      }
      standing.add(key)
      clearedAt.delete(key)
      log.error(msg, fields)
    },
    /** This condition no longer holds. If it stays clear, its return is reported again. */
    clear(key: string): void {
      if (standing.delete(key)) clearedAt.set(key, now())
    },
  }
}
