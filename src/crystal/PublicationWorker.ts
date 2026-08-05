// =============================================================================
// PublicationWorker — durable, restart-safe drain of pending publications
// =============================================================================
//
// The store IS the queue: a `status:'pending'` Editio is a durable work record in
// Mongo, so a settle survives an app restart or crash (nothing is held in memory).
// This worker claims pending rows off the `Editionum` (atomic lease) and runs the
// settle — the moderation gate + the adapter publish + the reconciler — OFF the
// request path. Heavy, slow work (streaming a multi-GB model weight to a registry's
// LFS) belongs here, never inline in an HTTP handler.
//
// TOPOLOGY-AGNOSTIC by design. `drainOnce()` is one pass; `start()` runs it on an
// interval. Today it runs IN-PROCESS (constructed in `index.ts`, like Census /
// idleReaper). Lifting it into a separate worker CONTAINER later is just a thin
// entrypoint that builds the same container and calls `start()` — no rewrite, because
// the durability lives in the store's atomic claim, not in where the loop runs.
//
// DELIVERY is at-least-once: a worker that crashes after the adapter published but
// before the status write will re-settle once the lease lapses. The settle path must
// therefore stay idempotent — our adapters are (deterministic mint handle; HF
// createRepo is repo-exists-guarded; bucket put overwrites a stable key).
// =============================================================================

import type { Editionum } from '../types/editio.js'
import { makeLogger } from '../lib/logger.js'

const log = makeLogger('publishing:worker')

export interface PublicationWorkerDeps {
  /** The publication store — the durable queue (claim + terminal update). */
  editiones: Pick<Editionum, 'claimPending' | 'update'>
  /** Settle one claimed publication (moderation + adapter + reconcile). Idempotent. */
  settle: (editioId: string) => Promise<void>
  /** How long a claim is held before it is reclaimable (default 5 min — long enough
   *  for a large upload, short enough that a crash recovers promptly). */
  leaseMs?: number
  /** Max settle attempts before a publication is marked `failed` (default 5). */
  maxAttempts?: number
}

export class PublicationWorker {
  private readonly leaseMs: number
  private readonly maxAttempts: number
  private timer?: ReturnType<typeof setInterval>
  private draining = false

  constructor(private readonly deps: PublicationWorkerDeps) {
    this.leaseMs = deps.leaseMs ?? 5 * 60_000
    this.maxAttempts = deps.maxAttempts ?? 5
  }

  /** Claim + settle every currently-claimable publication, then return. A claim that
   *  throws is left pending (its live lease blocks re-claim this pass; the lapsed lease
   *  retries it on a later pass). Safe to call concurrently with itself (re-entrancy
   *  guarded) — overlapping ticks are a no-op. */
  async drainOnce(): Promise<void> {
    if (this.draining) return
    this.draining = true
    try {
      for (;;) {
        const e = await this.deps.editiones.claimPending(new Date(), this.leaseMs)
        if (!e) break
        if ((e.attempts ?? 1) > this.maxAttempts) {
          log.warn('publication exceeded max attempts → failed', { editioId: e.id, attempts: e.attempts })
          await this.deps.editiones.update(e.id, { status: 'failed' })
          continue
        }
        try {
          await this.deps.settle(e.id)
        } catch (err) {
          // Leave it pending — the lease lapses and a later pass retries it.
          log.warn('settle threw — will retry after lease lapses', { editioId: e.id, error: String(err) })
        }
      }
    } finally {
      this.draining = false
    }
  }

  /** Run `drainOnce` on an interval (in-process). Returns this for chaining. */
  start(intervalMs = 5_000): this {
    if (this.timer) return this
    this.timer = setInterval(() => { void this.drainOnce() }, intervalMs)
    if (typeof this.timer.unref === 'function') this.timer.unref()
    log.info('publication worker started', { intervalMs, leaseMs: this.leaseMs, maxAttempts: this.maxAttempts })
    return this
  }

  stop(): void {
    if (this.timer) { clearInterval(this.timer); this.timer = undefined }
  }
}
