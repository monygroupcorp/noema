import type { AuctorKey } from '../../../flow/types.js'
import { toCollection } from '../runProjection.js'
import { Errors } from '../errors.js'
import type { Collection, CollectionPiece } from '../types.js'
import type { Collectio, Tractus } from '../../../types/collectio.js'
import { provenanceHash } from '../../../crystal/provenance.js'
import { rarityReport, type RarityReport } from '../../../crystal/rarityReport.js'
import type { CollectOpts } from '../CrystalApi.js'
import { log } from './support.js'
import { CrystalApiWorkspace } from './workspace.js'

/** Collections: creating, firing, steering and reviewing a batch of runs. */
export abstract class CrystalApiCollections extends CrystalApiWorkspace {
  // ── Collections (Collectio) ─────────────────────────────────────────────────

  /**
   * Start a Collection — create a `Collectio` (a base modus expanded over a
   * `Tractus[]` grid) and fan it out via the CollectioCursor. General-purpose:
   * NFT rarity/attributes/export ride on the same grid but are opt-in. Returns
   * the public Collection. The base modus may be atomic OR a compositus pipeline.
   */
  async collect(auctor: AuctorKey, opts: CollectOpts): Promise<Collection> {
    // Dispute freeze (noema-082, freeze-boundary v2 2026-07-22): the ENTIRE Collections path is a
    // user-initiated credit outflow — a non-draft collect dispatches (spends) immediately, and a
    // draft is fired later. Gated at the top alongside invokeFlow (run spend) and owned-purse mint.
    await this._assertNotDisputeFrozen(auctor)
    const { collectiones, collectioCursor } = this.deps
    if (!collectiones || !collectioCursor) throw Errors.notFoundCollection('collections')

    // The caller is always the concrete funding identity. A team overlay
    // (sodalitasId + a snapshotted owners split) layers shared ownership on top.
    const by = this._collectionBy(auctor)
    let sodalitasId: string | undefined
    let owners: Collectio['owners']
    if (opts.teamId !== undefined) {
      const team = await this._memberTeam(auctor, opts.teamId)
      sodalitasId = team.id
      // Snapshot an equal-weight split across the team's membership.
      owners = team.membra.map((animaId) => ({ animaId, weight: 1 / team.membra.length }))
    }

    // A DRAFT may not know its flow yet (creating a collection is a naming act — the flow,
    // supply and grid are authored afterwards). An ABSENT flow on a draft is not a bogus flow,
    // so validation is skipped and the collection is left flowless (`''`) with no provenance.
    // Everything else — including a draft that DID name a flow, and every non-draft — keeps the
    // original strictness: a bogus/missing modusId would otherwise create a collection whose
    // every piece fails at dispatch. (Mirrors invokeFlow/quote.)
    const isDraft = !!opts.draft
    const modusId = opts.modusId ?? ''
    const tractus = opts.tractus ?? []
    const aditusBase = opts.aditusBase ?? {}

    let provenance = ''
    if (!isDraft || opts.modusId !== undefined) {
      const modus = await this.deps.modorum.find(modusId)
      if (!modus) throw Errors.notFoundFlow(modusId)
      // Resource scope comes from the CALLER, and this is where it has to be settled: the
      // `aditusBase` stored here is spread into every piece `CollectioCursor` later dispatches,
      // and those dispatches carry the collection's funder, not the caller who wrote this base.
      // Checked once, at the write, rather than on every dispatch tick.
      await this._assertOwnedAditus(auctor, modus, aditusBase)
      // A collection created live dispatches at once, so its flow's licence terms bind the
      // creator here; a draft is held to them when it is fired.
      if (!isDraft) await this._assertUseTerms(auctor, modus)
      // Pin the provenance hash to the resolved flow version.
      provenance = provenanceHash({ modusId, modusVersio: modus.versio, tractus, aditusBase })
    }

    const collectio = await collectiones.create({
      ...(opts.nomen !== undefined ? { nomen: opts.nomen } : {}),
      ...(opts.descriptio !== undefined ? { descriptio: opts.descriptio } : {}),
      modusId,
      aditusBase,
      tractus,
      numerus: opts.total ?? 0,
      provenanceHash: provenance,
      by,
      ...(sodalitasId !== undefined ? { sodalitasId } : {}),
      ...(owners !== undefined ? { owners } : {}),
      concurrentia: opts.concurrentia ?? 3,
      ...(opts.dna !== undefined ? { dna: opts.dna } : {}),
      ...(opts.reviewEnabled !== undefined ? { reviewEnabled: opts.reviewEnabled } : {}),
      // Draft = authored but not fired; tractus stays editable until fireCollection.
      status: opts.draft ? 'draft' : 'nascens',
    })
    // A draft is NOT dispatched — the caller authors tractus, then fires it.
    if (!opts.draft) await collectioCursor.start(collectio)
    return toCollection((await collectiones.find(collectio.id)) ?? collectio)
  }

  /**
   * Fire a DRAFT collection — freeze its tractus and start the run. Re-derives the
   * provenance hash from the current tractus + the flow's live version (pinning
   * exactly what executes), then dispatches. Owner-scoped + funder-only (it spends).
   * Idempotent-guarded: only a `draft` may be fired.
   */
  async fireCollection(auctor: AuctorKey, id: string): Promise<Collection> {
    // Dispute freeze (noema-082, freeze-boundary v2): firing a draft dispatches the run — a spend.
    await this._assertNotDisputeFrozen(auctor)
    const { collectiones, collectioCursor } = this.deps
    if (!collectiones || !collectioCursor) throw Errors.notFoundCollection('collections')
    const c = await this._ownedCollection(auctor, id)
    if (!this._isFunder(auctor, c)) {
      throw Errors.authForbidden('only the collection funder can fire it')
    }
    if (c.status !== 'draft') throw Errors.inputMalformed('only a draft collection can be fired')

    // Creating a collection is free and may leave the generative config unset — so firing is
    // where completeness is enforced. Without these, an unfinished draft would not "fail to
    // fire", it would dispatch garbage: a flowless run, a zero-piece run, or a grid with no
    // axis of variation. Each missing piece gets its own message so the UI can say what to fix.
    if (!c.modusId) throw Errors.notFoundFlow('(none chosen yet)')
    if (!(c.numerus > 0)) throw Errors.inputMalformed('this collection has no supply yet — set how many pieces to generate before firing')
    if (c.tractus.length === 0) throw Errors.inputMalformed('this collection has no traits yet — add at least one axis of variation before firing')

    // Re-pin provenance to the flow version at fire time (the config that actually runs).
    const modus = await this.deps.modorum.find(c.modusId)
    // Every piece dispatches under the funder, below the run entry point, so the flow's licence
    // terms bind the funder here, before the first piece is reserved.
    await this._assertUseTerms(auctor, modus)
    const provenance = provenanceHash({
      modusId: c.modusId,
      modusVersio: modus?.versio,
      tractus: c.tractus,
      aditusBase: c.aditusBase,
    })
    const fired = await collectiones.update(id, { provenanceHash: provenance, status: 'nascens' })
    await collectioCursor.start(fired)
    return toCollection((await collectiones.find(id)) ?? fired)
  }

  /**
   * The collection-config write: set a collection's base flow, supply and/or trait grid, and
   * re-derive its provenance hash — the content-address MUST change when the flow, the grid,
   * a weight, an exclude, or a tag changes. Owner-scoped.
   *
   * `collect` may now create a draft that knows none of these (create is a naming act), so this
   * is where a draft learns them. A flowless draft still content-addresses to `''` — there is
   * nothing to hash until a flow is chosen.
   *
   * The freeze is PER FIELD, not per method:
   *  - while `status === 'draft'`, every field is writable;
   *  - once fired, `tractus` and `numerus` are frozen — a patch carrying either is refused, even
   *    if the sent value happens to equal the stored one (the wire cannot express "unchanged");
   *  - once fired, `modusId` is still writable, but by the funder alone — the flow directs what
   *    the collection's `by` pays for. Changing it is forward-only: `CollectioCursor`
   *    re-reads the collection on every dispatch tick, so a later dispatch expands the new flow,
   *    while already-dispatched `acta` keep the `aditus` they were created with. Provenance is
   *    re-derived so the content-address matches whatever the collection now points at.
   */
  async patchCollectionDraft(
    auctor: AuctorKey,
    id: string,
    patch: { tractus?: Tractus[]; modusId?: string; numerus?: number },
  ): Promise<Collection> {
    const { collectiones } = this.deps
    if (!collectiones) throw Errors.notFoundCollection('collections')
    const c = await this._ownedCollection(auctor, id)
    if (c.status !== 'draft') {
      const changingFlow = patch.modusId !== undefined
      const changingTraitsOrSupply = patch.tractus !== undefined || patch.numerus !== undefined
      // A fired collection accepts a flow change and nothing else. A patch that also carries
      // traits/supply, or that carries nothing to change at all, is refused.
      if (changingTraitsOrSupply || !changingFlow) {
        throw Errors.inputMalformed('a collection’s traits and supply are frozen once it is fired')
      }
      // A fired collection keeps dispatching: `CollectioCursor` re-reads `modusId` on every tick,
      // so a post-fire flow change directs pieces that are funded by the collection's `by`. That
      // makes it a spend-directing write, gated exactly like `fireCollection` and
      // `extendCollection` — the funder only. Draft-mode team editing is unaffected: this branch
      // is reached only once the collection has been fired.
      if (!this._isFunder(auctor, c)) {
        throw Errors.authForbidden('only the collection funder can change a fired collection’s flow')
      }
    }

    // The draft's supply reaches the same dispatch budget an extend does, by the other door:
    // the route reads it as `Number(numerus)`, so an unparseable one arrives as NaN. Zero is
    // allowed here — a draft may be authored before its supply is decided — where an extend
    // of nothing is not a request anyone means to make.
    if (patch.numerus !== undefined) this._assertPieceCount(patch.numerus, 'numerus', 0)

    const modusId = patch.modusId ?? c.modusId
    const tractus = patch.tractus ?? c.tractus
    const modus = modusId ? await this.deps.modorum.find(modusId) : null
    // Only a NEWLY-named flow is validated — an already-stored one keeps the pre-existing
    // lenient behaviour (an unresolvable modus simply pins an undefined version).
    if (patch.modusId !== undefined && !modus) throw Errors.notFoundFlow(patch.modusId)
    // A flow change re-reads the SAME stored `aditusBase` through a different set of declared
    // ports, so a value that named nothing under the old flow can become a reference under the
    // new one. Re-checked against the caller making the change, for that reason.
    if (patch.modusId !== undefined) await this._assertOwnedAditus(auctor, modus, c.aditusBase ?? {})
    // A fired collection's new flow starts dispatching on the next tick, so its terms bind the
    // funder making the change (the branch above has already required the funder).
    if (patch.modusId !== undefined && c.status !== 'draft') await this._assertUseTerms(auctor, modus)
    const provenance = modusId
      ? provenanceHash({ modusId, modusVersio: modus?.versio, tractus, aditusBase: c.aditusBase })
      : ''

    return toCollection(await collectiones.update(id, {
      tractus,
      provenanceHash: provenance,
      ...(patch.modusId !== undefined ? { modusId } : {}),
      ...(patch.numerus !== undefined ? { numerus: patch.numerus } : {}),
    }))
  }

  /** Replace a DRAFT collection's tractus. Thin alias over the draft-authoring write. */
  async patchCollectionTractus(auctor: AuctorKey, id: string, tractus: Tractus[]): Promise<Collection> {
    return this.patchCollectionDraft(auctor, id, { tractus })
  }

  /**
   * Fetch a Collection, owner-scoped. Also stamps `inFlight` — the one run-liveness count
   * the poll-driven run screen needs that the Collectio does not itself record, so it is
   * derived here by an acta scan (the same pattern `getCollectionRarity` uses).
   *
   * `pendingReview` is NOT derived here: it is a piece counter the collection maintains
   * (`pendentes`), and `toCollection` projects it alongside `completed`/`failed`/`rejected`.
   * That keeps one source for the counters that have to sum against `total`, and makes them
   * available on every projection rather than only on this one.
   */
  async getCollection(auctor: AuctorKey, id: string): Promise<Collection> {
    const c = await this._ownedCollection(auctor, id)
    const out = toCollection(c)
    out.inFlight = await this._collectionInFlight(c)
    return out
  }

  /**
   * Count a Collection's in-flight (nascens/agens) acta for its run-liveness display.
   *
   * Counted IN THE STORE (`Actorum.countByIdsWithStatus`), because this read gates the run
   * screen: `/collections/:id/run` shows "Loading…" until `getCollection` answers and polls it
   * every 2.5 seconds thereafter. Walking the acta one `findById` at a time made the cost of
   * answering scale with the size of the run being displayed — the largest collections, the ones
   * whose progress most needs watching, were the slowest to draw and got slower as they grew.
   *
   * The per-actum scan survives as the fallback for a store with no counting read.
   */
  protected async _collectionInFlight(c: Collectio): Promise<number> {
    if (c.acta.length === 0) return 0
    const { actorum } = this.deps
    if (actorum.countByIdsWithStatus) {
      return actorum.countByIdsWithStatus(c.acta, ['nascens', 'agens'])
    }
    let inFlight = 0
    for (const actumId of c.acta) {
      const actum = await actorum.findById(actumId)
      if (!actum) continue
      if (actum.status === 'nascens' || actum.status === 'agens') inFlight++
    }
    return inFlight
  }

  /**
   * The target-vs-realized rarity table for a Collection — what the creator
   * dialled in (normalized `TraitValor.rarity`) vs what was actually produced
   * (counted from the `_attributes` stamped on each completed piece). Drift is
   * expected at low N. Owner-scoped. Counts only successfully-produced,
   * non-rejected pieces.
   */
  async getCollectionRarity(auctor: AuctorKey, id: string): Promise<RarityReport> {
    const c = await this._ownedCollection(auctor, id)
    const pieces: Array<Array<{ trait_type: string; value: string }>> = []
    for (const actumId of c.acta) {
      const actum = await this.deps.actorum.findById(actumId)
      if (!actum || actum.status !== 'completus') continue
      if (actum.exitus?.reviewOutcome === 'rejected') continue
      const attrs = actum.aditus?._attributes
      if (Array.isArray(attrs)) pieces.push(attrs as Array<{ trait_type: string; value: string }>)
    }
    return rarityReport({ tractus: c.tractus, pieces })
  }

  /**
   * List a Collection's generated pieces for the curation queue — each completed
   * Actum's media + stamped attributes + review state. Filtered by `review`
   * (default 'pending', the review use case; 'all' returns every completed piece).
   * Owner-scoped.
   */
  async listCollectionPieces(
    auctor: AuctorKey,
    id: string,
    review: 'pending' | 'approved' | 'rejected' | 'all' = 'pending',
  ): Promise<CollectionPiece[]> {
    const c = await this._ownedCollection(auctor, id)
    const out: CollectionPiece[] = []
    for (const actumId of c.acta) {
      const actum = await this.deps.actorum.findById(actumId)
      if (!actum || actum.status !== 'completus') continue
      const outcome = (actum.exitus?.reviewOutcome as CollectionPiece['review'] | undefined) ?? 'none'
      if (review !== 'all' && outcome !== review) continue
      const attrs = actum.aditus?._attributes
      out.push({
        actumId,
        review: outcome,
        output: actum.exitus,
        ...(Array.isArray(attrs) ? { attributes: attrs as CollectionPiece['attributes'] } : {}),
      })
    }
    return out
  }

  /**
   * List the caller's Collections, newest first — owner-scoped and paged IN THE STORE
   * (`Collectionum.listOwned`), cursor-paginated like `GET /v1/me/runs` and `GET /v1/data/datasets`.
   *
   * The scope is a query, not a post-filter: a collection the caller may not name is never loaded,
   * and one caller's listing does not read every other tenant's documents. `sodalitasIds` is
   * resolved here from the authenticated caller and never taken from a request parameter.
   */
  async listCollections(
    auctor: AuctorKey,
    opts: { cursor?: string; limit?: number } = {}
  ): Promise<{ collections: Collection[]; nextCursor?: string }> {
    const store = this.deps.collectiones
    if (!store) return { collections: [] }
    // `_isFunder` matches an anima against `by.animaId` and a commitment against `by.commitment`,
    // and nothing else — a bursa-token caller funds no collection, so its list is empty.
    const by: Collectio['by'] | null =
      'animaId' in auctor ? { animaId: auctor.animaId }
      : 'commitment' in auctor ? { commitment: auctor.commitment }
      : null
    if (!by) return { collections: [] }
    const sodalitasIds = await this._callerTeamIds(auctor)

    if (store.listOwned) {
      const { entries, nextCursor } = await store.listOwned({ by, sodalitasIds, ...opts })
      return { collections: entries.map(toCollection), ...(nextCursor ? { nextCursor } : {}) }
    }

    // Fallback for a store with no owner-scoped read (the in-memory ones): the pre-existing
    // in-process filter, with the caller's team ids resolved ONCE (not one lookup per collection).
    const all = await store.list()
    const teamIds = new Set(sodalitasIds)
    return { collections: all.filter((c) => this._ownsCollectionWith(auctor, c, teamIds)).map(toCollection) }
  }

  /** Synchronous ownership check given a precomputed set of the caller's team ids. */
  protected _ownsCollectionWith(auctor: AuctorKey, c: Collectio, teamIds: Set<string>): boolean {
    if (this._isFunder(auctor, c)) return true
    return c.sodalitasId !== undefined && teamIds.has(c.sodalitasId)
  }

  /**
   * Extend a Collection's target by `addCount` and dispatch the new pieces —
   * the incremental-batch primitive (fire a batch, review, fire more toward a
   * larger goal over time). Re-opens a completed Collection. Owner-scoped.
   */
  async extendCollection(auctor: AuctorKey, id: string, addCount: number): Promise<Collection> {
    // Dispute freeze (noema-082, freeze-boundary v2): extend raises a collection's funded piece
    // count (numerus + addCount) and dispatches those NEW pieces — new user-initiated outflow, the
    // same collectioCursor-dispatch mechanism resume/fire use. Gated per the ruling's "principle is
    // total" standing instruction for any FURTHER discovered outflow chokepoint (noted for review).
    await this._assertNotDisputeFrozen(auctor)
    const c = await this._ownedCollection(auctor, id)
    // Extending dispatches new pieces funded by the collection's `by` (the
    // creator). Only that funder may extend — otherwise a team member could
    // spend the creator's balance. Pooled-funding extend arrives with the team
    // ledger (deferred).
    if (!this._isFunder(auctor, c)) {
      throw Errors.authForbidden('only the collection funder can extend it (team-pooled funding is not yet available)')
    }
    // The new pieces are paid runs of the collection's flow, so its licence terms bind the funder.
    await this._assertUseTerms(auctor, c.modusId ? await this.deps.modorum.find(c.modusId) : null)
    // Checked after the gates, so a malformed count never tells a stranger whether the
    // collection exists. An extend raises the dispatch budget, so the SUM has to stay exact
    // too — a valid `addCount` on an already-large collection is still refused if it would
    // push the target past where integer arithmetic holds.
    this._assertPieceCount(addCount, 'count', 1)
    this._assertPieceCount(c.numerus + addCount, 'the extended target', 1)
    await this.deps.collectioCursor?.extend(id, addCount)
    return toCollection((await this.deps.collectiones!.find(id))!)
  }

  /**
   * A piece count that reaches the store, checked before it gets there.
   *
   * `numerus` is not a display field: `numerus + reiectae` is `CollectioCursor`'s dispatch
   * budget, and the fan-out advances while `nextIndex < budget`. A non-number written into it
   * makes that comparison false forever, so the collection reads as `agens`, shows as
   * generating, and dispatches nothing — the failure `MongoCollectio`'s `fromDoc` already
   * defends `reiectae` against, reached instead through the wire. `Number(undefined)` is `NaN`
   * and `NaN <= 0` is false, so a request that simply omits the count walks past every
   * downstream guard, which is why the check belongs here and not on the route: the HTTP
   * router, the MCP tool and the concierge all arrive through this method.
   *
   * The upper bound is arithmetic, not policy: past `Number.MAX_SAFE_INTEGER` the budget sum
   * stops being exact, and a piece index can no longer be told apart from its neighbour.
   */
  protected _assertPieceCount(n: number, field: string, min: number): void {
    if (!Number.isSafeInteger(n) || n < min) {
      throw Errors.inputMalformed(`${field} must be a whole number of pieces, ${min} or more`)
    }
  }

  /** Pause dispatching new pieces (in-flight finish). Persisted — survives a restart. Owner-scoped. */
  async pauseCollection(auctor: AuctorKey, id: string): Promise<Collection> {
    const c = await this._ownedCollection(auctor, id)
    await this.deps.collectioCursor?.pause(id)
    return toCollection((await this.deps.collectiones!.find(id)) ?? c)
  }

  /** Resume dispatching after a pause. Owner-scoped. */
  async resumeCollection(auctor: AuctorKey, id: string): Promise<Collection> {
    // Dispute freeze (noema-082, freeze-boundary v2): resume triggers new spends. After a dispute
    // resolves the operator lifts the flag first, then resume works.
    await this._assertNotDisputeFrozen(auctor)
    const c = await this._ownedCollection(auctor, id)
    // Resuming dispatches paid pieces under the collection's funder, so the flow's licence terms
    // bind the funder — the identity the pieces are charged to, whoever presses resume.
    await this._assertUseTerms(c.by, c.modusId ? await this.deps.modorum.find(c.modusId) : null)
    await this.deps.collectioCursor?.resume(id)
    return toCollection((await this.deps.collectiones!.find(id)) ?? c)
  }

  /**
   * Cancel a Collection — stop dispatching, mark it `cancellata`, and settle the pieces it
   * still has in flight. Owner-scoped.
   *
   * A cancel settles the work the collection has in flight: each in-flight piece is cancelled
   * through the SAME settlement `cancelRun` uses (`_settleCancelled` → `completor.fail`), so a
   * cancelled piece's reservation is released rather than charged, and there is one expression
   * of "cancel a run" rather than a collection-shaped second one.
   *
   * ORDER matters. Dispatching is held first, so no slot freed by a settled piece refills.
   * The record is marked terminal SECOND, before any piece is settled, because the cursor
   * reads that status when a piece leaves flight: a collection already `cancellata` is not
   * re-settled as `completa` by its own last piece.
   *
   * IDEMPOTENT: a collection with nothing in flight — already cancelled, still a draft, or
   * finished — settles nothing and is not an error. The sweep works off what is actually in
   * flight, and the settlement is itself a no-op on an already-terminal run.
   *
   * A piece whose settlement throws is left in flight and named in the log rather than
   * aborting the sweep: the remaining pieces are still cancelled, and the collection still
   * reaches its terminal state.
   */
  async cancelCollection(auctor: AuctorKey, id: string): Promise<Collection> {
    await this._ownedCollection(auctor, id)
    const collectiones = this.deps.collectiones!
    const cursor = this.deps.collectioCursor
    await cursor?.pause(id)
    const cancelled = await collectiones.update(id, { status: 'cancellata' })
    if (!cursor) return toCollection(cancelled)

    const report = await cursor.cancelInFlight(id, (actumId) => this._settleCancelledById(actumId))
    if (report.unsettled.length) {
      log.warn('collection cancel: some pieces could not be settled', {
        collectioId: id,
        unsettled: report.unsettled.length,
        errors: report.unsettled.map((u) => u.error),
      })
    }
    // Re-read: the sweep moves the piece counters through the cursor, so the record the
    // caller gets back is the one the cancel left behind, not the one it started from.
    return toCollection((await collectiones.find(id)) ?? cancelled)
  }

  /** Review: approve a pending piece (it counts toward the collection). Owner-scoped. */
  async approveCollectionPiece(auctor: AuctorKey, id: string, actumId: string): Promise<void> {
    await this._ownedCollection(auctor, id)
    await this.deps.collectioCursor?.approveActum(id, actumId)
  }

  /**
   * Review: reject a pending piece and reroll it with a fresh seed. Owner-scoped + funder-only.
   *
   * A rejection is not a verdict that costs nothing. `CollectioCursor.rejectAndRevive` bumps
   * `reiectae`, and the dispatch budget is `numerus + reiectae` — so every rejection raises the
   * number of pieces the collection will generate by one, funded by the collection's `by`. That
   * is the same new outflow `extendCollection` creates, reached by a different verb, and the
   * ceiling is the number of times a reviewer chooses to press the button.
   *
   * Ownership is a team overlay, so without this gate any member of the collection's Sodalitas
   * could spend the creator's balance a piece at a time. Approval is left to the whole team on
   * purpose: accepting a piece settles work already paid for and dispatches nothing.
   */
  async rejectCollectionPiece(auctor: AuctorKey, id: string, actumId: string): Promise<void> {
    // Dispute freeze (noema-082, freeze-boundary v2): a rejection dispatches a replacement piece —
    // user-initiated outflow, gated while the anima is frozen like every other chokepoint.
    await this._assertNotDisputeFrozen(auctor)
    const c = await this._ownedCollection(auctor, id)
    if (!this._isFunder(auctor, c)) {
      throw Errors.authForbidden('only the collection funder can reject a piece (a rejection rerolls it at the funder’s expense)')
    }
    // The reroll is a new paid run of the collection's flow, held to its licence terms.
    await this._assertUseTerms(auctor, c.modusId ? await this.deps.modorum.find(c.modusId) : null)
    await this.deps.collectioCursor?.rejectAndRevive(id, actumId)
  }
}
