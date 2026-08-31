import type { Collectio, Collectionum } from '../types/collectio.js'
import type { Actorum, Inceptio } from '../types/cursus.js'
import type { Actum } from '../types/actum.js'
import { selectForPiece } from './TraitMixer.js'
import { dispatchFailureActumId } from '../execution/dispatchInceptio.js'

// =============================================================================
// CollectioCursor — batch fan-out orchestrator
// =============================================================================
//
// Fans a Collectio out into N Actum executions with configurable concurrency.
// Tracks completion, handles review/revive flows, and marks the Collectio
// completa when all pieces are settled.

/**
 * Step a piece counter down by one without ever going negative. The guards on
 * `approveActum`/`rejectAndRevive` mean a decrement is only reached for a piece
 * that really is held, so this floor is for the one case they cannot cover: a
 * collection persisted before `pendentes` existed, whose held pieces were never
 * counted up in the first place. A counter at 0 stays at 0 rather than going
 * negative and breaking every sum taken over it.
 */
function decrement(n: number): number {
  return n > 0 ? n - 1 : 0
}

export interface CollectioCursorConfig {
  /**
   * When true, every completed actum gets reviewOutcome: 'pending' and is
   * counted in `pendentes` — not `completae` — until a reviewer decides on it.
   */
  reviewEnabled?: boolean
}

interface CollectioState {
  /** Next pieceIndex to dispatch */
  nextIndex: number
  /** actumIds currently in-flight */
  running: Set<string>
  paused: boolean
  /** actumIds awaiting review (only when reviewEnabled) */
  pendingReview: Set<string>
  /** DNA fingerprints already produced — the uniqueness ledger (only used when `Collectio.dna`). */
  usedDna: Set<string>
}

export class CollectioCursor {
  private readonly states = new Map<string, CollectioState>()

  constructor(
    /** Dispatch one piece — `(inceptio) => dispatchInceptio(deps, inceptio)`. Initiates AND
     *  RUNS the piece (sync → completes inline; async pod → parks for the webhook). */
    private readonly dispatch: (inceptio: Inceptio) => Promise<{ actum: Actum; exitus?: Record<string, unknown> }>,
    private readonly collectiones: Collectionum,
    private readonly actorum: Actorum,
    private readonly config: CollectioCursorConfig,
  ) {}

  /**
   * Rehydrate in-memory state for all collections that were agens at the time
   * of a server restart. Call once after container creation, before the server
   * starts accepting requests.
   *
   * A collection with acta still in flight needs no push here — those acta
   * complete via onActumCompleta(), which dispatches the next batch as normal.
   * A collection with nothing in flight and nothing awaiting review has no such
   * event coming, so if its budget is not yet spent, rehydrate re-enters the
   * fan-out for it (see the orphan check below).
   */
  async rehydrate(): Promise<void> {
    const agensList = await this.collectiones.listByStatus('agens')

    for (const collectio of agensList) {
      // Already tracked (e.g. rehydrate called twice) — skip
      if (this.states.has(collectio.id)) continue
      const state = await this._reconstructState(collectio)
      this.states.set(collectio.id, state)

      // Orphan re-dispatch. An agens collection that is unpaused, has no acta
      // in flight and none awaiting review, and has not reached its dispatch
      // budget, has no completion or approval event left to advance it — the
      // fan-out has to be re-entered here or the collection never progresses.
      // The in-flight and pending-review guards keep this off the common path,
      // so a collection whose acta are still running is advanced only by their
      // own completions and is never double-dispatched.
      if (
        !state.paused &&
        state.running.size === 0 &&
        state.pendingReview.size === 0 &&
        state.nextIndex < collectio.numerus + collectio.reiectae
      ) {
        await this._dispatch(collectio.id)
      }
    }
  }

  /**
   * Rebuild in-memory state for one Collectio from its persisted acta — the
   * running/pending sets and the DNA ledger. Shared by rehydrate (on restart)
   * and extend (re-opening a settled collection for another batch). The reject
   * budget is the persisted `reiectae`, so it needs no reconstruction here.
   */
  private async _reconstructState(collectio: Collectio): Promise<CollectioState> {
    const running = new Set<string>()
    const pendingReview = new Set<string>()
    const usedDna = new Set<string>()

    for (const actumId of collectio.acta) {
      const actum = await this.actorum.findById(actumId)
      if (!actum) continue

      if (actum.status === 'nascens' || actum.status === 'agens') {
        running.add(actumId)
      }

      if (actum.exitus?.reviewOutcome === 'pending') {
        pendingReview.add(actumId)
      }

      // Rebuild the DNA ledger from the fingerprint stamped at dispatch time.
      const dna = actum.aditus?._dna
      if (typeof dna === 'string' && dna) usedDna.add(dna)
    }

    return {
      nextIndex: collectio.acta.length,
      running,
      // Re-hydrate the pause: a persisted `pausatum` means dispatching stays
      // held after restart (a paused collection must not silently resume).
      paused: collectio.pausatum !== undefined,
      pendingReview,
      usedDna,
    }
  }

  /**
   * The in-memory state for a Collectio, reconstructing and tracking it when
   * this process has none — the case for every collection after a restart, and
   * for one whose state was cleared when it settled. Returns null only when the
   * Collectio record itself is gone.
   */
  private async _loadState(collectioId: string): Promise<CollectioState | null> {
    const existing = this.states.get(collectioId)
    if (existing) return existing

    const collectio = await this.collectiones.find(collectioId)
    if (!collectio) return null

    const state = await this._reconstructState(collectio)
    this.states.set(collectioId, state)
    return state
  }

  /** Start executing a Collectio — marks it agens, begins dispatching pieces. */
  async start(collectio: Collectio): Promise<void> {
    const state: CollectioState = {
      nextIndex: 0,
      running: new Set(),
      paused: false,
      pendingReview: new Set(),
      usedDna: new Set(),
    }
    this.states.set(collectio.id, state)

    await this.collectiones.update(collectio.id, { status: 'agens' })

    await this._dispatch(collectio.id)
  }

  /**
   * Extend a Collectio's target by `addCount` and dispatch the new pieces —
   * the incremental-batch primitive ("fire 50 → review → fire 50 more"). Works
   * whether the collection is still agens or already completa: state is
   * reconstructed if it was cleared on completion, the target (numerus) grows,
   * the collection re-opens to agens, and the fan-out resumes from where it
   * left off (new pieces get fresh, non-colliding pieceIndexes).
   */
  async extend(collectioId: string, addCount: number): Promise<void> {
    if (addCount <= 0) return
    const collectio = await this.collectiones.find(collectioId)
    if (!collectio) return

    // Reconstruct state if the collection had settled (completa clears it).
    if (!this.states.has(collectioId)) {
      this.states.set(collectioId, await this._reconstructState(collectio))
    }

    await this.collectiones.update(collectioId, {
      numerus: collectio.numerus + addCount,
      status: 'agens',
    })

    await this._dispatch(collectioId)
  }

  /**
   * Call when an Actum from this Collectio reaches completus or fractus.
   * Dispatches the next piece if capacity allows.
   *
   * A piece that generated is counted the moment it settles, whether or not
   * review is on — what differs is WHICH counter it lands in. With review on it
   * is marked `reviewOutcome: 'pending'` and counted in `pendentes` (generated,
   * awaiting a decision); with review off it goes straight to `completae`
   * (generated and accepted). Either way the collection's own record shows the
   * work: a held piece is never counted nowhere.
   */
  async onActumCompleta(
    collectioId: string,
    actumId: string,
    success: boolean,
  ): Promise<void> {
    const state = this.states.get(collectioId)
    if (!state) return

    // Idempotency: if not in running set, this is a duplicate call
    if (!state.running.has(actumId)) return

    state.running.delete(actumId)

    const collectio = await this.collectiones.find(collectioId)
    if (!collectio) return

    // Review is a per-collection choice; the cursor config is the global default
    // for collections that did not specify one (preserves "review on by default").
    const reviewEnabled = collectio.reviewEnabled ?? this.config.reviewEnabled
    if (success && reviewEnabled) {
      // Held for a reviewer: the piece is generated but not yet accepted, so it
      // counts in `pendentes` rather than `completae`. Persisting it here is what
      // makes a review-held run legible to a poller — the in-memory set below is
      // this process's scheduling state, not the collection's record.
      state.pendingReview.add(actumId)
      const actum = await this.actorum.findById(actumId)
      const currentExitus = actum?.exitus ?? {}
      await this.actorum.update(actumId, {
        exitus: { ...currentExitus, reviewOutcome: 'pending' },
      })
      await this.collectiones.update(collectioId, { pendentes: collectio.pendentes + 1 })
    } else if (success) {
      await this.collectiones.update(collectioId, { completae: collectio.completae + 1 })
    } else {
      await this.collectiones.update(collectioId, { fractae: collectio.fractae + 1 })
    }

    await this._checkDone(collectioId)
    await this._dispatch(collectioId)
  }

  /**
   * Approve a held piece: it leaves `pendentes` and counts toward the target in
   * `completae`. Dispatches the next piece.
   *
   * In-memory state is reconstructed from the persisted record when this process
   * has none — a review decision arriving after a restart has to land on live
   * state rather than on nothing (the same reason `pause`/`resume` do it).
   * Only a piece actually held for review moves a counter: a repeat call, or one
   * naming a piece that was never held, is a no-op rather than a second increment.
   */
  async approveActum(collectioId: string, actumId: string): Promise<void> {
    const state = await this._loadState(collectioId)
    if (!state || !state.pendingReview.has(actumId)) return

    const actum = await this.actorum.findById(actumId)
    if (!actum) return

    const currentExitus = actum.exitus ?? {}
    await this.actorum.update(actumId, {
      exitus: { ...currentExitus, reviewOutcome: 'approved' },
    })

    state.pendingReview.delete(actumId)

    const collectio = await this.collectiones.find(collectioId)
    if (!collectio) return

    await this.collectiones.update(collectioId, {
      completae: collectio.completae + 1,
      pendentes: decrement(collectio.pendentes),
    })

    await this._checkDone(collectioId)
    await this._dispatch(collectioId)
  }

  /**
   * Reject a held piece and re-run it with a fresh piece: it leaves `pendentes`
   * for `reiectae`.
   *
   * Sets exitus.reviewOutcome = 'rejected' on the original actum and bumps
   * `reiectae` — which extends the dispatch budget (numerus + reiectae) by one,
   * so the sequential fan-out generates one replacement piece. The replacement
   * gets the next free pieceIndex (always ≥ every original index), so it never
   * reproduces the rejected piece's selection — no nextIndex juggling needed.
   * A rejection is NOT a failure: it does not touch `fractae`.
   *
   * State is reconstructed and the held-piece guard applies exactly as in
   * `approveActum` — a rejection extends the budget, so a repeated one would
   * dispatch a piece the collection never asked for.
   */
  async rejectAndRevive(collectioId: string, actumId: string): Promise<void> {
    const state = await this._loadState(collectioId)
    if (!state || !state.pendingReview.has(actumId)) return

    const actum = await this.actorum.findById(actumId)
    if (!actum) return

    // Mark original as rejected
    const currentExitus = actum.exitus ?? {}
    await this.actorum.update(actumId, {
      exitus: { ...currentExitus, reviewOutcome: 'rejected' },
    })

    state.pendingReview.delete(actumId)

    const collectio = await this.collectiones.find(collectioId)
    if (!collectio) return

    // Rejection extends the dispatch budget by one → a replacement is generated.
    await this.collectiones.update(collectioId, {
      reiectae: collectio.reiectae + 1,
      pendentes: decrement(collectio.pendentes),
    })

    await this._dispatch(collectioId)
  }

  /**
   * Returns the collectioId that owns the given actumId if it is currently
   * in-flight (nascens/agens), or null if not tracked by this cursor.
   * Used by the webhook handler to route completion events to the right collection.
   */
  findCollectioIdForActum(actumId: string): string | null {
    for (const [collectioId, state] of this.states) {
      if (state.running.has(actumId)) return collectioId
    }
    return null
  }

  /**
   * Pause dispatching new pieces (in-flight pieces continue). Persisted on the
   * Collectio record (`pausatum`) so the pause survives a restart — see
   * `_reconstructState`.
   *
   * In-memory state is reconstructed from the persisted record when this
   * process has none for the collection, so a pause issued after a restart
   * lands on live state rather than on nothing.
   */
  async pause(collectioId: string): Promise<void> {
    await this.collectiones.update(collectioId, { pausatum: new Date() })
    const state = await this._loadState(collectioId)
    if (state) state.paused = true
  }

  /**
   * Resume dispatching after a pause. Clears the persisted `pausatum` and
   * re-enters the fan-out, reconstructing in-memory state from the persisted
   * record when this process has none — the case after a restart.
   */
  async resume(collectioId: string): Promise<void> {
    await this.collectiones.update(collectioId, { pausatum: undefined })
    const state = await this._loadState(collectioId)
    if (!state) return
    state.paused = false
    await this._dispatch(collectioId)
  }

  // ── Internal ────────────────────────────────────────────────────────────────

  /** Core fan-out loop — dispatches pieces while slots are available. */
  private async _dispatch(collectioId: string): Promise<void> {
    const state = this.states.get(collectioId)
    if (!state || state.paused) return

    const collectio = await this.collectiones.find(collectioId)
    if (!collectio) return

    const totalPieces = collectio.numerus + collectio.reiectae
    const syncDone: string[] = []
    let failedDispatches = 0

    while (
      state.running.size < collectio.concurrentia &&
      state.nextIndex < totalPieces
    ) {
      const pieceIndex = state.nextIndex++

      const selection = selectForPiece({
        tractus: collectio.tractus,
        pieceIndex,
        basePrompt: collectio.aditusBase._basePrompt as string | undefined,
        collectionName: collectio.nomen,
        totalPieces: collectio.numerus,
        // Opt-in DNA uniqueness: feed the ledger so the mixer rerolls collisions.
        ...(collectio.dna ? { usedDna: state.usedDna } : {}),
      })

      // Record this piece's DNA so subsequent pieces avoid it (when deduping).
      if (collectio.dna) state.usedDna.add(selection.dna)

      // An axis may vary the `prompt` port directly (`porta: 'prompt'`), in which case the mixer
      // has already placed the winning value on `selection.aditus.prompt`. The assembled prompt
      // (basePrompt + promptFragments, in join or token mode) is the value for the common case
      // where no axis targets that port, so it stands in only when the axes left it unset.
      const selectedAditus = selection.aditus as Record<string, unknown>
      const aditus: Record<string, unknown> = {
        ...collectio.aditusBase,
        ...selection.aditus,
        prompt: selectedAditus.prompt ?? selection.prompt,
        _pieceIndex: pieceIndex,
        _attributes: selection.attributes,
        _dna: selection.dna,
      }

      const inceptio: Inceptio = {
        modusId: collectio.modusId,
        aditus,
        by: collectio.by,
      }

      let result
      try {
        result = await this.dispatch(inceptio)
      } catch (err) {
        // A dispatch that threw is a piece this collection does not get. Two things
        // have to happen here or the collection loses track of it:
        //
        //  1. If an actum was persisted before the throw, its id comes back on the
        //     error. Append it to `acta` so the run the collection paid to initiate is
        //     a visible member of the collection, settled like any other terminal
        //     piece. Its signa were already released by the dispatch itself.
        //  2. Count it in `fractae` and carry on. No completion event is coming for
        //     this piece — it never entered `running`, so neither the webhook nor
        //     `onActumCompleta` will ever advance the collection on its behalf.
        //
        // The piece consumes its slot in the dispatch budget: a failed piece is
        // failed, and no replacement is dispatched for it (that is what `reiectae`
        // does, for reviewer rejections only).
        failedDispatches += 1
        const failedActumId = dispatchFailureActumId(err)
        const current = await this.collectiones.find(collectioId)
        if (current) {
          await this.collectiones.update(collectioId, {
            fractae: current.fractae + 1,
            ...(failedActumId ? { acta: [...current.acta, failedActumId] } : {}),
          })
        }
        continue
      }

      const actum = result.actum
      state.running.add(actum.id)

      // Persist actumId in Collectio.acta
      const fresh = await this.collectiones.find(collectioId)
      if (fresh) {
        await this.collectiones.update(collectioId, {
          acta: [...fresh.acta, actum.id],
        })
      }

      // Sync cursors complete the piece inline — no webhook will fire, so advance
      // the collection ourselves. (Real async pods → the webhook's collectioRouter
      // calls onActumCompleta.) Deferred past the loop to avoid re-entrant dispatch.
      if (result.exitus !== undefined) syncDone.push(actum.id)
    }

    for (const actumId of syncDone) {
      await this.onActumCompleta(collectioId, actumId, true)
    }

    // A piece whose dispatch threw produces no completion event, so this is the only
    // place that can settle the collection on its behalf. Without it a collection whose
    // dispatches all fail stays `agens` forever with nothing in flight — no pieces, no
    // terminal state, and nothing to tell anyone it is finished.
    if (failedDispatches > 0) await this._checkDone(collectioId)
  }

  /** Check if the Collectio is done and mark it completa if so. */
  private async _checkDone(collectioId: string): Promise<void> {
    const state = this.states.get(collectioId)
    if (!state) return

    if (
      state.running.size === 0 &&
      state.pendingReview.size === 0 &&
      state.nextIndex >= (await this._totalPieces(collectioId, state))
    ) {
      await this.collectiones.update(collectioId, {
        status: 'completa',
        completum: new Date(),
      })
      // Clean up in-memory state
      this.states.delete(collectioId)
    }
  }

  /** The number of pieces to dispatch: the target plus one replacement per rejection. */
  private async _totalPieces(collectioId: string, state: CollectioState): Promise<number> {
    const collectio = await this.collectiones.find(collectioId)
    if (!collectio) return state.nextIndex
    return collectio.numerus + collectio.reiectae
  }
}
