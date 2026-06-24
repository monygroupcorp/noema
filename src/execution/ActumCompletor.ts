import type { Actum } from '../types/actum.js'
import type { Signorum } from '../types/significandi.js'
import type { Exitus, Actorum } from '../types/cursus.js'
import type { Nexus } from '../types/nexus.js'
import { makeLogger } from '../lib/logger.js'
import { getTrace } from '../lib/trace.js'
import { buildWideEvent, emitWideEvent } from '../lib/wide.js'
import { shouldFlush, flushBuffer } from '../lib/buffer.js'

const log = makeLogger('execution:completor')

interface Deps {
  acta: Actorum
  signorum: Signorum
  nexus?: Nexus
  terminatePod?: (podId: string) => Promise<void>
}

export class ActumCompletor {
  constructor(private readonly deps: Deps) {}

  async complete(actum: Actum, result: Exitus): Promise<Actum> {
    const { acta, signorum, nexus, terminatePod } = this.deps
    const { exitus, impetus: reportedImpetus, duratio, materiamId } = result
    const now = new Date()

    const current = await acta.findById(actum.id)
    if (current?.status === 'completus') {
      throw new Error(`Actum '${actum.id}' is already completus — double-completion rejected`)
    }

    // Cursor cost contract: cursor's reported actual must never exceed the
    // reservation. (The dispatch-time decision below may further refine this.)
    if (reportedImpetus > actum.impetus) {
      throw new Error(
        `Cursor overcharge: actual impetus ${reportedImpetus} exceeds reservation ${actum.impetus}`
      )
    }

    // Honor the dispatch-time pricing decision when present (Phase B): a guest
    // run's finalImpetus = base + bootShare is the right spend amount. Cap at the
    // reservation so we never settle more than was locked.
    const dispatched = actum.executio?.finalImpetus
    const rawImpetus = dispatched !== undefined ? dispatched : reportedImpetus
    const impetus = rawImpetus > actum.impetus ? actum.impetus : rawImpetus

    // Settle signa: spend all locked at `impetus`, refund the delta to the original
    // identity (signorum.settle handles the refund of unused lock).
    if (actum.signaConsumed.length) {
      await signorum.settle(actum.signaConsumed, impetus, actum.id)
    }

    // Update the actum record with final values
    const completed = await acta.update(actum.id, {
      status: 'completus',
      exitus,
      impetus,
      duratio,
      completum: now,
      ...(materiamId ? { materiamId } : {}),
    })

    // Reap a dedicated one-shot pod (e.g. training) on success — warm/pooled pods
    // (oneshotPod unset) are left alive for reuse and swept by the idle reaper. Mirrors
    // fail()'s terminate; best-effort so a reaper hiccup never blocks completion.
    if (actum.oneshotPod && actum.externusJobId && terminatePod) {
      await terminatePod(actum.externusJobId).catch((e) =>
        log.warn('oneshot pod terminate failed', { actumId: actum.id, podId: actum.externusJobId, error: String(e) }))
    }

    log.info('actum completed', {
      actumId:    actum.id,
      modusId:    actum.modusId,
      impetus:    result.impetus.toString(),
      durationMs: result.duratio,
    })

    const ctx = getTrace()
    if (ctx) {
      const wide = buildWideEvent(completed, ctx, 'completed', result)
      emitWideEvent(wide)
      if (shouldFlush(ctx, 'completed')) {
        flushBuffer(ctx, 'slow-actum')
      }
    }

    if (nexus) {
      // Phase C widened the payload: baseImpetus is mandatory + modoHostKey is
      // optional. The completor only fires this when its caller (cursors that
      // don't go through the webhook path) emits directly. The webhook path is
      // what production uses — it builds the full payload (baseImpetus pulled
      // from executio, modoHostKey resolved from Hospitium). Here we approximate
      // baseImpetus from the dispatch stamp when present, else from the settled
      // impetus (owner/admin paths where final === base).
      const baseImpetus = completed.executio?.baseImpetus ?? impetus
      await nexus.emit({
        type: 'execution_spend',
        payload: {
          actum: completed,
          impetus,
          baseImpetus,
        },
      })
    }

    return completed
  }

  async fail(actum: Actum, error: string): Promise<Actum> {
    const { acta, signorum, terminatePod } = this.deps

    const current = await acta.findById(actum.id)
    if (current?.status === 'completus' || current?.status === 'fractus') {
      return current
    }

    // Invariant: kill the pod before releasing signa — never refund while a pod still burns.
    if (actum.externusJobId && terminatePod) {
      await terminatePod(actum.externusJobId).catch(() => {})
    }

    // Release all locked signa — nothing was consumed
    if (actum.signaConsumed.length) {
      await signorum.release(actum.signaConsumed)
    }

    const failed = await acta.update(actum.id, {
      status: 'fractus',
      error,
      completum: new Date(),
    })

    log.warn('actum failed', {
      actumId:  actum.id,
      modusId:  actum.modusId,
      error,
    })

    const ctx = getTrace()
    if (ctx) {
      const wide = buildWideEvent(failed, ctx, 'failed', undefined, error)
      emitWideEvent(wide)
      flushBuffer(ctx, 'actum-failed')
    }

    return failed
  }

}
