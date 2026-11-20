import type { AuctorKey } from '../../../flow/types.js'
import { Errors, ApiError } from '../errors.js'
import type { Collection } from '../types.js'
import { liveMedia } from '../../../types/dataset.js'
import type { Dataset, DatasetMediaItem, IngestMediaInput } from '../../../types/dataset.js'
import { floorToEntries, isMuseSessionVersionConflict } from '../../../types/museSession.js'
import type { FragmentIdentity, MuseSessions, StoredMuseSession } from '../../../types/museSession.js'
import { fragmentKey, isCategory, type Category, type Fragment } from '../../../crystal/muse/taxonomy.js'
import {
  DuplicatePieceError, EmptyFragmentTextError, UnknownCategoryError, UnknownFragmentError,
  UnknownPieceError, addFragment, enabledFragments, keepRoll, keptRollsOf, manualFragment,
  reconcileFloor, recordPiece, setFragmentEnabled, setFragmentWeight, spawnSession, updatePiece,
  withSessionDataset, withSetup, type MuseSession, type PiecePatch, type Reaction,
} from '../../../crystal/muse/session.js'
import { MAX_INSTRUCTION_CHARS, type SteerProposal } from '../../../crystal/muse/steer.js'
import { promotionFrom } from '../musePromote.js'
import { MODUS_MUSE_STEER } from '../../../crystal/seeds/modi.js'
import type { MuseSessionView, SteerProposalView } from '../CrystalApi.js'
import { MUSE_SESSION_SAVE_ATTEMPTS } from './support.js'
import { CrystalApiCompute } from './compute.js'

/** Muse sessions: the fragment floor, pieces, promotion and steering. */
export abstract class CrystalApiMuse extends CrystalApiCompute {
  // ── Muse sessions (noema-248) ────────────────────────────────────────────
  //
  // A session is a break-off of a dataset with its own floor and its own piece
  // ledger. `src/crystal/muse/session.ts` holds the whole domain and every
  // mutator there is pure — it takes a session and returns a new one. These
  // methods are a thin shell over exactly those functions plus the store: read
  // the stored session, call the pure mutator, write the result back. There is
  // deliberately no second mutation path, so a floor can only ever change the
  // way the pure module says it changes.
  //
  // Owner scoping is resolved HERE, from the authenticated caller, and never
  // from a request parameter — the same rule `getDataset` follows. The store
  // takes an id and nothing else, so there is no owner argument a caller could
  // reach.

  protected _museSessionsStore(): MuseSessions {
    const store = this.deps.museSessions
    if (!store) throw new ApiError('not_found.muse_session', 'Muse sessions unavailable', 404)
    return store
  }

  /**
   * The key a Muse session is scoped/matched against — an identified account's `animaId`, or
   * (unlike `_datasetOwner`) an anonymous caller's `commitment`. Sessions off a PUBLIC dataset
   * are meant to be sat at and configured with no account at all — see the dataset gate
   * `spawnMuseSession` resolves through (`getDataset`, which already admits `access.kind ===
   * 'public'`); a session can only ever be SPAWNED off a dataset the caller may read, so
   * widening this to commitment never opens a session on a private dataset to a stranger.
   *
   * `commitment` is a stable per-browser value (`localStorage`, noema-commitment) rather than a
   * one-shot credential, which is what makes "resume the session I was just configuring" work
   * for a returning anonymous visitor: the SAME commitment matches `stored.owner` on the next
   * request. A different anonymous visitor's different commitment does not, so one stranger's
   * anonymous session stays as closed to another as an owner's does.
   *
   * `{ bursaToken }` (the third `AuctorKey` arm, a spend-only bearer credential the client never
   * sends on a read) falls through to the same refusal `_datasetOwner` gives it — deliberately
   * not treated as a stable identity to scope a resumable session against.
   *
   * DELIBERATELY NOT a green light for keeping, recording, steering or promoting — those
   * verbs go THROUGH this resolver (via `_museSession`/`_mutateMuseSession`) but are each
   * additionally gated by `_requireAccount`, rth's product ruling (2026-09-02): an anonymous
   * visitor may sit at a public dataset's Muse session and configure it — lock, vary, enable or
   * weight a fragment — but the account (and top-up) modal intercepts before anything actually
   * spends or persists past the session's own working state. Firing a roll itself is gated
   * client-side, at the fire button, not here — `createRun` is the generic run route every
   * anonymous chat/generation already fires through, and narrowing IT for Muse specifically
   * would need its own aditus-level change this item does not make.
   */
  protected _museSessionOwner(auctor: AuctorKey): string {
    if ('animaId' in auctor) return auctor.animaId
    if ('commitment' in auctor) return auctor.commitment
    throw Errors.authForbidden('Muse sessions require an identified account or an anonymous commitment')
  }

  /**
   * Require a real, identified account — the far side of `_museSessionOwner`'s configure-freely
   * boundary. Called FIRST, before any other work, by every Muse verb that goes beyond sitting
   * at a session and configuring it: `keepMuseRoll`, `recordMusePiece`, `updateMusePiece`,
   * `saveMusePiece`, `steerMuseSession`, `promoteMuseSession`. Spawning, resuming, reading and
   * configuring a session (fragment enable/weight, run setup) do NOT call this — the whole point of
   * the split. A caller refused here still has a real, usable session; they only lose the verbs
   * gated here until they have an account.
   */
  protected _requireAccount(auctor: AuctorKey): void {
    if (!('animaId' in auctor)) throw Errors.authForbidden('this action requires an identified account')
  }

  /** The wire projection of a stored session — the floor as an entry array, never a Map. */
  protected _museSessionView(stored: StoredMuseSession): MuseSessionView {
    return {
      id: stored.id,
      owner: stored.owner,
      motherDatasetId: stored.session.motherDatasetId,
      ...(stored.session.sessionDatasetId ? { sessionDatasetId: stored.session.sessionDatasetId } : {}),
      fragments: [...stored.session.fragments],
      floor: floorToEntries(stored.session.floor),
      pieces: [...stored.session.pieces],
      ...(stored.session.setup ? { setup: stored.session.setup } : {}),
      // Always projected, empty list included: a session written before the field
      // existed carries none, and a client that had to tell "absent" from "empty"
      // apart would be reading a storage detail rather than the session.
      keptRolls: keptRollsOf(stored.session).map((r) => ({ ...r })),
      natum: stored.natum,
      mutatum: stored.mutatum,
    }
  }

  /**
   * Resolve a session the caller owns, or 404.
   *
   * A session belonging to someone else is reported as not found, never as
   * forbidden — identical to the error for an id that has never existed, so the
   * surface does not confirm that a stranger's session exists.
   */
  protected async _museSession(auctor: AuctorKey, id: string): Promise<StoredMuseSession> {
    const owner = this._museSessionOwner(auctor)
    const stored = await this._museSessionsStore().find(id)
    if (!stored || stored.owner !== owner) {
      throw new ApiError('not_found.muse_session', `Muse session '${id}' not found`, 404)
    }
    return stored
  }

  /**
   * Persist a pure mutator against a session, re-applying it if the session moved.
   *
   * THE ONE PLACE A SESSION IS WRITTEN, and the reason every mutator on this
   * surface is a pure function rather than an in-place edit. The store's `save`
   * replaces the session wholesale under a version match, so a write computed
   * from a read that is no longer current is refused rather than landed. What
   * makes that recoverable instead of an error the user sees is that the mutator
   * can simply be run again: it takes a session and returns a new one, so on a
   * conflict this re-reads the session as it now stands and applies the SAME
   * mutator to THAT value. The retried write therefore carries both changes —
   * the concurrent writer's and this caller's — where a bare replace would have
   * carried only the later one.
   *
   * Bounded rather than unbounded: a session under genuinely continuous write
   * pressure should surface a retryable conflict to the caller, not spin. The
   * mutator is a pure function of the session, so re-running it is free of side
   * effects — any validation it performs (a fragment must be held, a run must be
   * in the ledger) is re-checked against the fresh session, which is the correct
   * answer rather than a cached one.
   */
  protected async _saveMuseSession(
    stored: StoredMuseSession,
    mutate: (session: MuseSession) => MuseSession,
  ): Promise<StoredMuseSession> {
    const store = this._museSessionsStore()
    const notFound = () => new ApiError('not_found.muse_session', `Muse session '${stored.id}' not found`, 404)

    let current = stored
    for (let attempt = 0; attempt < MUSE_SESSION_SAVE_ATTEMPTS; attempt++) {
      const next = mutate(current.session)
      try {
        const saved = await store.save(current.id, next, current.versio ?? 0)
        if (!saved) throw notFound()
        return saved
      } catch (err) {
        if (!isMuseSessionVersionConflict(err)) throw err
        // Re-read and go again. The owner is re-checked because the session this
        // caller was cleared for is the one it must still be writing to.
        const fresh = await store.find(current.id)
        if (!fresh || fresh.owner !== stored.owner) throw notFound()
        current = fresh
      }
    }
    // Every attempt lost. 409 rather than 500: nothing is wrong with the request and the
    // stored session is intact — the contention is other writes to the same session, so
    // the same call sent again is expected to land. Constructed here rather than in the
    // `Errors` taxonomy, as the other codes this surface raises are.
    throw new ApiError(
      'conflict.muse_session',
      `Muse session '${stored.id}' is being changed concurrently`,
      409,
      { retryable: true },
    )
  }

  /** Apply a pure mutator to a session the caller owns and persist the result. */
  protected async _mutateMuseSession(
    auctor: AuctorKey,
    id: string,
    mutate: (session: MuseSession) => MuseSession,
  ): Promise<MuseSessionView> {
    const stored = await this._museSession(auctor, id)
    return this._museSessionView(await this._saveMuseSession(stored, mutate))
  }

  /** A `{ category, text }` pair off the wire, validated into a fragment identity. */
  protected _fragmentIdentity(raw: unknown): FragmentIdentity {
    const body = (raw ?? {}) as { category?: unknown; text?: unknown }
    const category = typeof body.category === 'string' ? body.category : ''
    if (!isCategory(category)) throw Errors.inputMalformed('category must be a Muse fragment category')
    const text = typeof body.text === 'string' ? body.text.trim() : ''
    if (!text) throw Errors.inputMalformed('text is required')
    return { category: category as Category, text }
  }

  /**
   * Spawn a session off a dataset the caller owns.
   *
   * The session is spawned from the dataset's fragments pooled DATASET-WIDE —
   * every LIVE media item's fragments, in item order — not from one item's alone. A
   * session is a break-off of the whole dataset. An archived item has left the working
   * set, so its fragments do not seed a session drawn after the archive; sessions already
   * spawned keep the floor they were given, which is what a break-off means.
   */
  async spawnMuseSession(auctor: AuctorKey, datasetId: string): Promise<MuseSessionView> {
    const owner = this._museSessionOwner(auctor)
    const dataset = await this.getDataset(auctor, datasetId)

    const stored = await this._museSessionsStore().create({
      owner,
      session: spawnSession(dataset.id, this._pooledFragments(dataset)),
    })
    return this._museSessionView(stored)
  }

  /**
   * A dataset's fragments pooled dataset-wide — every LIVE media item's, in item order.
   *
   * The one place this pooling is written. A spawn takes the floor from it and a resume
   * reconciles against it, and the two reading the same pool is what makes the floor and
   * the garden the client rolls from describe the same set of fragments.
   */
  protected _pooledFragments(dataset: { media: Dataset['media'] }): Fragment[] {
    const pooled: Fragment[] = []
    for (const item of liveMedia(dataset.media)) pooled.push(...(item.fragments ?? []))
    return pooled
  }

  /**
   * The mother's current pool, resolved with the caller's own ownership, or `null` when
   * it cannot be read.
   *
   * `null` is not an error path — it is the reconcile declining to run. A session whose
   * mother has been removed, or whose mother the caller can no longer read, still has a
   * floor and a ledger of its own and is still worth returning; the read that would 404
   * is swallowed here so a resume keeps working rather than becoming unreachable.
   */
  protected async _motherPool(auctor: AuctorKey, motherDatasetId: string): Promise<Fragment[] | null> {
    try {
      return this._pooledFragments(await this.getDataset(auctor, motherDatasetId))
    } catch {
      return null
    }
  }

  /**
   * A stored session with every fragment its mother now holds and its floor does not
   * merged in, PERSISTED.
   *
   * Persisted rather than decorated onto the view: the record route resolves a piece's
   * lineage against the STORED floor, so a view-only merge would show fragments the
   * client can roll from and the ledger would still reject. Unchanged sessions are not
   * written — `reconcileFloor` returns the same object when there is nothing to add.
   */
  protected async _reconciledSession(
    stored: StoredMuseSession,
    pooled: readonly Fragment[],
  ): Promise<StoredMuseSession> {
    const next = reconcileFloor(stored.session, pooled)
    if (next === stored.session) return stored
    try {
      return await this._saveMuseSession(stored, (session) => reconcileFloor(session, pooled))
    } catch (err) {
      // A resume declines rather than fails. The merge only ever WIDENS a floor and
      // is recomputed on the next read, so a session that was being written
      // concurrently is returned as it was read; the fragments it is missing are
      // merged in the next time it is resumed. This mirrors `_motherPool` returning
      // null rather than raising when the mother cannot be read.
      if (err instanceof ApiError) return stored
      throw err
    }
  }

  /**
   * A session the caller owns, reconciled with its mother's live garden. A stranger's id
   * is reported as not found.
   *
   * The read that resumes a session is where the merge belongs: the client is about to
   * roll against the mother as it stands now, so the floor it validates against has to
   * describe the same fragments. The merge only ever widens the floor (`reconcileFloor`)
   * — no steer is undone by resuming.
   */
  async getMuseSession(auctor: AuctorKey, id: string): Promise<MuseSessionView> {
    const stored = await this._museSession(auctor, id)
    const pooled = await this._motherPool(auctor, stored.session.motherDatasetId)
    if (!pooled) return this._museSessionView(stored)
    return this._museSessionView(await this._reconciledSession(stored, pooled))
  }

  /**
   * The caller's own sessions off one dataset, most recently changed first.
   *
   * The route a session is reached from carries the dataset, not the session, so
   * without this a client returning to a dataset has no way to name the session
   * it was in and can only spawn another one. Resolving that pointer here — from
   * the store, keyed by the authenticated owner — keeps it durable across a
   * reload and across devices, which a client-held id is not.
   *
   * The owner comes from the resolved caller and is passed to the store as the
   * query's own scope, so the list cannot contain a stranger's session at any
   * point. A dataset the caller does not own resolves to no sessions rather than
   * to an error: the dataset read that would 404 is not performed, and an empty
   * list says nothing about whether that dataset exists. A mother that cannot be read
   * keeps that property — the reconcile below declines rather than raising.
   *
   * Every session listed is reconciled with the mother's live garden, because this list
   * is how the client resumes: it takes the most recently changed entry and rolls
   * against the mother as it stands now.
   *
   * THE RECONCILE MUST NOT REORDER THE LIST. A store `save` restamps `mutatum`, which is
   * the key this list is sorted on and the key the client picks its session by, so the
   * merges are applied OLDEST FIRST — the most recently changed session is written last
   * and stays the one a resume lands on. The result is returned in the store's original
   * order regardless.
   */
  async listMuseSessions(auctor: AuctorKey, datasetId: string): Promise<MuseSessionView[]> {
    const owner = this._museSessionOwner(auctor)
    const id = typeof datasetId === 'string' ? datasetId.trim() : ''
    if (!id) throw Errors.inputMalformed('datasetId is required')
    const stored = await this._museSessionsStore().listByOwner(owner, id)
    if (stored.length === 0) return []

    const pooled = await this._motherPool(auctor, id)
    if (!pooled) return stored.map((s) => this._museSessionView(s))

    const reconciled = new Map<string, StoredMuseSession>()
    for (const session of [...stored].reverse()) {
      reconciled.set(session.id, await this._reconciledSession(session, pooled))
    }
    return stored.map((s) => this._museSessionView(reconciled.get(s.id) ?? s))
  }

  /** Take a fragment out of the draw, or put it back. It stays on the floor either way. */
  async setMuseFragmentEnabled(auctor: AuctorKey, id: string, input: unknown, enabled: unknown): Promise<MuseSessionView> {
    const fragment = this._fragmentIdentity(input)
    if (typeof enabled !== 'boolean') throw Errors.inputMalformed('enabled must be a boolean')
    return this._mutateMuseSession(auctor, id, (session) => {
      this._assertHeld(session, fragment)
      return setFragmentEnabled(session, fragment, enabled)
    })
  }

  /** Weight a fragment against its pool-mates. The pure module clamps to the sampler's bounds. */
  async setMuseFragmentWeight(auctor: AuctorKey, id: string, input: unknown, weight: unknown): Promise<MuseSessionView> {
    const fragment = this._fragmentIdentity(input)
    if (typeof weight !== 'number' || !Number.isFinite(weight)) {
      throw Errors.inputMalformed('weight must be a finite number')
    }
    return this._mutateMuseSession(auctor, id, (session) => {
      this._assertHeld(session, fragment)
      return setFragmentWeight(session, fragment, weight)
    })
  }

  /**
   * Replace the run setup of a session the caller owns.
   *
   * The setup is what the session fires its draw THROUGH: the flow, the run shape,
   * the model stack and the standing affix. It is stored so that a reload comes back
   * to the same engine the user assembled rather than to the screen's defaults.
   *
   * NOTHING IS SPENT HERE and nothing is fired. There is no run, no quote and no
   * model call behind this method — it normalizes a body and hands the pure module a
   * new value, exactly as the floor routes do. A restored setup is armed; the launch
   * control is still the only thing that spends.
   *
   * THE OWNER COMES FROM THE RESOLVED CALLER, as it does for every other session
   * method: `_mutateMuseSession` resolves the session for the authenticated identity
   * and reports someone else's as not found. Nothing in the body is a scope value.
   *
   * WHAT THE BODY CANNOT CARRY: the infinite-mode acknowledgement and any view state.
   * `normalizeSetup` reads the fields it defines one at a time, so a body carrying
   * either is stored without it rather than rejected — a reload therefore comes back
   * un-acknowledged whatever was sent.
   */
  async setMuseSetup(auctor: AuctorKey, id: string, input: unknown): Promise<MuseSessionView> {
    if (input !== undefined && input !== null && typeof input !== 'object') {
      throw Errors.inputMalformed('setup must be an object')
    }
    return this._mutateMuseSession(auctor, id, (session) => withSetup(session, input))
  }

  /**
   * Put a fragment the user wrote on the floor of a session they own.
   *
   * This is the un-metered way to widen a floor. A saved piece reweights a floor but
   * never widens it — a piece is assembled from fragments already on it — so short of
   * decomposing more source images, a fragment the user types is the only way a
   * narrow floor gets a phrase it did not already have.
   *
   * NOTHING IS SPENT HERE. There is no model call, no key, no quote and no run behind
   * this method: `manualFragment` builds a value and `addFragment` returns a new
   * session. That is the product decision this route implements, not an incidental
   * property of the implementation.
   *
   * The category is constrained to the taxonomy twice over — `_fragmentIdentity`
   * rejects anything else with a 400, and the pure module refuses to build the
   * fragment at all — because the sampler iterates `CATEGORIES` and a fragment filed
   * outside them would sit in a pool no roll ever reads.
   *
   * Adding a fragment the floor already holds is a no-op that returns the session as
   * it stands, rather than a second copy of one identity: `fragmentKey` is the
   * identity, and two entries under it would double that phrase's odds in every roll.
   */
  async addMuseFragment(auctor: AuctorKey, id: string, input: unknown): Promise<MuseSessionView> {
    const identity = this._fragmentIdentity(input)
    return this._mutateMuseSession(auctor, id, (session) => {
      try {
        return addFragment(session, manualFragment(identity.category, identity.text))
      } catch (err) {
        if (err instanceof UnknownCategoryError) throw Errors.inputMalformed(err.message)
        if (err instanceof EmptyFragmentTextError) throw Errors.inputMalformed(err.message)
        throw err
      }
    })
  }

  /**
   * Keep one rolled prompt against a session the caller owns.
   *
   * KEEPING IS THE EXPLICIT ACT, and it is the only part of rolling that is durable.
   * A roll is free and a roll in progress is uncommitted work, so the report a session
   * is rolling and the edits made to it stay in the client; the moment the user says
   * this one is worth having, that statement gets a server home and survives leaving
   * the screen.
   *
   * NOTHING IS SPENT AND NOTHING IS FIRED. There is no run behind this method — it
   * validates a body and hands the pure module a new value, exactly as the floor and
   * setup routes do. The prompt is kept, not launched.
   *
   * The body is validated to `recordMusePiece`'s strictness rather than normalized
   * quietly: a request with no prompt, or with a verdict that is not a boolean, is a
   * malformed request and is answered as one.
   *
   * Owner scoping is `_mutateMuseSession`'s, as for every other write here — nothing
   * in the body is a scope value, and a stranger's session is reported as not found.
   */
  async keepMuseRoll(auctor: AuctorKey, id: string, input: unknown): Promise<MuseSessionView> {
    this._requireAccount(auctor)
    const body = (input ?? {}) as { prompt?: unknown; paid?: unknown }
    const prompt = typeof body.prompt === 'string' ? body.prompt.trim() : ''
    if (!prompt) throw Errors.inputMalformed('prompt is required')
    if (typeof body.paid !== 'boolean') throw Errors.inputMalformed('paid must be a boolean')
    return this._mutateMuseSession(auctor, id, (session) => keepRoll(session, { prompt, paid: body.paid }))
  }

  /**
   * Append a piece to the session's ledger with the lineage that produced it.
   *
   * The lineage is required and is checked against the floor by the pure module:
   * a piece citing a fragment this session does not hold is rejected rather than
   * stored, because its lineage could never be resolved afterwards.
   */
  async recordMusePiece(auctor: AuctorKey, id: string, input: unknown): Promise<MuseSessionView> {
    this._requireAccount(auctor)
    const body = (input ?? {}) as {
      runId?: unknown
      rollIndex?: unknown
      fragments?: unknown
      reaction?: unknown
      saved?: unknown
      dismissed?: unknown
    }

    const runId = typeof body.runId === 'string' ? body.runId.trim() : ''
    if (!runId) throw Errors.inputMalformed('runId is required')
    if (typeof body.rollIndex !== 'number' || !Number.isInteger(body.rollIndex) || body.rollIndex < 0) {
      throw Errors.inputMalformed('rollIndex must be a non-negative integer')
    }
    if (!Array.isArray(body.fragments) || body.fragments.length === 0) {
      throw Errors.inputMalformed('fragments is required and must name the lineage of this piece')
    }
    if (body.reaction !== undefined && body.reaction !== 'up' && body.reaction !== 'down' && body.reaction !== 'note') {
      throw Errors.inputMalformed("reaction must be one of 'up' | 'down' | 'note'")
    }
    if (body.saved !== undefined && typeof body.saved !== 'boolean') throw Errors.inputMalformed('saved must be a boolean')
    if (body.dismissed !== undefined && typeof body.dismissed !== 'boolean') throw Errors.inputMalformed('dismissed must be a boolean')

    const cited = body.fragments.map((f) => this._fragmentIdentity(f))

    return this._mutateMuseSession(auctor, id, (session) => {
      // Resolve each citation to the session's OWN copy of the fragment, so the
      // stored lineage carries the source/trigger the session holds rather than
      // whatever a caller attached to the citation.
      const held = cited.map((f) => this._heldFragment(session, f))
      try {
        return recordPiece(session, {
          runId,
          rollIndex: body.rollIndex as number,
          fragments: held,
          ...(body.reaction !== undefined ? { reaction: body.reaction as Reaction } : {}),
          ...(body.saved !== undefined ? { saved: body.saved as boolean } : {}),
          ...(body.dismissed !== undefined ? { dismissed: body.dismissed as boolean } : {}),
        })
      } catch (err) {
        if (err instanceof UnknownFragmentError) throw Errors.inputMalformed(err.message)
        if (err instanceof DuplicatePieceError) throw Errors.inputMalformed(err.message)
        throw err
      }
    })
  }

  /**
   * Change what a session says about a piece already in its ledger.
   *
   * A reaction and a dismissal are both said about a piece that already exists —
   * the roll is recorded when it lands and the user responds to it afterwards —
   * so neither can ride the record call. This is the only way to reach a recorded
   * piece again, and it reaches exactly two fields: the lineage, the run and the
   * roll index describe what produced the piece and are fixed at record time.
   *
   * Owner scoping and the single mutation path are the same as every other write
   * here: the session is resolved against the authenticated caller, and the
   * change itself is made by the pure module. A run this session's ledger does
   * not hold is reported as not found rather than recorded.
   */
  async updateMusePiece(auctor: AuctorKey, id: string, runId: string, input: unknown): Promise<MuseSessionView> {
    this._requireAccount(auctor)
    const body = (input ?? {}) as { reaction?: unknown; dismissed?: unknown }
    const run = typeof runId === 'string' ? runId.trim() : ''
    if (!run) throw Errors.inputMalformed('runId is required')

    if (body.reaction !== undefined && body.reaction !== 'up' && body.reaction !== 'down' && body.reaction !== 'note') {
      throw Errors.inputMalformed("reaction must be one of 'up' | 'down' | 'note'")
    }
    if (body.dismissed !== undefined && typeof body.dismissed !== 'boolean') {
      throw Errors.inputMalformed('dismissed must be a boolean')
    }
    if (body.reaction === undefined && body.dismissed === undefined) {
      throw Errors.inputMalformed('reaction or dismissed is required')
    }

    const patch: PiecePatch = {
      ...(body.reaction !== undefined ? { reaction: body.reaction as Reaction } : {}),
      ...(body.dismissed !== undefined ? { dismissed: body.dismissed as boolean } : {}),
    }

    return this._mutateMuseSession(auctor, id, (session) => {
      try {
        return updatePiece(session, run, patch)
      } catch (err) {
        if (err instanceof UnknownPieceError) {
          throw new ApiError('not_found.muse_piece', `Muse piece for run '${run}' not found`, 404)
        }
        throw err
      }
    })
  }

  /**
   * The name a session's own dataset takes.
   *
   * SCHEME: the mother's name, a separator, and the session's id shortened to eight
   * characters — `<mother name> · muse <session-id-prefix>`. Derived rather than asked
   * for: a save is one tap, and a naming dialogue is a different interaction. The
   * mother's name is what makes the record recognisable in a dataset list; the session
   * prefix is what keeps two sessions off one mother apart.
   */
  protected _sessionDatasetName(motherName: string, sessionId: string): string {
    return `${motherName} · muse ${sessionId.slice(0, 8)}`
  }

  /**
   * Put a piece back into the set: its media joins the session's OWN dataset, carrying
   * the lineage that produced it as that media item's fragments.
   *
   * NO JOB RUNS AND NOTHING IS SPENT. A generated piece does not need decomposing,
   * because it was composed FROM fragments — the lineage the ledger recorded at fire
   * time IS the tagging, so a save is a set insertion and not a caption or decompose
   * pass. That is the product decision this method implements, not an incidental
   * property: nothing here reaches a model, a pod, or a quote.
   *
   * THE MOTHER DATASET IS NEVER WRITTEN (S7, S13). The session is a version of the
   * mother, and a save lands on the version. The session's dataset is minted LAZILY, by
   * the first save — a session that never saves leaves no empty record behind — and the
   * session carries its id from then on, so every later save appends to the same record
   * through `addDatasetMedia` rather than minting a second one.
   *
   * THE URL IS RESOLVED SERVER-SIDE, never supplied by the caller. The piece names the
   * run that produced it, and the media is minted from that Actum through `_mintMedia`,
   * the same path dataset creation uses — which is where the Actum is checked to be the
   * caller's own and `completus`. Nothing from a request body lands on an owner-scoped
   * record.
   *
   * A SAVE REWEIGHTS THE FLOOR AND NEVER WIDENS IT. The lineage is written onto the new
   * media item, and the session's own fragment list is untouched: a piece is assembled
   * from fragments already on the floor, so re-entry makes the lane heavier, never
   * wider. Widening is the manual add, or a fresh decompose.
   *
   * The media lands BEFORE the ledger entry is flagged, so a failure never leaves a
   * session claiming a save that did not happen.
   */
  async saveMusePiece(auctor: AuctorKey, id: string, runId: string): Promise<MuseSessionView> {
    this._requireAccount(auctor)
    const run = typeof runId === 'string' ? runId.trim() : ''
    if (!run) throw Errors.inputMalformed('runId is required')

    const stored = await this._museSession(auctor, id)
    const piece = stored.session.pieces.find((p) => p.runId === run)
    if (!piece) throw new ApiError('not_found.muse_piece', `Muse piece for run '${run}' not found`, 404)

    const ingest: IngestMediaInput = { source: 'generation', actumIds: [piece.runId] }
    const existingId = stored.session.sessionDatasetId

    let before: DatasetMediaItem[] = []
    let target: Dataset
    if (existingId) {
      before = (await this.getDataset(auctor, existingId)).media
      target = await this.addDatasetMedia(auctor, existingId, ingest)
    } else {
      const mother = await this.getDataset(auctor, stored.session.motherDatasetId)
      target = await this.createDataset(auctor, {
        ...ingest,
        name: this._sessionDatasetName(mother.name, stored.id),
        modality: mother.modality,
        custody: mother.custody,
      })
    }

    // The lineage rides the media, item by item. `setFragments` writes one item at a
    // time and is keyed by media id rather than by position, because `media` is
    // append-only and a positional write re-binds as soon as anything else lands.
    const known = new Set(before.map((m) => m.id))
    const lineage = piece.fragments.map((f) => ({ ...f }))
    for (const item of target.media) {
      if (known.has(item.id)) continue
      await this._datasetsStore().setFragments(target.id, item.id, lineage)
    }

    return this._mutateMuseSession(auctor, id, (session) => {
      try {
        return updatePiece(withSessionDataset(session, target.id), run, { saved: true })
      } catch (err) {
        if (err instanceof UnknownPieceError) {
          throw new ApiError('not_found.muse_piece', `Muse piece for run '${run}' not found`, 404)
        }
        throw err
      }
    })
  }

  /**
   * Promote a session into a DRAFT collection: the garden the user played their way
   * into becomes the grid a durable collection expands.
   *
   * A session already IS a collection, worked transiently — a floor of decomposed
   * fragments, a nozzle, a standing affix and a flow. Promotion carries that across
   * whole (`musePromote.ts` holds the mapping, pure and asserted field by field) so the
   * work of curating the floor is not repeated in a second authoring surface.
   *
   * IT PRODUCES A DRAFT, WHICH IS THE WHOLE OF WHY IT NEEDS NO NEW FORM. A draft may
   * name no supply, no review policy and no DNA rule; those are finished in the
   * collection funnel the draft lands in, and `fireCollection` is where completeness is
   * enforced. NOTHING IS SPENT HERE: a draft is not dispatched, and firing it later goes
   * through the gates it already went through.
   *
   * THE SESSION IS NEVER MUTATED. Promotion reads it — the floor, the setup and nothing
   * else — so a session can be promoted more than once and still be the session it was.
   *
   * EVERY REFERENCE IS RESOLVED SERVER-SIDE. `_museSession` resolves the session for the
   * authenticated caller and reports a stranger's as not found; the flow, the grid and
   * the standing prompt come off that session; and `by` (with any team overlay) is
   * `collect`'s own resolution from the same caller. The body reaches exactly one field,
   * `nomen`, which is a label. There is no scope value a caller could send.
   */
  async promoteMuseSession(auctor: AuctorKey, id: string, input?: unknown): Promise<Collection> {
    this._requireAccount(auctor)
    const body = (input ?? {}) as { nomen?: unknown }
    const asked = typeof body.nomen === 'string' ? body.nomen.trim() : ''

    const stored = await this._museSession(auctor, id)
    // The mother is read with the caller's own ownership, the way a save reads it: it is
    // where a derived name comes from, and a mother the caller cannot read is the same
    // 404 there as here.
    const mother = await this.getDataset(auctor, stored.session.motherDatasetId)
    const promotion = promotionFrom(stored.session, {
      sessionId: stored.id,
      nomen: asked || this._sessionDatasetName(mother.name, stored.id),
    })

    // Named field by field rather than spread: a promotion carries a name, a note, a
    // flow, a supply and a grid, and nothing that arrives alongside them can become a
    // `teamId`, an `owners` split or a `by`.
    return this.collect(auctor, {
      draft: true,
      nomen: promotion.nomen,
      descriptio: promotion.descriptio,
      ...(promotion.modusId !== undefined ? { modusId: promotion.modusId } : {}),
      ...(promotion.total !== undefined ? { total: promotion.total } : {}),
      tractus: promotion.tractus,
      aditusBase: promotion.aditusBase,
    })
  }

  /**
   * Interpret a short instruction against a session's floor and return a PROPOSAL.
   *
   * NOTHING IS APPLIED HERE, and that is the property this method exists to hold.
   * A steer proposes: the eliminations and additions it returns are pills the user
   * accepts or vetoes, and the floor moves only when they confirm and the app calls
   * the floor routes that already exist (`PATCH …/floor/enabled`,
   * `POST …/floor/fragments`). This method performs NO SESSION WRITE — it reads the
   * session, runs the interpreter, and returns. An interpreter that could write
   * would make the consent sheet a formality, and the failure would be silent: the
   * pills would render and the floor would already have moved.
   *
   * THE FLOOR IS PASSED INLINE AND THE CURSOR NEVER RECEIVES THE SESSION ID. That
   * is deliberate rather than incidental. An `Actum` carries no `animaId` —
   * ownership travels identity-blind through `nullifier` → `signum` — so a cursor
   * cannot resolve an owner, and a cursor that took a resource id out of its aditus
   * and read it would be unscoped by construction. For a read-only steer that would
   * put a stranger's floor, which is their private prompt material, into a proposal
   * returned to the caller. Ownership is resolved HERE, from the authenticated
   * caller, exactly as it is for every other method on this surface, and what
   * travels onward is a value rather than a reference.
   *
   * Only the fragments currently IN THE DRAW are steered: a darkened fragment is
   * already out, so a pill offering to eliminate it would change nothing.
   *
   * THE PROPOSAL IS NOT PERSISTED, and that is a decision rather than an oversight.
   * It lives for the length of the sheet — the floor is the durable object and the
   * confirm is the cut line, so a proposal that dies with the page is behaving
   * correctly.
   *
   * It is a normal metered run: one chat call, reserved before it is made and
   * settled at its real token cost.
   */
  async steerMuseSession(auctor: AuctorKey, id: string, input: unknown): Promise<SteerProposalView> {
    this._requireAccount(auctor)
    const body = (input ?? {}) as { instruction?: unknown }
    const instruction = typeof body.instruction === 'string' ? body.instruction.trim() : ''
    if (!instruction) throw Errors.inputMalformed('instruction is required')
    // The instruction is LIMITED, and the limit is the server's. The bound is
    // enforced again in the cursor's `reserve()`, before anything is spent; this is
    // the same bound reported as a 400 rather than as a failed run.
    if (instruction.length > MAX_INSTRUCTION_CHARS) {
      throw Errors.inputMalformed(`instruction must be at most ${MAX_INSTRUCTION_CHARS} characters`)
    }

    const stored = await this._museSession(auctor, id)
    const floor = enabledFragments(stored.session).map((f) => ({ category: f.category, text: f.text }))
    if (floor.length === 0) throw Errors.inputMalformed('this session has no fragments in the draw to steer')

    const run = await this.invokeFlow(auctor, { modusId: MODUS_MUSE_STEER.id }, { instruction, floor })
    const proposal = run.exitus?.proposal as SteerProposal | undefined
    // A sync cursor either throws or returns a proposal, so this is a guard rather
    // than a path: a run that reached here with no proposal produced nothing usable.
    if (!proposal) throw Errors.internal(run.failure?.message ?? 'the steer produced no proposal')
    return { proposal }
  }

  /** The session's own copy of a cited fragment, or 400 when the floor does not hold it. */
  protected _heldFragment(session: MuseSession, identity: FragmentIdentity): Fragment {
    const key = fragmentKey(identity)
    const held = session.fragments.find((f) => fragmentKey(f) === key)
    if (!held) throw Errors.inputMalformed(`this session does not hold the fragment '${key}'`)
    return held
  }

  /** Guard a floor operation: an identity the session does not hold is a 400, not a silent no-op. */
  protected _assertHeld(session: MuseSession, identity: FragmentIdentity): void {
    this._heldFragment(session, identity)
  }
}
