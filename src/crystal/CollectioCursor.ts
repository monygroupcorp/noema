import type { Collectio, Collectionum } from '../types/collectio.js'
import type { Actorum } from '../types/cursus.js'
import type { ActumInceptor } from '../execution/ActumInceptor.js'
import { selectForPiece } from './TraitMixer.js'

// =============================================================================
// CollectioCursor — batch fan-out orchestrator
// =============================================================================
//
// Fans a Collectio out into N Actum executions with configurable concurrency.
// Tracks completion, handles review/revive flows, and marks the Collectio
// completa when all pieces are settled.

export interface CollectioCursorConfig {
  /**
   * When true, every completed actum gets reviewOutcome: 'pending' and waits
   * for approval before the next piece is dispatched and before completae is
   * incremented.
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
  /** How many revives have happened (used to extend numerus effectively) */
  reviveCount: number
}

export class CollectioCursor {
  private readonly states = new Map<string, CollectioState>()

  constructor(
    private readonly inceptor: ActumInceptor,
    private readonly collectiones: Collectionum,
    private readonly actorum: Actorum,
    private readonly config: CollectioCursorConfig,
  ) {}

  /** Start executing a Collectio — marks it agens, begins dispatching pieces. */
  async start(collectio: Collectio): Promise<void> {
    const state: CollectioState = {
      nextIndex: 0,
      running: new Set(),
      paused: false,
      pendingReview: new Set(),
      reviveCount: 0,
    }
    this.states.set(collectio.id, state)

    await this.collectiones.update(collectio.id, { status: 'agens' })

    await this._dispatch(collectio.id)
  }

  /**
   * Call when an Actum from this Collectio reaches completus or fractus.
   * Dispatches the next piece if capacity allows.
   * When reviewEnabled, marks the completed actum's exitus with
   * reviewOutcome: 'pending' and does NOT increment completae until approval.
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

    if (success && this.config.reviewEnabled) {
      // Mark pending review — do not increment completae yet
      state.pendingReview.add(actumId)
      const actum = await this.actorum.findById(actumId)
      const currentExitus = actum?.exitus ?? {}
      await this.actorum.update(actumId, {
        exitus: { ...currentExitus, reviewOutcome: 'pending' },
      })
    } else if (success) {
      await this.collectiones.update(collectioId, { completae: collectio.completae + 1 })
    } else {
      await this.collectiones.update(collectioId, { fractae: collectio.fractae + 1 })
    }

    await this._checkDone(collectioId)
    await this._dispatch(collectioId)
  }

  /** Approve a pending-review actum. Increments Collectio.completae, dispatches next piece. */
  async approveActum(collectioId: string, actumId: string): Promise<void> {
    const state = this.states.get(collectioId)
    if (!state) return

    const actum = await this.actorum.findById(actumId)
    if (!actum) return

    const currentExitus = actum.exitus ?? {}
    await this.actorum.update(actumId, {
      exitus: { ...currentExitus, reviewOutcome: 'approved' },
    })

    state.pendingReview.delete(actumId)

    const collectio = await this.collectiones.find(collectioId)
    if (!collectio) return

    await this.collectiones.update(collectioId, { completae: collectio.completae + 1 })

    await this._checkDone(collectioId)
    await this._dispatch(collectioId)
  }

  /**
   * Reject a pending-review actum and re-run it with a new seed.
   * Sets exitus.reviewOutcome = 'rejected' on the original actum.
   * Dispatches a new piece using pieceIndex beyond numerus (deterministic revive).
   */
  async rejectAndRevive(collectioId: string, actumId: string): Promise<void> {
    const state = this.states.get(collectioId)
    if (!state) return

    const actum = await this.actorum.findById(actumId)
    if (!actum) return

    // Mark original as rejected
    const currentExitus = actum.exitus ?? {}
    await this.actorum.update(actumId, {
      exitus: { ...currentExitus, reviewOutcome: 'rejected' },
    })

    state.pendingReview.delete(actumId)
    state.reviveCount++

    // Ensure revive pieces start at index >= numerus — deterministic, never
    // collides with original run. LCG seeded by pieceIndex, so numerus+n gives
    // a different but deterministic result per revive.
    if (state.nextIndex < (await this._collectioNumerus(collectioId))) {
      state.nextIndex = await this._collectioNumerus(collectioId)
    }

    const collectio = await this.collectiones.find(collectioId)
    if (!collectio) return

    // The rejected piece counts as fractus for accounting
    await this.collectiones.update(collectioId, { fractae: collectio.fractae + 1 })

    // Dispatch a new piece — nextIndex now equals or exceeds numerus
    await this._dispatch(collectioId)
  }

  /** Pause dispatching new pieces (in-flight pieces continue). */
  async pause(collectioId: string): Promise<void> {
    const state = this.states.get(collectioId)
    if (state) state.paused = true
  }

  /** Resume dispatching after a pause. */
  async resume(collectioId: string): Promise<void> {
    const state = this.states.get(collectioId)
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

    const totalPieces = collectio.numerus + state.reviveCount

    while (
      state.running.size + state.pendingReview.size < collectio.concurrentia &&
      state.nextIndex < totalPieces
    ) {
      const pieceIndex = state.nextIndex++

      const selection = selectForPiece({
        tractus: collectio.tractus,
        pieceIndex,
        basePrompt: collectio.aditusBase._basePrompt as string | undefined,
        collectionName: collectio.nomen,
        totalPieces: collectio.numerus,
      })

      const aditus: Record<string, unknown> = {
        ...collectio.aditusBase,
        ...selection.aditus,
        prompt: selection.prompt,
        _pieceIndex: pieceIndex,
        _attributes: selection.attributes,
      }

      const inceptio = {
        modusId: collectio.modusId,
        aditus,
        by: collectio.by,
      }

      const actum = await this.inceptor.initiate(inceptio)
      state.running.add(actum.id)

      // Persist actumId in Collectio.acta
      const fresh = await this.collectiones.find(collectioId)
      if (fresh) {
        await this.collectiones.update(collectioId, {
          acta: [...fresh.acta, actum.id],
        })
      }
    }
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

  private async _totalPieces(collectioId: string, state: CollectioState): Promise<number> {
    const collectio = await this.collectiones.find(collectioId)
    if (!collectio) return state.nextIndex
    return collectio.numerus + state.reviveCount
  }

  private async _collectioNumerus(collectioId: string): Promise<number> {
    const collectio = await this.collectiones.find(collectioId)
    return collectio?.numerus ?? 0
  }
}
