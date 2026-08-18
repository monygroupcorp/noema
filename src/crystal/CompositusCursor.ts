import { randomUUID } from 'node:crypto'
import type { Actum } from '../types/actum.js'
import type { Modus, Modorum } from '../types/modus.js'
import type { Actorum, Inceptio } from '../types/cursus.js'
import { MAX_TERMINUS_MS } from '../execution/ActumInceptor.js'

// =============================================================================
// CompositusCursor — sequential chain orchestrator (ADR-0008)
// =============================================================================
//
// Runs a `compositus` Modus — a modus whose body is other modi, wired by `gradus`
// steps. The direct sequential sibling of `CollectioCursor` (the batch fan-out):
// where CollectioCursor expands one modus over a grid into N parallel pieces, this
// threads N steps in series, feeding each step's `exitus` into the next step's
// `aditus` per the step's `ligamina`.
//
// A run is observed as ONE parent Actum (the compositus). The parent is a cost-free
// umbrella: it locks no signa of its own. Each step is its own real child Actum,
// dispatched through `dispatchInceptio` exactly like a normal run — so it goes
// through the normal cursor, locks/settles its own signa, and carries its own
// provenance. The parent accrues the running impetus sum and finishes with the
// final step's exitus.
//
// SYNC vs ASYNC steps fall out of `dispatchInceptio` for free:
//   - a sync cursor completes the step inline → `dispatch()` returns its exitus →
//     we advance immediately (the whole chain runs inside `start()`; no webhook).
//   - an async pod step parks (`dispatch()` returns no exitus) → the execution
//     webhook later routes the completed child back here via `onStepComplete`
//     (it reads `Actum.compositum.parentId` — no lookup table needed).
//
// V1 SCOPE (ADR-0008): strictly sequential by `ordine`; `parallel`/`condicio` are
// not yet honored. In-flight chains are tracked in memory and do NOT survive a
// process restart (the payer credential `by` is held in memory only) — durable
// rehydrate is deferred to the surface phase.
// =============================================================================

interface RunState {
  parentId: string
  /** The compositus modus — carries the gradus steps. */
  modus: Modus
  /** gradus sorted by ordine — the execution order. */
  gradus: NonNullable<Modus['gradus']>
  /** The resolved child modus for each gradus, aligned by index — fetched + validated
   *  (atomic-only) up front in start(), so steps don't re-find and a malformed chain
   *  can't deadlock mid-run. */
  childModi: Modus[]
  /** Who pays — held in memory across the async boundary (not persisted; see header). */
  by: Inceptio['by']
  /** The cast inputs — bound into each step's aditus by matching name. */
  baseAditus: Record<string, unknown>
  modoId?: string
  /** Completed steps' outputs, keyed by gradus.ordine — read by downstream ligamina. */
  exitusByOrdine: Map<number, Record<string, unknown>>
  /** Running sum of child impetus — stamped on the parent at completion. */
  impetusTotal: bigint
  /** Index into `gradus` of the next step to dispatch. */
  nextStepIndex: number
  /** The child actum id currently in flight (async step), if any. */
  runningChildId?: string
}


export class CompositusCursor {
  private readonly states = new Map<string, RunState>()

  constructor(
    /** Dispatch one step — `(inceptio) => dispatchInceptio(deps, inceptio)`, injected to avoid a cycle. */
    private readonly dispatch: (inceptio: Inceptio) => Promise<{ actum: Actum; exitus?: Record<string, unknown> }>,
    private readonly modorum: Modorum,
    private readonly actorum: Actorum,
    /**
     * Wall-clock budget for ONE step, in ms —
     * `(m, a) => cursorum.resolve(m).terminus?.(m, a) ?? DEFAULT_EXPIRAT_MS`.
     *
     * Injected as a function for the same reason `dispatch` is: CompositusCursor must not depend
     * on Cursorum. REQUIRED rather than optional-with-a-default on purpose — a default would let
     * the parent's deadline be correct in tests while production kept a flat one, which is exactly
     * the shape of defect the derived deadline exists to remove.
     */
    private readonly terminusOf: (modus: Modus, aditus: Record<string, unknown>) => Promise<number>,
  ) {}

  /**
   * Begin a compositus run. Creates the cost-free parent actum, then dispatches
   * step 0. Returns the parent actum (the observable run handle). Sync chains run
   * to completion before this resolves; async chains park after their first step.
   */
  async start(inceptio: Inceptio, modus: Modus): Promise<Actum> {
    const gradus = [...(modus.gradus ?? [])].sort((a, b) => a.ordine - b.ordine)
    if (gradus.length === 0) throw new Error(`Compositus modus '${modus.id}' has no gradus steps`)

    // v1 is flat-only (ADR-0008): resolve + validate every step UP FRONT so a malformed
    // chain fails fast — before any parent actum or spend — instead of deadlocking mid-run.
    // Catches: nested compositus (incl. a self-reference, which resolves to genus
    // 'compositus'), a missing child modus, and `condicio` (not yet honored — rejecting
    // it is safer than silently running a step the author meant to gate).
    const childModi: Modus[] = []
    for (const g of gradus) {
      if (g.condicio !== undefined) {
        throw new Error(`Compositus '${modus.id}' step ${g.ordine}: condicio is not supported in v1`)
      }
      const child = await this.modorum.find(g.modusId)
      if (!child) {
        throw new Error(`Compositus '${modus.id}' step ${g.ordine}: modus '${g.modusId}' not found`)
      }
      if (child.genus !== 'atomicus') {
        throw new Error(`Compositus '${modus.id}' step ${g.ordine}: nested compositus modi are not supported in v1 (flat chains only)`)
      }
      childModi.push(child)
    }

    // The parent must OUTLIVE its steps. It locks no signa of its own, but it is swept by the same
    // expiry reaper as any other actum, and a reaped parent fails the whole chain through
    // `onStepComplete(..., false)` — while a child is still legitimately running. So its deadline
    // is derived from its contents: the sum of the steps' own wall-clock budgets, since v1 chains
    // are strictly sequential. Clamped to the same ceiling every terminus is clamped to.
    //
    // A flat ceiling would also outlive any chain, but it would make the parent's deadline
    // unrelated to what it contains — every chain, however short, would then sit in `agens` for
    // the full ceiling before anything noticed it was stuck.
    let stepBudgetMs = 0
    for (const child of childModi) {
      stepBudgetMs += await this.terminusOf(child, inceptio.aditus)
    }
    const parentTerminusMs = Math.min(stepBudgetMs, MAX_TERMINUS_MS)

    const parentId = randomUUID()
    const parent = await this.actorum.create({
      id: parentId,
      modusId: modus.id,
      modusVersiono: modus.versio,
      ...(inceptio.modoId ? { modoId: inceptio.modoId } : {}),
      impetus: 0n,           // cost-free umbrella — children carry the real spend
      signaConsumed: [],     // no signa locked at the parent
      aditus: inceptio.aditus,
      status: 'nascens',
      expirat: new Date(Date.now() + parentTerminusMs),
    })

    this.states.set(parentId, {
      parentId,
      modus,
      gradus,
      childModi,
      by: inceptio.by,
      baseAditus: inceptio.aditus,
      modoId: inceptio.modoId,
      exitusByOrdine: new Map(),
      impetusTotal: 0n,
      nextStepIndex: 0,
      runningChildId: undefined,
    })

    await this.actorum.update(parentId, { status: 'agens' })
    await this._advance(parentId)

    return (await this.actorum.findById(parentId)) ?? parent
  }

  /**
   * Resume a chain after an async child step completes (or fails). Called by the
   * execution webhook for any completed actum that carries `compositum`.
   */
  async onStepComplete(parentId: string, childActum: Actum, success: boolean): Promise<void> {
    const state = this.states.get(parentId)
    if (!state) return // unknown run (e.g. lost across a restart) — nothing to advance

    // Idempotency: only the in-flight child advances the chain.
    if (state.runningChildId && childActum.id !== state.runningChildId) return

    if (!success) {
      await this.actorum.update(parentId, {
        status: 'fractus',
        error: childActum.error ?? 'compositus step failed',
        impetus: state.impetusTotal,
        completum: new Date(),
      })
      this.states.delete(parentId)
      return
    }

    this._recordStep(state, childActum)
    state.runningChildId = undefined
    await this._advance(parentId)
  }

  // ── Internal ────────────────────────────────────────────────────────────────

  /** Record a completed step's exitus + impetus into the run state. */
  private _recordStep(state: RunState, childActum: Actum): void {
    const ordine = childActum.compositum?.ordine ?? state.gradus[state.nextStepIndex]?.ordine ?? state.nextStepIndex
    state.exitusByOrdine.set(ordine, childActum.exitus ?? {})
    state.impetusTotal += childActum.impetus
    state.nextStepIndex += 1
  }

  /** Dispatch the next step, or complete the parent if the chain is done. */
  private async _advance(parentId: string): Promise<void> {
    const state = this.states.get(parentId)
    if (!state) return

    // Done — the last step's exitus is the compositus output.
    if (state.nextStepIndex >= state.gradus.length) {
      const lastOrdine = state.gradus[state.gradus.length - 1].ordine
      await this.actorum.update(parentId, {
        status: 'completus',
        exitus: state.exitusByOrdine.get(lastOrdine) ?? {},
        impetus: state.impetusTotal,
        completum: new Date(),
      })
      this.states.delete(parentId)
      return
    }

    const g = state.gradus[state.nextStepIndex]
    const childModus = state.childModi[state.nextStepIndex]  // resolved + validated in start()
    const childAditus = this._bindAditus(state, g, childModus)

    const childInceptio: Inceptio = {
      modusId: g.modusId,
      aditus: childAditus,
      by: state.by,
      ...(state.modoId ? { modoId: state.modoId } : {}),
      compositum: { parentId, ordine: g.ordine },
    }

    let result: { actum: Actum; exitus?: Record<string, unknown> }
    try {
      result = await this.dispatch(childInceptio)
    } catch (err) {
      await this.actorum.update(parentId, {
        status: 'fractus',
        error: `compositus step ${g.ordine}: ${err instanceof Error ? err.message : String(err)}`,
        impetus: state.impetusTotal,
        completum: new Date(),
      })
      this.states.delete(parentId)
      return
    }

    state.runningChildId = result.actum.id

    // Sync step: dispatchInceptio already completed it inline → advance now.
    // (exitus present means the child settled synchronously.)
    if (result.exitus !== undefined) {
      const completed = (await this.actorum.findById(result.actum.id)) ?? result.actum
      this._recordStep(state, completed)
      state.runningChildId = undefined
      await this._advance(parentId)
      return
    }

    // Async step: parked. The webhook will call onStepComplete when it lands.
  }

  /**
   * Assemble a step's aditus. Precedence (most specific first):
   *   1. explicit ligamen — a prior step's exitus port,
   *   2. compositus aditus by matching name,
   *   3. (omitted) → the child modus's own Porta.default applies at compile.
   * Only ports the child actually declares are populated.
   */
  private _bindAditus(state: RunState, g: RunState['gradus'][number], childModus: Modus): Record<string, unknown> {
    const out: Record<string, unknown> = {}

    // 2. by-name from the cast inputs (only keys the child accepts)
    for (const key of Object.keys(childModus.aditus)) {
      if (key in state.baseAditus) out[key] = state.baseAditus[key]
    }

    // 1. explicit ligamina override — pull from a prior step's exitus
    for (const [porta, fons] of Object.entries(g.ligamina ?? {})) {
      const src = state.exitusByOrdine.get(fons.gradus)
      if (src && fons.exitus in src) out[porta] = src[fons.exitus]
    }

    return out
  }

  /** Test/diagnostic: is this run still tracked in memory? */
  isTracking(parentId: string): boolean {
    return this.states.has(parentId)
  }
}
