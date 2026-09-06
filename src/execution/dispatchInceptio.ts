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
import type { Modorum, Modus } from '../types/modus.js'
import type { Cursorum, ActumCompletor, CursorResult, Inceptio } from '../types/cursus.js'
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
  /**
   * The warm-pod line. When present, a cursor refusing a run because the warm pool it
   * elected to wait for is empty puts the run in the line instead of failing it (see
   * the catch in `runDispatch`). Absent → that refusal settles the run exactly as any
   * other dispatch failure does, which is what happened before the line existed.
   */
  queue?: QueueGate
}

/**
 * QueueGate — the two questions the dispatch asks the warm-pod line, and nothing else.
 *
 * Declared structurally here rather than imported, so the execution rail keeps its one
 * direction of dependency: the concrete `Vocator` lives in the crystal rail and knows
 * about pods, images and the cursor error that names them; this rail knows only that
 * some refusals mean "wait", and that something is willing to hold the run until then.
 */
export interface QueueGate {
  /**
   * The image ref this error says the run is waiting for, or null when the error is not
   * a wait-for-a-pod refusal at all. Every other error is a failure and settles the run
   * — the gate never widens that.
   */
  imageAwaited(err: unknown): string | null
  /** Take the run into the line for `imageRef`. A throw here settles the run. */
  enqueue(actum: Actum, imageRef: string): Promise<void>
  /**
   * Where a run stands, or null when it holds no place. Read by the facades so a run
   * that queued can be DESCRIBED as queued — a caller told "executing" about a run that
   * is actually waiting has been told the wrong thing, however briefly.
   */
  place(actumId: string): Promise<{ place: number; depth: number } | null>
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

  // 2-3. Everything from here on runs with the initiation's signa LOCKED, so every
  // exit from this region has to settle the actum. The invariant is "any post-initiate
  // throw releases what the initiation acquired", and it is expressed once, as a single
  // guarded region covering modus resolution, cursor resolution and the run itself:
  //
  //   - `fail()` releases the locked signa and stamps the actum `fractus`, so the payer
  //     gets the credits back immediately rather than when the expiry reaper reaches the
  //     record.
  //   - `fail()` is idempotent and returns early on an already-terminal actum, so the
  //     reaper and the completion webhook keep behaving exactly as they did.
  //   - A settle failure is never allowed to replace the original error.
  //   - The original error is rethrown unchanged, carrying one addition: the id of the
  //     actum that was persisted before the throw (`dispatchFailureActumId`). A caller
  //     that tracks the runs it dispatched — a Collectio, for one — needs that id to
  //     account for the failed piece instead of leaving it outside its own bookkeeping.
  //
  // Identity is read before the guarded region because the sync completion below reuses
  // it. At most one of animaId/commitment is set; arcanum-proof runs set neither.
  const by = inceptio.by
  const animaId    = 'animaId'    in by ? by.animaId    : undefined
  const commitment = 'commitment' in by ? by.commitment : undefined

  let cursorResult: CursorResult
  try {
    cursorResult = await runCursor(deps, actum, { animaId, commitment }, target ?? undefined)
  } catch (err) {
    // A refusal that means "no warm pod, YET" is not a failure. The payer elected to
    // wait for warm capacity rather than pay for a cold start, so the honest answer to
    // an empty pool is to hold the run until one frees — not to settle it and make the
    // user ask again. The run stays `nascens` with its signa locked, exactly as it
    // stands between initiation and dispatch on any other rail, and the line's own
    // caller dispatches it when a pod falls idle.
    //
    // Only the gate decides which refusals qualify, and only when a line is wired.
    // Everything else — and a line that cannot take the run — settles below, so no
    // failure the dispatch used to report becomes a silent wait.
    const imageRef = deps.queue?.imageAwaited(err) ?? null
    if (imageRef !== null) {
      const queued = await deps.queue!.enqueue(actum, imageRef).then(() => true, () => false)
      if (queued) return { actum }
    }
    await completor.fail(actum, (err as Error)?.message ?? String(err)).catch(() => {})
    throw markDispatchFailure(err, actum.id)
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

/**
 * Resolve the actum's modus + cursor and run it under a trace context — the half of the
 * dispatch that is identical whether the run is reaching a cursor for the first time or
 * being called out of the warm-pod line minutes later.
 *
 * `hint` is the modus the caller already read (the common path on a first dispatch);
 * it is used only when it matches the version locked onto the actum.
 */
async function runCursor(
  deps: Pick<DispatchDeps, 'modorum' | 'cursorum'>,
  actum: Actum,
  owner: { animaId?: string; commitment?: string },
  hint?: Modus,
): Promise<CursorResult> {
  const { modorum, cursorum } = deps
  const modus = (hint && hint.versio === actum.modusVersiono)
    ? hint
    : await modorum.find(actum.modusId, actum.modusVersiono)
  if (!modus) throw new Error(`Modus '${actum.modusId}' not found after initiation`)

  const cursor = cursorum.resolve(modus)

  // Propagate identity + actum id through the trace context so the cursor (and anything
  // downstream) can read them without putting identity on any durable schema
  // (Materia/Modo/Actum stay identity-blind).
  return withTrace(
    makeTraceContext({ ...getTrace(), ...owner, actumId: actum.id }),
    () => cursor.run(actum),
  )
}

/**
 * Dispatch an actum that already exists — the second half of a run that was admitted
 * earlier and has been waiting in the warm-pod line. Its signa are already locked and
 * its record is already written, so there is no initiation to redo: this resolves the
 * cursor and runs it, and nothing else.
 *
 * NO OWNER IS THREADED, and that is not an oversight. An Actum is identity-blind by
 * construction and the line is too, so by the time a freed pod calls a waiting run
 * there is no caller left to resolve — which is exactly the situation the completion
 * WEBHOOK is already in, and the webhook is what finishes these runs: the queue holds
 * pod-rail work, which is async. A sync cursor reaching here would complete without a
 * vestigium (the indexing skips on an absent auctor, as it does for the anonymous
 * rails) rather than complete wrongly.
 *
 * Throws exactly what the cursor throws — including the empty-pool refusal, which the
 * caller reads as "still nothing free" and puts the run back in the line. Settlement
 * is the caller's decision here, not this function's.
 */
export async function dispatchQueuedActum(
  deps: Pick<DispatchDeps, 'modorum' | 'cursorum' | 'completor'>,
  actum: Actum,
): Promise<{ actum: Actum; exitus?: Record<string, unknown> }> {
  const cursorResult = await runCursor(deps, actum, {})
  if (cursorResult.kind === 'sync') {
    const completed = await deps.completor.complete(actum, cursorResult.exitus)
    return { actum: completed, exitus: completed.exitus ?? {} }
  }
  return { actum }
}

// ---------------------------------------------------------------------------
// Dispatch failure — carrying the persisted actum id back to the caller
// ---------------------------------------------------------------------------
//
// A dispatch can throw either BEFORE an actum exists (initiation refused: unknown
// modus, insufficient balance) or AFTER one has been persisted and its signa locked.
// Only the second case leaves a run for the caller to account for, and the two are
// otherwise indistinguishable at the call site.
//
// So a post-initiate failure stamps the persisted actum id onto the error it rethrows.
// The error object itself is unchanged — same instance, same message, same stack — and
// the property is non-enumerable, so it does not alter serialisation or equality checks
// on the error. Callers read it with `dispatchFailureActumId(err)`; a caller that does
// not care sees exactly the error it saw before.

const DISPATCH_FAILURE_ACTUM_ID = '__noemaDispatchFailureActumId'

/** Stamp the persisted actum id onto an error and return that same error. */
function markDispatchFailure(err: unknown, actumId: string): unknown {
  if (err !== null && typeof err === 'object') {
    try {
      Object.defineProperty(err, DISPATCH_FAILURE_ACTUM_ID, {
        value: actumId,
        enumerable: false,
        configurable: true,
        writable: true,
      })
    } catch {
      // A frozen or sealed error cannot carry the id; the throw still propagates.
    }
  }
  return err
}

/**
 * The id of the actum that was persisted before a dispatch threw, or `undefined` when
 * the failure happened before any actum existed (nothing to account for) or the error
 * did not come from `dispatchInceptio`.
 */
export function dispatchFailureActumId(err: unknown): string | undefined {
  if (err === null || typeof err !== 'object') return undefined
  const id = (err as Record<string, unknown>)[DISPATCH_FAILURE_ACTUM_ID]
  return typeof id === 'string' ? id : undefined
}
