import type { Actum } from '../types/actum.js'
import type { Signorum } from '../types/significandi.js'
import type { Exitus, Actorum } from '../types/cursus.js'
import type { Nexus } from '../types/nexus.js'
import type { Vestigiorum } from '../types/vestigium.js'
import type { DeploymentumStore } from '../types/deploymentum.js'
import type { Intellarum } from '../types/intelligendi.js'
import { makeLogger } from '../lib/logger.js'
import { getTrace } from '../lib/trace.js'
import { buildWideEvent, emitWideEvent } from '../lib/wide.js'
import { shouldFlush, flushBuffer } from '../lib/buffer.js'
import { createVestigiumFromActum } from './hooks/vestigiumHook.js'

const log = makeLogger('execution:completor')

// Identified-owner union threaded in by callers who already resolved it (webhook rail,
// dispatchInceptio sync path). Deliberately narrower than Inceptio.by/AuctorKey elsewhere —
// bursaToken/arcanumProof (anonymous rails) never reach here; callers filter those out
// before threading (vestigia are identity-linked records; the anonymous half stays
// unlinkable — gauntlet-locked invariant).
type Auctor = { animaId: string } | { commitment: string }

interface Deps {
  acta: Actorum
  signorum: Signorum
  nexus?: Nexus
  terminatePod?: (podId: string) => Promise<void>
  /** Optional: vestigium store — indexes a generation trace after each completion.
   *  Absent → indexing skipped (one-time warn so slim deployments/tests notice). */
  vestigiorum?: Vestigiorum
  /** Optional: compiled-bundle store — resolves `actum.deploymentHash` → `spec.models`
   *  (the models the gen actually used, base + LoRAs) for Vestigium provenance
   *  (`intellaIds`/`intellaDescription`). Absent → provenance fields left unset,
   *  same shape `resolveModelPayees.ts`'s `modelsUsed()` already reads for royalties. */
  deployments?: Pick<DeploymentumStore, 'find'>
  /** Optional: model registry — resolves each model id to its human-readable `nomen`
   *  for `intellaDescription`. Absent (or id unresolved) → falls back to the raw id. */
  intellarum?: Pick<Intellarum, 'find'>
}

let warnedMissingVestigiorum = false

/** Distinct model ids the actum used: ALL of the resolved deployment bundle's
 *  `spec.models` (base checkpoint + LoRAs + pinned — no role filtering), mirroring
 *  `resolveModelPayees.ts`'s `modelsUsed()` bundle-reading shape. */
async function resolveIntellaIds(
  actum: Actum,
  deployments?: Pick<DeploymentumStore, 'find'>
): Promise<string[]> {
  const ids = new Set<string>()
  if (actum.deploymentHash && deployments) {
    const bundle = await deployments.find(actum.deploymentHash)
    const models = (bundle?.spec as { models?: unknown })?.models
    if (Array.isArray(models)) {
      for (const m of models) {
        const id = (m as { id?: unknown })?.id
        if (typeof id === 'string' && id) ids.add(id)
      }
    }
  }
  return [...ids]
}

/** Human-readable, semantic-search-friendly description of the models used —
 *  each id's `Intella.nomen` (falling back to the raw id when unresolved/absent),
 *  joined with " + " so it reads as prose, not `slug@weight` tags. */
async function resolveIntellaDescription(
  ids: string[],
  intellarum?: Pick<Intellarum, 'find'>
): Promise<string | undefined> {
  if (!ids.length) return undefined
  const names = await Promise.all(ids.map(async (id) => {
    const intella = await intellarum?.find(id).catch(() => null)
    return intella?.nomen || id
  }))
  return names.join(' + ')
}

export class ActumCompletor {
  constructor(private readonly deps: Deps) {}

  async complete(actum: Actum, result: Exitus, auctor?: Auctor): Promise<Actum> {
    const { acta, signorum, nexus, terminatePod, vestigiorum, deployments, intellarum } = this.deps
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

    // Vestigium indexing (single choke point — every rail funnels through complete()).
    // Fire-and-forget: indexing must never fail or delay a completion. Identity resolution
    // stays at the edges that already own it (webhook rail, dispatchInceptio sync path);
    // the completor only writes what it's handed.
    if (auctor) {
      if (vestigiorum) {
        // Resolve off `current` (the fresh findById at the top of complete()), not the
        // `actum` parameter — `current.deploymentHash` is reliable regardless of which
        // rail called complete() (written mid-run by the cursor before either rail gets
        // here); the parameter can be rail-stale.
        resolveIntellaIds(current ?? actum, deployments).then(async (intellaIds) => {
          const intellaDescription = await resolveIntellaDescription(intellaIds, intellarum)
          const options = intellaIds.length ? { intellaIds, intellaDescription } : undefined
          return createVestigiumFromActum(completed, auctor, vestigiorum, options)
        }).catch((e) =>
          log.warn('vestigium index failed', { actumId: actum.id, error: String(e) }))
      } else if (!warnedMissingVestigiorum) {
        warnedMissingVestigiorum = true
        log.warn('vestigium indexing skipped — no vestigiorum store configured', { actumId: actum.id })
      }
    } else {
      log.debug('vestigium indexing skipped — no auctor', { actumId: actum.id })
    }

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
