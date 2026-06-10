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
  const { inceptor, modorum, cursorum, completor } = deps

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

  // 2. Resolve modus and cursor.
  const modus = await modorum.find(actum.modusId, actum.modusVersiono)
  if (!modus) throw new Error(`Modus '${actum.modusId}' not found after initiation`)

  const cursor = cursorum.resolve(modus)

  // 3. Run — propagate identity + actum id through the trace context so the cursor
  // (and anything downstream) can read them without putting identity on any durable
  // schema (Materia/Modo/Actum stay identity-blind). At most one of animaId/commitment
  // is set; arcanum-proof runs set neither.
  const by = inceptio.by
  const animaId    = 'animaId'    in by ? by.animaId    : undefined
  const commitment = 'commitment' in by ? by.commitment : undefined
  const cursorResult = await withTrace(
    makeTraceContext({ ...getTrace(), animaId, commitment, actumId: actum.id }),
    () => cursor.run(actum),
  )

  if (cursorResult.kind === 'sync') {
    // 4a. Sync: complete immediately.
    const completed = await completor.complete(actum, cursorResult.exitus)
    return { actum: completed, exitus: completed.exitus ?? {} }
  }

  // 4b. Async: leave pending — the completion webhook finishes it.
  return { actum }
}
