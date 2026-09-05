import type { Actum } from '../types/actum.js'
import type { Actorum, ActumCompletor, Cursorum } from '../types/cursus.js'
import type { Modorum } from '../types/modus.js'
import type { Locorum, LocusPlace } from '../types/locus.js'
import type { QueueGate } from '../execution/dispatchInceptio.js'
import { dispatchQueuedActum } from '../execution/dispatchInceptio.js'
import { MAX_TERMINUS_MS, DEFAULT_EXPIRAT_MS } from '../execution/ActumInceptor.js'
import { recordProgressus } from '../execution/progressusSink.js'
import { EconomyUnavailableError } from './RunPodCursor.js'
import { bus } from '../lib/bus.js'
import { makeLogger } from '../lib/logger.js'

const log = makeLogger('crystal:vocator')

/**
 * How long a run may stand in the line before the platform gives up on it and gives
 * the money back. This lands on the actum's `expirat`, so it is enforced by the same
 * expiry reaper that already frees a run whose pod never reported: nothing new sweeps
 * the queue for staleness, and a run that waited out its window is FAILED and REFUNDED
 * rather than left holding a lock forever.
 *
 * Twenty minutes is the trade: long enough that a pod finishing a normal generation
 * frees up well inside it, short enough that a payer whose pool never warms is not
 * left with credits locked against nothing for an hour.
 */
export const DEFAULT_WAIT_BUDGET_MS = 20 * 60 * 1000

/** How often the line is swept for pods that freed without an event reaching us. */
const DEFAULT_SWEEP_MS = 30_000

export interface VocatorDeps {
  locorum: Locorum
  actorum: Pick<Actorum, 'findById' | 'update'>
  modorum: Modorum
  cursorum: Cursorum
  completor: ActumCompletor
  /** Wait window before a queued run is refunded. Default {@link DEFAULT_WAIT_BUDGET_MS}. */
  waitBudgetMs?: number
}

/**
 * Vocator — "the one who calls." The warm-pod line's caller: it takes in the runs a
 * cursor could not place, and calls them forward, in order, as pods fall idle.
 *
 * WHAT IT IS FOR. A run cast on the economy strategy asked to ride someone else's warm
 * pod rather than pay for a cold start. Until now an empty pool meant that run was
 * settled on the spot — the payer was refunded and told to try again, which is the one
 * thing "wait for warm capacity" was supposed to spare them. This holds the run instead:
 * it stays admitted, its reservation stays locked, and it dispatches on the next pod
 * that fits it.
 *
 * WHAT IT IS NOT. It is not a scheduler and it does not pick pods. Dispatch goes back
 * through the ordinary cursor path, which claims a pod atomically exactly as a fresh run
 * would; the Vocator's whole contribution is deciding WHICH run gets to try next, and
 * putting it back in line if the pod was gone by the time it looked.
 *
 * SAFETY. Two properties carry the money:
 *   - A place is CLAIMED atomically before its run is touched, so two pods freeing at the
 *     same instant cannot hand the same run to both.
 *   - A claimed run is RE-READ before it is dispatched. A run cancelled while it waited
 *     is already `fractus` with its signa released, and it is dropped from the line here
 *     rather than dispatched — which is what makes cancel-before-dispatch safe without
 *     the cancel path having to know the line exists.
 */
export class Vocator implements QueueGate {
  private sweeping = false

  constructor(private readonly deps: VocatorDeps) {}

  // ── QueueGate — what the dispatch asks ────────────────────────────────────

  /** An empty economy pool is the one refusal that means "wait"; everything else fails. */
  imageAwaited(err: unknown): string | null {
    return err instanceof EconomyUnavailableError ? err.imageRef : null
  }

  /**
   * Take a run into the line and tell it where it stands.
   *
   * The actum's `expirat` is re-stamped to the WAIT budget here, and re-stamped again to
   * the run's own budget when it dispatches. Without that, the wait would eat the
   * execution deadline the reservation was sized against: a run that queued for ten
   * minutes would arrive on a pod with ten minutes less to finish in, and be reaped
   * mid-generation for taking too long at work it had barely started.
   */
  async enqueue(actum: Actum, imageRef: string): Promise<void> {
    await this.deps.locorum.enqueue({ actumId: actum.id, imageRef })
    const waitBudget = this.deps.waitBudgetMs ?? DEFAULT_WAIT_BUDGET_MS
    await this.deps.actorum.update(actum.id, { expirat: new Date(Date.now() + waitBudget) })
    log.info('run queued for a warm pod', { actumId: actum.id, imageRef })
    await this._announce(actum.id)
  }

  /** Where a run stands in its line, or null when it is not waiting. */
  async place(actumId: string): Promise<LocusPlace | null> {
    return this.deps.locorum.place(actumId)
  }

  // ── Calling runs forward ──────────────────────────────────────────────────

  /**
   * A pod running `imageRef` just fell idle: call the next run waiting on it.
   *
   * Walks the line from the front, dropping places whose run is gone or already settled,
   * until one dispatches or the line runs dry. A run that reaches a cursor and finds the
   * pod taken after all goes back to the exact place it held — `release` keeps its
   * `admissum`, so a lost race costs it nothing.
   */
  async callNext(imageRef: string): Promise<void> {
    for (;;) {
      const locus = await this.deps.locorum.claim(imageRef)
      if (!locus) return

      const actum = await this.deps.actorum.findById(locus.actumId).catch(() => null)
      // Gone, cancelled, expired or already finished: the place is stale. Drop it and
      // give the pod to whoever is behind it.
      if (!actum || actum.status === 'completus' || actum.status === 'fractus') {
        await this.deps.locorum.remove(locus.actumId)
        continue
      }

      try {
        await this._rearmDeadline(actum)
        await dispatchQueuedActum(this.deps, actum)
        await this.deps.locorum.remove(locus.actumId)
        log.info('queued run dispatched on a freed pod', { actumId: actum.id, imageRef })
        // The line moved: everyone still in it is one place closer.
        await this._announceLine(imageRef)
        return
      } catch (err) {
        if (err instanceof EconomyUnavailableError) {
          // The pod was claimed by someone else between the event and the dispatch.
          // Nothing is wrong with this run — put it back at the front where it was.
          await this.deps.locorum.release(locus.id)
          return
        }
        // A real dispatch failure. Settle it the way the first attempt would have —
        // signa released, run `fractus` — and carry on down the line, because the pod
        // that freed is still free.
        await this.deps.completor.fail(actum, (err as Error)?.message ?? String(err)).catch(() => {})
        await this.deps.locorum.remove(locus.actumId)
        log.warn('queued run failed at dispatch', { actumId: actum.id, error: String(err) })
      }
    }
  }

  /**
   * Sweep every line: prune the places whose runs have settled, then try to call one run
   * forward per image.
   *
   * The bus events are the fast path and this is the durable one. A pod can free without
   * an event reaching this process — another instance handled the job, or this one
   * restarted mid-wait — and a line whose only trigger was an in-process event would sit
   * still until the wait budget refunded everyone in it.
   */
  async sweep(): Promise<void> {
    if (this.sweeping) return
    this.sweeping = true
    try {
      const images = await this.deps.locorum.images()
      for (const imageRef of images) {
        await this._prune(imageRef)
        await this.callNext(imageRef)
      }
    } catch (err) {
      log.warn('vocator sweep failed', { error: String(err) })
    } finally {
      this.sweeping = false
    }
  }

  /**
   * Subscribe to pods freeing and start the sweep. Returns a stop function.
   *
   * `pod.idle` names the image the freed pod runs, so it calls that one line directly.
   * `pod.parked` (a cold pod that just joined the warm pool) does not, so it sweeps —
   * a parked pod is rarer than a finished job, and the sweep is a handful of reads.
   */
  start(sweepMs = DEFAULT_SWEEP_MS): () => void {
    const onIdle = (data: { imageRef?: string }): void => {
      if (data.imageRef) void this.callNext(data.imageRef).catch(err =>
        log.warn('call-next failed', { imageRef: data.imageRef, error: String(err) }))
    }
    const onParked = (): void => { void this.sweep() }
    bus.on('pod.idle', onIdle)
    bus.on('pod.parked', onParked)

    const timer = setInterval(() => { void this.sweep() }, sweepMs)
    if (typeof timer.unref === 'function') timer.unref()

    return () => {
      bus.off('pod.idle', onIdle)
      bus.off('pod.parked', onParked)
      clearInterval(timer)
    }
  }

  // ── Internals ─────────────────────────────────────────────────────────────

  /**
   * Give a run about to dispatch its full execution deadline back — the cursor's own
   * `terminus` from now, under the same ceiling `ActumInceptor` applies at initiation,
   * so a queued run's budget is decided by exactly one rule and not two.
   */
  private async _rearmDeadline(actum: Actum): Promise<void> {
    const modus = await this.deps.modorum.find(actum.modusId, actum.modusVersiono)
    if (!modus) return
    const declared = await this.deps.cursorum.resolve(modus).terminus?.(modus, actum.aditus)
    const terminusMs = Math.min(declared ?? DEFAULT_EXPIRAT_MS, MAX_TERMINUS_MS)
    await this.deps.actorum.update(actum.id, { expirat: new Date(Date.now() + terminusMs) })
  }

  /** Drop the places whose runs no longer exist or have already settled. */
  private async _prune(imageRef: string): Promise<void> {
    for (const locus of await this.deps.locorum.waiting(imageRef)) {
      const actum = await this.deps.actorum.findById(locus.actumId).catch(() => null)
      if (!actum || actum.status === 'completus' || actum.status === 'fractus') {
        await this.deps.locorum.remove(locus.actumId)
      }
    }
  }

  /** Tell everyone still waiting on this image where they now stand. */
  private async _announceLine(imageRef: string): Promise<void> {
    for (const locus of await this.deps.locorum.waiting(imageRef)) {
      await this._announce(locus.actumId)
    }
  }

  /**
   * Report a run's place on the ordinary progress rail.
   *
   * `queued` is already in the owned phase vocabulary ("accepted, awaiting a slot") and
   * every surface that watches a run already renders a Progressus — the web run readout
   * shows the message under its first stage, the timeline persists it on the actum. So
   * telling someone where they stand needs no new channel: it is a status report like
   * any other, and it arrives wherever the run is being watched.
   */
  private async _announce(actumId: string): Promise<void> {
    const at = await this.deps.locorum.place(actumId)
    if (!at) return
    await recordProgressus(actumId, {
      phase: 'queued',
      message: `${ordinal(at.place)} in line for a warm pod`,
      progress: { done: at.place, total: at.depth, unit: 'items' },
      at: new Date(),
    }).catch(() => {})
  }
}

/** "1st", "2nd", "3rd", "4th"… — the place as a person would say it. */
function ordinal(n: number): string {
  const rem100 = n % 100
  if (rem100 >= 11 && rem100 <= 13) return `${n}th`
  switch (n % 10) {
    case 1:  return `${n}st`
    case 2:  return `${n}nd`
    case 3:  return `${n}rd`
    default: return `${n}th`
  }
}
