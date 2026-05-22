/**
 * TimerRegistry — named, owned timers for one entity (e.g. a PodSession or bulletin).
 *
 * The bulletin subsystem juggles several timers per pod (warm-window auto-settle,
 * slow-hunt escalation, hop-to-bottom renewal, deferred reactions). Tracking them as
 * loose fields meant copy-pasted clear blocks and leak paths on every exit. This
 * centralizes the lifecycle: arming a name cancels any prior timer of that name, and
 * cancelAll() guarantees nothing outlives the entity. Timers are unref'd so they never
 * keep the process alive.
 */
export class TimerRegistry {
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>()

  /** Arm (or re-arm) a named timer. Replaces any existing timer with the same name. */
  arm(name: string, ms: number, fn: () => void): void {
    this.cancel(name)
    const timer = setTimeout(() => {
      this.timers.delete(name)   // forget before firing so has()/cancel() are accurate
      fn()
    }, ms)
    timer.unref?.()
    this.timers.set(name, timer)
  }

  /** Cancel a named timer if pending. No-op if it already fired or never existed. */
  cancel(name: string): void {
    const timer = this.timers.get(name)
    if (timer !== undefined) {
      clearTimeout(timer)
      this.timers.delete(name)
    }
  }

  /** Cancel every pending timer — call on entity teardown to guarantee no leaks. */
  cancelAll(): void {
    for (const timer of this.timers.values()) clearTimeout(timer)
    this.timers.clear()
  }

  /** True while a named timer is pending (not yet fired or cancelled). */
  has(name: string): boolean {
    return this.timers.has(name)
  }
}
