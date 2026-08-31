import type { Actum } from '../types/actum.js'
import type { Signorum } from '../types/significandi.js'
import type { Exitus, Actorum } from '../types/cursus.js'
import type { Nexus } from '../types/nexus.js'
import type { Vestigiorum } from '../types/vestigium.js'
import type { DeploymentumStore } from '../types/deploymentum.js'
import type { Intellarum } from '../types/intelligendi.js'
import type { ModoStore } from '../types/modo.js'
import { impetusFor } from '../ledger/rates.js'
import { makeLogger } from '../lib/logger.js'
import { getTrace, makeTraceContext } from '../lib/trace.js'
import { buildWideEvent, emitWideEvent } from '../lib/wide.js'
import { shouldFlush, flushBuffer } from '../lib/buffer.js'
import { createVestigiumFromActum } from './hooks/vestigiumHook.js'

const log = makeLogger('execution:completor')

// Identified-owner union threaded in by callers who already resolved it (webhook rail,
// dispatchInceptio sync path). Deliberately narrower than Inceptio.by/AuctorKey elsewhere —
// bursaToken/arcanumProof (anonymous rails) never reach here; callers filter those out
// before threading (vestigia are identity-linked records; the anonymous half stays
// unlinkable — a locked invariant).
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
  /** Optional: session store — a run bound to a `Modo` accrues its SETTLED impetus
   *  onto that session here (the sole accrual site; see `Modo.impetusAccrued`).
   *  Absent → no session accrual, which is the correct behaviour for a slim
   *  deployment that has no sessions at all. */
  modos?: Pick<ModoStore, 'findById' | 'update'>
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
    const { acta, signorum, nexus, terminatePod, vestigiorum, deployments, intellarum, modos } = this.deps
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

    // Settle on the MEASURED cost. `reportedImpetus` is the cursor's metered pod
    // wall-clock, and it is the only cost basis known at this point that reflects
    // what the run actually consumed. The dispatch stamp carries the pricing TIER
    // (a dispatch-time fact); the AMOUNT is decided here, where the measurement
    // exists — a dispatch-time amount can only be the reservation.
    //
    //   base   = reportedImpetus                            (measured pod wall-clock)
    //   final  = base + WARM_SURCHARGE when tier is 'guest'  (rates.impetusFor)
    //   settle = min(final, actum.impetus)                   (reservation cap)
    //
    // No tier stamp (cold start, or no hospitia store) → no surcharge, so the
    // settled amount is exactly `reportedImpetus` — identical to the cold-start
    // path before this change.
    const tier = actum.executio?.pricingTier
    const baseImpetus = reportedImpetus
    const finalImpetus = tier ? impetusFor(tier, baseImpetus) : baseImpetus
    // Cap at the reservation so we never settle more than was locked.
    const impetus = finalImpetus > actum.impetus ? actum.impetus : finalImpetus

    // Settle signa: spend all locked at `impetus`, refund the delta to the original
    // identity (signorum.settle handles the refund of unused lock).
    if (actum.signaConsumed.length) {
      await signorum.settle(actum.signaConsumed, impetus, actum.id)
    }

    // Update the actum record with final values. `executio.baseImpetus` /
    // `finalImpetus` are written here (not at dispatch) because both are derived
    // from the measured cost; the spend hooks downstream tax `baseImpetus`, so it
    // must be the real cost basis. Merge onto the freshest executio so the dispatch
    // stamp and the pod telemetry survive.
    const executio = {
      ...(current?.executio ?? actum.executio ?? {}),
      baseImpetus,
      finalImpetus: impetus,
    }
    const completed = await acta.update(actum.id, {
      status: 'completus',
      exitus,
      impetus,
      duratio,
      completum: now,
      executio,
      ...(materiamId ? { materiamId } : {}),
    })

    // Session spend accrual — the ONE site, for the same reason vestigium indexing
    // is: every rail funnels through complete(), and this is the only point at which
    // the SETTLED figure exists. `impetus` here is exactly what `signorum.settle`
    // spent above and exactly what was written to `Actum.impetus` — so the session
    // counter and the ledger cannot report different numbers for the same run.
    //
    // It is deliberately not `reportedImpetus`: `Modo.impetusAccrued` feeds the
    // session budget guard in `Census`, and a budget is an authorization to SPEND,
    // drawn down by what the ledger charges rather than by what the pod consumed.
    // The two agree until a surcharge or the reservation cap applies; where they
    // differ, the charged one is the one the guard has to enforce against. See the
    // field's doc comment for the full statement of the rule — it must not be
    // restated at any dispatch- or webhook-side call site, because neither of those
    // can see this number, and a second derivation of it is a second answer.
    //
    // Read the modo fresh: a caller may have written `acta` between dispatch and
    // here, and the accrual must not clobber it with a stale copy.
    const modoId = current?.modoId ?? actum.modoId
    if (modos && modoId) {
      const modo = await modos.findById(modoId)
      if (modo) {
        await modos.update(modoId, { impetusAccrued: modo.impetusAccrued + impetus })
      }
    }

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
      // what production uses — it builds the full payload (baseImpetus read back
      // off executio, modoHostKey resolved from Hospitium). Here we use the
      // measured base computed above.
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

    // Preserve a cause that is already on the record. `error` reaches here from whichever path
    // observed the failure, and a sweep's own reason is the most general of them — it describes
    // the sweep rather than the run. A specific cause recorded earlier is the better account of
    // what happened, so it stands and the caller's reason is dropped.
    const recorded = current?.error?.trim()
    const finalError = recorded ? recorded : error

    const failed = await acta.update(actum.id, {
      status: 'fractus',
      error: finalError,
      completum: new Date(),
    })

    log.warn('actum failed', {
      actumId:  actum.id,
      modusId:  actum.modusId,
      error:    finalError,
    })

    // A failure is emitted as a wide event even with no trace context to emit it under. The
    // sweeps run on a timer, outside any dispatch, so a run failed by one has no ambient trace —
    // and a failure-rate measurement that silently omits exactly the runs nobody was watching is
    // the wrong measurement. Absent a real context, a minimal one is synthesised: it carries no
    // identity or per-stage timing, which those fields' optionality already allows for, and the
    // economics and pod telemetry come off the actum regardless.
    const ctx = getTrace()
    const wide = buildWideEvent(failed, ctx ?? makeTraceContext({ actumId: actum.id }), 'failed', undefined, finalError)
    emitWideEvent(wide)
    // The buffer is the trace's own accumulated log lines — there is nothing to flush without one.
    if (ctx) flushBuffer(ctx, 'actum-failed')

    return failed
  }

}
