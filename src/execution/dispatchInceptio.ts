// =============================================================================
// dispatchInceptio — neutral initiate→dispatch helper
// =============================================================================
//
// The shared core of the execution dispatch: initiate an Actum, index it,
// resolve its Modus + Cursor, run it under a trace context, and (for sync
// cursors) complete it. Extracted verbatim from `ExecuteFlow._submit` so any
// facade (Telegram flow, REST API, MCP, …) reuses the EXACT same logic instead
// of re-implementing it.
//
// This is presentation-neutral: it returns the Actum and (on sync) its exitus.
// Callers map that onto their own UI/response. No primitives, no flow state.
// =============================================================================

import type { Actum } from '../types/actum.js'
import type { Modorum } from '../types/modus.js'
import type { Cursorum, ActumCompletor, Inceptio } from '../types/cursus.js'
import type { ActumInceptor } from './ActumInceptor.js'
import type { ActumIndexStore } from '../types/actumIndex.js'
import { withTrace, getTrace, makeTraceContext } from '../lib/trace.js'

export interface DispatchDeps {
  inceptor: { initiate: ActumInceptor['initiate'] }
  modorum: Modorum
  cursorum: Cursorum
  completor: ActumCompletor
  /**
   * Optional per-AuctorKey aggregation index. When present, the dispatched actum
   * is recorded (fire-and-forget) on whichever side of the `{animaId}|{commitment}`
   * union `inceptio.by` carries — so `/status` can list runs without touching the
   * actum row's identity (privacy invariant intact — see `src/types/actumIndex.ts`).
   * Arcanum-proof runs carry neither side, so nothing is recorded for them.
   */
  actumIndex?: ActumIndexStore
  /**
   * Compositus engine (ADR-0008). When present, a `compositus` modus is handed to
   * `compositusCursor.start` (which creates the cost-free parent actum and dispatches
   * step 0) instead of resolving a cursor — a compositus has no `ministerium`, so
   * `cursorum.resolve` would throw. Atomic modi take the normal path below.
   */
  compositusCursor?: {
    start(inceptio: Inceptio, modus: import('../types/modus.js').Modus): Promise<Actum>
  }
}

/**
 * Run the full initiate→dispatch sequence for one Inceptio.
 *
 *   1. inceptor.initiate(inceptio) → Actum
 *   2. actumIndex.record(...)      (fire-and-forget; commitment OR animaId branch)
 *   3. modorum.find(modusId, versiono) → Modus (throws if missing post-initiation)
 *   4. cursorum.resolve(modus) → Cursor
 *   5. cursor.run(actum) under a trace context carrying the identity + actum id
 *   6. sync → completor.complete(); async → leave pending
 *
 * Returns `{ actum, exitus }` on the sync path (exitus defaulting to `{}`),
 * `{ actum }` (no exitus) on the async path.
 */
export async function dispatchInceptio(
  deps: DispatchDeps,
  inceptio: Inceptio,
): Promise<{ actum: Actum; exitus?: Record<string, unknown> }> {
  // Idempotent trace establishment (noema-078). `POST /v1/runs` and MCP dispatch
  // both funnel through here (via CrystalApi.invokeFlow) with NO outer withTrace
  // scope, so for a sync cursor the trailing `completor.complete()` ran outside
  // any AsyncLocalStorage trace and its getTrace()-gated `emitWideEvent` silently
  // no-op'd — the main production channel emitted no wide_events row at all.
  //
  // Establish ONE outer trace spanning the whole lifecycle (cursor.run AND
  // completor.complete) when — and only when — none exists yet. Telegram
  // (index.ts) and the RunPod webhook (webhookRouter.ts) already open their own
  // outer trace before reaching this code, so getTrace() is defined for them and
  // we no-op, leaving both currently-working channels provably unchanged. The
  // inner withTrace around cursor.run below composes on top (it spreads
  // getTrace()), so its self-hosted-cursor timing fields are unaffected either
  // way. Mirrors the api-channel wrap the webhook already uses (platform:'api').
  if (getTrace()) {
    return runDispatch(deps, inceptio)
  }
  return withTrace(makeTraceContext({ platform: 'api' }), () =>
    runDispatch(deps, inceptio),
  )
}

async function runDispatch(
  deps: DispatchDeps,
  inceptio: Inceptio,
): Promise<{ actum: Actum; exitus?: Record<string, unknown> }> {
  const { inceptor, modorum, cursorum, completor } = deps

  // 0. Compositus branch (ADR-0008) — a modus made of modi has no ministerium and
  // can't resolve a cursor. Hand it to the CompositusCursor, which creates the
  // cost-free parent actum and dispatches step 0 (each step re-enters this function
  // as an ordinary atomic run). Returns the parent actum as the run handle.
  const target = await modorum.find(inceptio.modusId, inceptio.versio)
  if (target?.genus === 'compositus') {
    if (!deps.compositusCursor) {
      throw new Error(`Compositus modus '${inceptio.modusId}' dispatched but no compositusCursor configured`)
    }
    const parent = await deps.compositusCursor.start(inceptio, target)
    return { actum: parent }
  }

  // 1. Initiate — balance check + lock signa + create Actum.
  const actum = await inceptor.initiate(inceptio)

  // 1b. ActumIndex — record on whichever side of the AuctorKey union `by` carries.
  // Arcanum-proof runs carry neither animaId nor commitment → skip (no leak, nothing
  // to key on). Fire-and-forget: indexing must never block or fail the dispatch.
  if (deps.actumIndex) {
    const by = inceptio.by
    const branch =
      'animaId' in by ? { animaId: by.animaId }
      : 'commitment' in by ? { commitment: by.commitment }
      : undefined
    if (branch) {
      void deps.actumIndex.record({
        ...branch,
        actumId:   actum.id,
        modusId:   actum.modusId,
        createdAt: actum.inceptum,
      }).catch(() => {})
    }
  }

  // 2. Resolve modus and cursor. Reuse the modus already fetched in step 0 when it
  // matches the locked version (the common path); only re-fetch if it somehow differs.
  const modus = (target && target.versio === actum.modusVersiono)
    ? target
    : await modorum.find(actum.modusId, actum.modusVersiono)
  if (!modus) throw new Error(`Modus '${actum.modusId}' not found after initiation`)

  const cursor = cursorum.resolve(modus)

  // 3. Run — propagate identity + actum id through the trace context so the cursor
  // (and anything downstream) can read them without putting identity on any durable
  // schema (Materia/Modo/Actum stay identity-blind). At most one of animaId/commitment
  // is set; arcanum-proof runs set neither.
  const by = inceptio.by
  const animaId    = 'animaId'    in by ? by.animaId    : undefined
  const commitment = 'commitment' in by ? by.commitment : undefined
  //
  // A cursor that THROWS is a terminal run, so settle it here: `fail()` releases the
  // signa the initiation locked and stamps the actum `fractus`, and the error is then
  // rethrown unchanged for the caller to translate. Without this the actum stays
  // `nascens` with its reservation held until the expiry reaper reaches it — the same
  // terminal outcome, minus the credits the payer cannot use in the meantime. `fail()`
  // is idempotent and returns early on an already-terminal actum, so the reaper and the
  // completion webhook keep behaving exactly as they did; a settle failure is not
  // allowed to replace the original error.
  let cursorResult
  try {
    cursorResult = await withTrace(
      makeTraceContext({ ...getTrace(), animaId, commitment, actumId: actum.id }),
      () => cursor.run(actum),
    )
  } catch (err) {
    await completor.fail(actum, (err as Error)?.message ?? String(err)).catch(() => {})
    throw err
  }

  if (cursorResult.kind === 'sync') {
    // 4a. Sync: complete immediately. Thread the same identified-owner branch used for
    // the trace context above — vestigium indexing (inside complete()) skips when neither
    // is set (arcanum-proof/bursaToken rails stay unlinkable).
    const auctor = animaId !== undefined ? { animaId }
      : commitment !== undefined ? { commitment }
      : undefined
    const completed = await completor.complete(actum, cursorResult.exitus, auctor)
    return { actum: completed, exitus: completed.exitus ?? {} }
  }

  // 4b. Async: leave pending — the completion webhook finishes it.
  return { actum }
}
