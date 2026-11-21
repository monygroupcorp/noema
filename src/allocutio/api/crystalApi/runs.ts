import { InsufficientFundsError } from '../../../execution/ActumInceptor.js'
import { InsufficientBursaCreditsError } from '../../../types/bursa.js'
import { DecomposeInFlightError, DecomposeNothingToDoError } from '../../../crystal/MuseDecomposeCursor.js'
import type { ActumIndex } from '../../../types/actumIndex.js'
import type { Generatio } from '../../../types/consuetudo.js'
import type { AuctorKey } from '../../../flow/types.js'
import type { Actum, ModelRef } from '../../../types/actum.js'
import type { Inceptio } from '../../../types/cursus.js'
import type { Mandatum } from '../../../types/mandatum.js'
import { deriveSavedModus } from '../../../crystal/deriveSavedModus.js'
import { dispatchInceptio } from '../../../execution/dispatchInceptio.js'
import { toRunDetail, toRunOrder, toSettledRun, toEarning } from '../runProjection.js'
import { HOURLY_CRON, ORDER_MAX_RUNS, ORDER_WINDOW_MS, TRAINING_MODUS_ID } from '../../../crystal/MandatumRunner.js'
import { describeFlow, type FlowDescription, type DescribableModus } from '../aditusToJsonSchema.js'
import { Errors, ApiError } from '../errors.js'
import { CANON_VERBS } from '../../../crystal/canonVerbs.js'
import { resolveCanonVerb } from '../../../crystal/verbResolver.js'
import { resolvePinnedModel, type PinnedInput } from '../../../crystal/pinnedModelResolver.js'
import { computeRecipient } from '../../../arcanum/prover.js'
import { IMPETUS_USD_RATE } from '../../../ledger/rates.js'
import { earningKind, EARNING_KIND_ORDER, type EarningKind } from '../../../ledger/earnings.js'
import type {
  Run, RunOrder, RunsPage, ActivityRow, ActivityPage, EarningsView, EarningStream,
} from '../types.js'
import { findConstraintViolation } from '../../../execution/portaConstraints.js'
import { MODUS_EMBED_SWEEP } from '../../../crystal/seeds/modi.js'
import { MAX_SWEEP_ITEMS, parseSweepDimension, sweepOwnerToken, type SweepOwner } from '../../../crystal/EmbedSweepCursor.js'
import type { PromptVerdict } from '../../../crystal/PromptGuard.js'
import { spicyModelFor } from '../../../crystal/spicyRouting.js'
import { ownerKeyOf } from '../../../crystal/ownerKey.js'
import { requiredUseTerms } from '../../../crystal/useTerms.js'
import type {
  ListRunsOpts, ListEarningsOpts, ListActivityOpts, InvokeTarget, InvokeOpts, FlowSummary,
  SaveFlowOpts,
} from '../CrystalApi.js'
import { activityKindFor, activityDoorFor, log, applyAccountDefaults, slugify } from './support.js'
import { CrystalApiCore } from './core.js'

/** Invoking flows and reading back what ran: runs, orders, activity, earnings, flow listings and quotes. */
export abstract class CrystalApiRuns extends CrystalApiCore {
  /**
   * Invoke a flow for an auctor and return its public Run projection.
   *
   * Target resolution: an explicit `modusId` wins; otherwise the `verb` is
   * resolved through the owner's Consuetudinum rebinds, falling back to the
   * platform CANON_VERBS table. Nothing resolved → `not_found.flow`.
   */
  /**
   * Normalize pinned-model tokens (id | slug | trigger, or already-shaped `ModelRef`s) into
   * canonical `ModelRef`s the Compiler can resolve, enforcing access. The single chokepoint for
   * BOTH the run path (`invokeFlow`, below) and the concierge's pre-GO resolvability check
   * (ConciergeAgent) — "the concierge never offers GO on a config that can't compile". An
   * unresolvable token → `Errors.modelNotResolved` (422, not a 500); a private model the caller
   * doesn't own → `Errors.modelForbidden` (403). (noema-113)
   */
  async resolvePinnedModels(auctor: AuctorKey, pinned: readonly PinnedInput[]): Promise<ModelRef[]> {
    if (pinned.length === 0) return []
    const store = this.deps.intellarum
    if (!store) {
      // No registry wired (minimal deployment / dev double): can only accept already-shaped refs;
      // a bare string can't be resolved here (and must not reach the Compiler as `{id: undefined}`).
      return pinned.map((p) => {
        if (typeof p !== 'string' && p && p.id) return p
        throw Errors.modelNotResolved(typeof p === 'string' ? p : String((p as ModelRef)?.id))
      })
    }
    const ownerKey = ownerKeyOf(auctor)
    const out: ModelRef[] = []
    for (const input of pinned) {
      const res = await resolvePinnedModel(store, input, ownerKey)
      if (!res.ok) {
        throw res.reason === 'forbidden' ? Errors.modelForbidden(res.token) : Errors.modelNotResolved(res.token)
      }
      out.push(res.ref)
    }
    return out
  }

  async invokeFlow(
    auctor: AuctorKey,
    target: InvokeTarget,
    aditus: Record<string, unknown>,
    opts: InvokeOpts = {},
  ): Promise<Run> {
    const { inceptor, modorum, cursorum, completor, actumIndex, consuetudinum, compositusCursor, vocator } = this.deps

    // Dispute freeze (noema-082, Q3): an anima frozen by a chargeback (`charge.dispute.created`)
    // cannot initiate a generation SPEND (value outflow) while the dispute is held for review. This
    // is the run-spend chokepoint (the peer chokepoint is owned-purse mint in purseRouter). LOGIN and
    // value-inflow are untouched; only identified callers carry the flag (anon/bursa paths are freeze
    // -blind, and `reserve` stays freeze-blind by design so system paths are unaffected).
    await this._assertNotDisputeFrozen(auctor)

    let modusId: string | undefined
    if (target.modusId) {
      modusId = target.modusId
    } else if (target.verb) {
      modusId = (await consuetudinum?.resolve(auctor, target.verb)) ?? CANON_VERBS[target.verb]
    }
    if (!modusId) throw Errors.notFoundFlow(target.verb ?? '?')

    // Read the definition once: the account-defaults pass needs its ports, and so does the
    // owned-resource check below (which needs to know which of them name a stored record).
    const resolvedModus = await modorum.find(modusId)

    // Upstream licence terms (`Modus.useTerms`). MiniMax H3's licence requires every user to be
    // bound to its use restrictions before access, and repeat violators to be suspended, so a
    // flow that declares terms runs only for a caller who has accepted their current version
    // and is not suspended under them. Refused HERE, before any input handling and above the
    // `Inceptio` literal, so a refusal reserves no signa and provisions no pod. FAIL-CLOSED: with
    // no settings store there is no acceptance on file, so the flow does not run.
    await this._assertUseTerms(auctor, resolvedModus)

    // Undeclared inputs are refused AT THIS BOUNDARY (noema-314). A submitted aditus key the
    // resolved modus does not declare is not carried into the run: the port never reaches a
    // cursor, so a misspelled or invented key would otherwise be accepted, dropped, and billed
    // as a run that did different work than the caller asked for. Refused HERE — above the
    // `Inceptio` literal and therefore above `dispatchInceptio` — so a refusal reserves no
    // signa and creates no actum.
    //
    // Scoped to the SUBMITTED aditus (account defaults only fill declared ports, so they can
    // never introduce one), and to this entry point only: `validateAditus` keeps its tolerant
    // strip semantics at every internal call site, where single ports are validated during
    // draft edits and a blanket throw is the wrong shape.
    //
    // A definition that does not resolve here (or carries no `aditus`) is left to the dispatch
    // path's own handling rather than refused on an absent declaration.
    //
    // Underscore-prefixed keys are the internal channels that ride an aditus (`_attributes`,
    // `_dna`, `_pieceIndex`, `__capability`, …) rather than ports a modus declares. They are
    // already excluded from the schema surface (`aditusToJsonSchema`) and from the owned-
    // reference check (`ownedResources`), and they keep passing through here on the same terms.
    if (resolvedModus?.aditus) {
      const declared = resolvedModus.aditus
      const undeclared = Object.keys(aditus).find(
        (key) => !key.startsWith('_') && !Object.prototype.hasOwnProperty.call(declared, key),
      )
      // Names the first offending key and nothing else — not its value, and not the set of
      // ports the flow does declare (the flow's schema is a separate, deliberate read).
      if (undeclared !== undefined) throw Errors.invalidAditus({ undeclared })
    }

    // Account-level defaults (Consuetudinum), applied UNDER the cast-time aditus:
    //   cast-time input > affines (per-modus) > generatio (cross-cutting) > modus defaults.
    // Only DECLARED ports are filled, so a stale default can never inject an unknown input.
    let effectiveAditus = aditus
    let generatio: Generatio | undefined
    if (consuetudinum) {
      const [affines, resolvedGeneratio] = await Promise.all([
        consuetudinum.resolveAffines(auctor, modusId),
        consuetudinum.resolveGeneratio(auctor),
      ])
      generatio = resolvedGeneratio
      if (affines || generatio) {
        const ports = resolvedModus?.aditus ?? {}
        effectiveAditus = applyAccountDefaults(ports, aditus, affines, generatio)
      }
    }

    // A value that violates the legality its port DECLARES is refused here (noema-396). A port may
    // state `min`/`max`/`step` on an 'int' or 'float' (`Porta`); MiniMax H3's clip length is
    // `{min: 5, step: 17}` because the model accepts 17k+5 frames and nothing else. Before this,
    // `frames: 100` provisioned a pod, pulled 56 GB of weights over ~12 minutes and failed at
    // execution — ~28 minutes and real GPU spend to reject an input that was illegal before the
    // run started. Refused HERE, above the `Inceptio` literal and therefore above
    // `dispatchInceptio`, so a refusal reserves no signa, creates no actum and provisions no pod.
    //
    // NOT the Compiler's job: it already carries too much flow-specific knowledge, and by the time
    // it runs the caller is committed. NOT `validateAditus`'s either — that keeps its tolerant
    // coercion semantics at every internal call site, where single ports are validated mid-draft
    // and a blanket throw is the wrong shape. This is the same boundary, and the same "costs
    // nothing" guarantee, as the undeclared-key refusal above and the owned-resource check below.
    //
    // Runs on the EFFECTIVE aditus so an account default that fills a constrained port is checked
    // exactly like a cast-time one. A port declaring no constraint is untouched, which is why this
    // is a strict no-op for every flow but the three that declare one.
    if (resolvedModus?.aditus) {
      const violation = findConstraintViolation(resolvedModus.aditus, effectiveAditus)
      if (violation) throw Errors.aditusOutOfRange(violation.porta, violation.regula, violation.value)
    }

    // ── Lever (b): spicy alt-model routing (noema-091) ──────────────────────────
    // When spicyMode is ON and the resolved modus has a mapped willing/uncensored OpenRouter model,
    // repoint `aditus.model` BEFORE it reaches ApiCursor's `aditus.model ?? spec.defaultModel` seam.
    // SHIPPED with an EMPTY map (`crystal/spicyRouting`): no modus resolves to an override, so this is
    // a strict no-op until the operator populates it. Keyed on modusId AND gated on `spicyMode === true`
    // (which itself required a recorded 18+ attestation to persist). This NEVER touches the moderation
    // path: the PromptGuard below runs on the effective aditus UNCONDITIONALLY, spicy or not.
    if (generatio?.spicyMode === true) {
      const spicyModel = spicyModelFor(modusId)
      if (spicyModel !== undefined) effectiveAditus = { ...effectiveAditus, model: spicyModel }
    }

    // Input CSAM guard — refuse a prompt that solicits CSAM before we spend anything.
    // Runs on the EFFECTIVE aditus (post account-defaults, incl. affixes) so an injected
    // default can't smuggle content past it. FAIL-OPEN: a guard implementation error must
    // not break generation (the publish-time ModerationGate is the fail-closed backstop),
    // so only an explicit `ok:false` refuses; a throw inside the guard is swallowed.
    let promptVerdict: PromptVerdict = { ok: true }
    try {
      promptVerdict = await this._promptGuard().check(effectiveAditus)
    } catch { /* fail-open: guard error → allow */ }
    if (!promptVerdict.ok) throw Errors.contentRefused(promptVerdict.reason)

    // Admission spend cap — refuse before dispatch if the upper-bound estimate exceeds the
    // effective cap. Estimate the EFFECTIVE aditus (post account-defaults) — the same inputs
    // that will run — so an affine bumping a cost driver (steps/count/resolution) is capped.
    //
    // Two independent ceilings can apply and the TIGHTER of them always wins:
    //   • `opts.maxImpetus`          — what this REQUEST asked to be capped at.
    //   • `opts.keyMaxImpetusPerRun` — what the CREDENTIAL is capped at (a partner API key).
    // Taking the minimum is what makes the credential's ceiling unbypassable: `min` can only
    // ever tighten, so a caller sending a larger `maxImpetus` cannot lift the key's limit, and
    // a caller sending a smaller one still gets the smaller one. With no credential ceiling
    // the minimum IS the caller's cap and this is the check it has always been.
    // The embed sweep's work is resolved HERE, from the caller, and stamped onto the aditus
    // (see `_stampEmbedSweep`). It happens above the admission cap because the reservation IS
    // a function of the batch — a cap measured against an unstamped aditus would be measured
    // against no work at all — and above the `Inceptio` literal, so a refusal (a sweep with
    // nothing to do, a bearer credential that names no trail) reserves no signa and creates
    // no actum.
    if (modusId === MODUS_EMBED_SWEEP.id) {
      effectiveAditus = await this._stampEmbedSweep(opts.by ?? auctor, effectiveAditus)
    }

    const callerCap = opts.maxImpetus !== undefined ? BigInt(opts.maxImpetus) : undefined
    const keyCap = opts.keyMaxImpetusPerRun
    const cap =
      callerCap === undefined ? keyCap
      : keyCap === undefined ? callerCap
      : keyCap < callerCap ? keyCap
      : callerCap
    // The effective cap as a stored/reported string. A caller-supplied cap that is the binding
    // one is echoed exactly as the caller wrote it, so neither the error body nor the standing
    // order below shifts for any caller whose credential carries no ceiling.
    const capAsWritten =
      cap === undefined ? undefined
      : cap === callerCap && opts.maxImpetus !== undefined ? String(opts.maxImpetus)
      : cap.toString()
    if (cap !== undefined) {
      const est = await this._estimate(modusId, effectiveAditus)
      if (est > cap) {
        throw Errors.capTooLow({ estimated: est.toString(), maxImpetus: capAsWritten })
      }
    }

    // Normalize pinned models (noema-113): the concierge proposes bare id|slug|trigger strings; the
    // run path threads them as typed `ModelRef[]` straight into the Compiler, which resolves by `id`.
    // Coerce each to a canonical `ModelRef{id}` HERE — the single run chokepoint every caller passes
    // through — so an unregistered/forbidden pin fails fast with a clear non-500 error instead of the
    // Compiler's misleading `No URL for model 'undefined'` on a paid dispatch.
    const pinnedModels = opts.pinnedModels?.length
      ? await this.resolvePinnedModels(auctor, opts.pinnedModels)
      : undefined

    // Studio scope comes from the CALLER, not from the request body. A run may bind to a Modo
    // session only when the resolved caller is that session's host, so a caller-supplied
    // `studioId` cannot charge a run against another tenant's session budget (which would push
    // that tenant's studio toward drain and reaping). Refused HERE — above the `Inceptio` literal
    // and therefore above `dispatchInceptio` — so a refusal reserves no signa and creates no actum.
    if (opts.studioId) await this._ownedStudio(auctor, opts.studioId)

    // Resource scope comes from the CALLER too. A modus declares which of its aditus ports name
    // a stored, owner-bearing record (`Porta.owned`), and every declared reference is resolved
    // here against the calling anima before the run exists. A cursor cannot make this check for
    // itself — an Actum is identity-blind, so by dispatch there is no caller left to scope the
    // read against. Refused HERE, above the `Inceptio` literal and therefore above
    // `dispatchInceptio`, so a refusal reserves no signa, creates no actum, provisions no pod
    // and resolves no manifest. Runs on the EFFECTIVE aditus so an account default that fills a
    // reference port is checked exactly like a cast-time one.
    await this._assertOwnedAditus(auctor, resolvedModus, effectiveAditus)

    // A training run mints a private model, and that model needs a durable owner — the
    // resolved caller, never a value read off the request body. Stamped HERE, before the
    // aditus becomes the actum's and before the standing order opens on it (`_openTrainingOrder`
    // snapshots the aditus verbatim), so every later hourly retry carries the same owner as
    // the original click. An anima caller's identity always wins over anything the client
    // set on the port; a bursa-bearer invoke names no durable owner, so the port is cleared
    // rather than trusted, and the run stays honestly ownerless.
    const runner = opts.by ?? auctor
    if (modusId === TRAINING_MODUS_ID) {
      const { ownerAnimaId: _drop, ...rest } = effectiveAditus
      effectiveAditus = 'animaId' in runner ? { ...rest, ownerAnimaId: runner.animaId } : rest
    }

    const inceptio: Inceptio = {
      modusId,
      aditus: effectiveAditus,
      by: runner,
      ...(opts.studioId ? { modoId: opts.studioId } : {}),
      ...(pinnedModels?.length ? { pinnedModels } : {}),
      ...(opts.computeStrategy ? { computeStrategy: opts.computeStrategy } : {}),
      ...(opts.gpuClass ? { gpuClass: opts.gpuClass } : {}),
    }

    // A payer who cannot cover the reservation is a request outcome, not a server
    // fault: translate the core's typed shortfall errors into the existing
    // `402 economy.insufficient_signa` here, at the API boundary (the core carries no
    // API error vocabulary). NOT retryable — the call cannot succeed until the balance
    // changes, so advertising a retry would send clients into a loop that never clears.
    //
    // Two typed errors reach this seam, one per denomination: `InsufficientFundsError`
    // carries impetus points (the identified signum balance and the arcanum note valor
    // alike), `InsufficientBursaCreditsError` carries purse credits. They stay distinct
    // classes so the units are never compared; both render into the same `details`
    // strings, which are per-request figures in whatever unit the caller paid in.
    //
    // The mapping is deliberately narrow: every other error keeps the handling it had —
    // a bursa failure that is not a shortfall (e.g. an unknown token) is untouched here.
    let actum: Actum
    try {
      ({ actum } = await dispatchInceptio(
        { inceptor, modorum, cursorum, completor, actumIndex, compositusCursor, ...(vocator ? { queue: vocator } : {}) },
        inceptio,
      ))
    } catch (err) {
      if (err instanceof InsufficientFundsError) {
        throw Errors.insufficientSigna({
          available: err.balance.toString(),
          required: err.required.toString(),
        })
      }
      if (err instanceof InsufficientBursaCreditsError) {
        throw Errors.insufficientSigna({
          available: err.credits.toString(),
          required: err.required.toString(),
        })
      }
      // A cursor refusing a duplicate of work it is already running is the same kind of
      // seam: a request outcome the caller can act on ("wait for the one you started"),
      // not a server fault. Mapped here so it reaches the caller as a 409 with its code
      // instead of the wrapper's masked `internal.error`, which reads as a bug and
      // invites the retry that started the duplicate in the first place.
      if (err instanceof DecomposeInFlightError) {
        throw Errors.conflictRunInFlight(err.message, { dataset: err.datasetId })
      }
      // The same seam, for the refusal that says there is no work: every captioned item
      // already carries fragments and the caller did not ask for a re-decompose. A request
      // outcome about the caller's own dataset — 409 rather than a masked `internal.error`,
      // and NOT retryable, because the request cannot succeed until the dataset changes or
      // the caller asks for a redo.
      if (err instanceof DecomposeNothingToDoError) {
        throw new ApiError('conflict.nothing_to_decompose', err.message, 409, {
          retryable: false,
          details: { dataset: err.datasetId, captionset: err.captionsetId },
        })
      }
      throw err
    }

    // A training launch is a standing order, not a coin flip: the click says "I want this
    // trained", so it opens an order that outlives the one attempt. Opening it HERE is what
    // makes that possible — the payer key and the dispatch terms are known at the click and
    // nowhere downstream (an Actum deliberately carries no identity, and no cap). The order
    // opens holding this attempt, and the runner decides from that attempt's OUTCOME whether
    // asking again is warranted, so nothing is ever re-run on a click alone.
    const mandatum = await this._openTrainingOrder(modusId, effectiveAditus, inceptio.by, actum.id, opts, capAsWritten)

    const run = toRunDetail(actum)
    if (mandatum) run.order = toRunOrder(mandatum)
    // A run that found no warm pod is queued, not refused, and the caller is told where it
    // stands in the SAME response that hands them the run id — so "queued" is something the
    // client reads off a field rather than infers from a `pending` that never moves.
    await this._attachQueuePlace(run, actum)
    return run
  }

  /**
   * Resolve the embed sweep's work from the CALLER and stamp it onto the aditus.
   *
   * This is where stranger isolation is enforced for the sweep, and it is enforced by
   * CONSTRUCTION rather than by a check: whatever `_owner` and `_sweep` the request body
   * carried are dropped, and the ones that reach the cursor are read here from the resolved
   * caller's own backlog. There is no request field that widens the set, so there is nothing
   * for a caller to forge — the same reason the training modus stamps its own `ownerAnimaId`.
   *
   * The work travels as VALUES because an Actum carries no identity: by dispatch there is no
   * caller left to scope a store read against, so a cursor handed ids would be unscoped by
   * construction. (The writeback is scoped a second time at the store — `setEmbedding` matches
   * on the owner — so a foreign id could not be written even if one ever reached the cursor.)
   *
   * Refuses, before anything is reserved:
   *   • a bearer (`bursaToken`) credential — a purse names no trail to sweep;
   *   • a deployment with no trace store — there is no backlog to read;
   *   • a caller whose backlog for that dimension is empty — a run that would embed nothing.
   */
  protected async _stampEmbedSweep(
    by: Inceptio['by'],
    aditus: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    // Whatever the body sent under these names is dropped here, unread.
    const { _owner: _dropOwner, _sweep: _dropSweep, ...rest } = aditus

    const owner: SweepOwner | undefined =
      'animaId' in by ? { animaId: by.animaId }
      : 'commitment' in by ? { commitment: by.commitment }
      : undefined
    if (!owner) {
      throw Errors.authForbidden('A purse token names no trail — the embed sweep runs for an identified or committed caller')
    }

    const store = this.deps.vestigiorum
    if (!store) {
      throw new ApiError('internal.unavailable', 'Trace search is not available on this deployment', 503, { retryable: false })
    }

    const per = parseSweepDimension(rest.per)
    const asked = Number(rest.limit ?? MAX_SWEEP_ITEMS)
    const limit = Number.isFinite(asked) && asked > 0 ? Math.min(Math.floor(asked), MAX_SWEEP_ITEMS) : MAX_SWEEP_ITEMS

    const items = await store.backlog(owner, per, limit)
    if (items.length === 0) {
      throw new ApiError(
        'conflict.nothing_to_sweep',
        `Nothing to sweep: every trace of yours that can carry a '${per}' embedding already has one`,
        409,
        { retryable: false, details: { per } },
      )
    }

    return { ...rest, per, limit, _owner: sweepOwnerToken(owner), _sweep: items }
  }

  /**
   * Open the standing order behind a training run. Returns undefined — and changes nothing —
   * unless the store is wired, the flow is training, this is the FIRST attempt (an order
   * firing does not open another), and the payer is a key an order can hold. A bursa bearer
   * token is not: an order is a durable instruction to spend hours later, and a bearer
   * credential names no owner to spend on behalf of.
   */
  protected async _openTrainingOrder(
    modusId: string,
    aditus: Record<string, unknown>,
    by: Inceptio['by'],
    actumId: string,
    opts: InvokeOpts,
    /**
     * The cap admission actually applied to the launching run — already the minimum of the
     * caller's `maxImpetus` and any ceiling on the credential. The order records THIS, not the
     * raw request field: an order fires unattended hours later, past the credential that opened
     * it, so a ceiling left out here would be a ceiling that stops binding after the first
     * attempt. With no credential ceiling it IS the caller's `maxImpetus`, verbatim.
     */
    effectiveMaxImpetus: string | undefined,
  ): Promise<Mandatum | undefined> {
    const store = this.deps.mandata
    if (!store || modusId !== TRAINING_MODUS_ID || opts.mandatumId) return undefined
    const payer =
      'animaId' in by ? { animaId: by.animaId }
      : 'commitment' in by ? { commitment: by.commitment }
      : undefined
    if (!payer) return undefined

    const now = Date.now()
    const invocatio = {
      ...(effectiveMaxImpetus !== undefined ? { maxImpetus: effectiveMaxImpetus } : {}),
      ...(opts.computeStrategy ? { computeStrategy: opts.computeStrategy } : {}),
      ...(opts.gpuClass ? { gpuClass: opts.gpuClass } : {}),
    }
    try {
      const created = await store.create({
        modusId,
        aditus,
        by: payer,
        triggerGenus: 'schedula',
        schedula: { cron: HOURLY_CRON, zona: 'UTC', maxRuns: ORDER_MAX_RUNS },
        status: 'active',
        // The window runs from the ORIGINAL click, not from the first failure — "a day" is
        // the day the user asked, however many attempts fall inside it.
        finis: new Date(now + ORDER_WINDOW_MS),
        // Due immediately, but in WATCH mode: `pendens` is the attempt just dispatched, so
        // the first thing the runner does with this order is read that attempt's result.
        proximum: new Date(now),
        pendens: actumId,
        ...(Object.keys(invocatio).length ? { invocatio } : {}),
      })
      // `create` seeds the lineage empty by contract, so the launch is stamped on straight
      // after — the first attempt is an attempt, and counts against the day's allowance.
      return await store.update(created.id, { acta: [actumId], ignitions: 1, ignitum: new Date(now) })
    } catch (err) {
      // The order is a convenience over the run, never a precondition for it: a store failure
      // must not turn a dispatched, paid-for training into a failed request.
      log.warn('could not open a standing order for a training run', { error: String(err) })
      return undefined
    }
  }

  /**
   * The standing order behind one of the caller's runs — OWNER-SCOPED through the run itself
   * (`_owns`), so a stranger's run id is `not_found.run` exactly as it is on `getRun`: no new
   * resource, no new error code, and no second ownership rule to keep in step with the first.
   */
  async getRunOrder(auctor: AuctorKey, runId: string): Promise<RunOrder | null> {
    const mandatum = await this._ownedOrder(auctor, runId)
    return mandatum ? toRunOrder(mandatum) : null
  }

  /**
   * Cancel the standing order behind one of the caller's runs. The order is the user's, so
   * ending it is theirs to do. Idempotent: revoking an order that has already stopped returns
   * its current state rather than reopening or re-terminating it.
   */
  async revokeRunOrder(auctor: AuctorKey, runId: string): Promise<RunOrder | null> {
    const mandatum = await this._ownedOrder(auctor, runId)
    if (!mandatum || !this.deps.mandata) return null
    if (mandatum.status !== 'active' && mandatum.status !== 'dormiens') return toRunOrder(mandatum)
    const revoked = await this.deps.mandata.update(mandatum.id, {
      status: 'revocatum',
      causa: 'revocatum',
      pendens: undefined,
    })
    return toRunOrder(revoked)
  }

  /** The order behind a run the caller owns, or null when there is none. The RUN's ownership
   *  is checked first and an unowned id is indistinguishable from an unknown one, as
   *  everywhere else on this surface. */
  protected async _ownedOrder(auctor: AuctorKey, runId: string): Promise<Mandatum | null> {
    const a = await this.deps.actorum.findById(runId)
    if (!a || !(await this._owns(auctor, a))) throw Errors.notFoundRun(runId)
    if (!this.deps.mandata) return null
    return this.deps.mandata.findByActum(runId)
  }

  /**
   * Fetch a run by id and project it — OWNER-SCOPED. A caller may read a run only
   * if they own it (else `not_found.run`, never revealing that it exists). The Actum
   * is deliberately identity-blind, so ownership is checked against the ledger: the
   * run is yours iff you own one of the signa it consumed. Works for both `animaId`
   * and anon `commitment` (the arcanum signum the spend nullified is in your history),
   * preserving anonymity. Unknown id → `not_found.run`.
   */
  async getRun(auctor: AuctorKey, id: string): Promise<Run> {
    const a = await this.deps.actorum.findById(id)
    if (!a || !(await this._owns(auctor, a))) throw Errors.notFoundRun(id)
    const run = toRunDetail(a)
    // Private generation (noema-347): a private run stores opaque markers, resolved to
    // short-lived presigned links HERE — after, and only after, the ownership check above.
    // Ownership is the single gate; the SSE snapshot reads this same projection.
    if (run.exitus) run.exitus = await this._presignPrivateExitus(run.exitus)
    // The order, when there is one, rides on the run: a client polling a failed training
    // learns from the SAME response that it is scheduled to be attempted again, and learns it
    // from a field — never by reading the failure sentence.
    const mandatum = await this.deps.mandata?.findByActum(id).catch(() => null)
    if (mandatum) run.order = toRunOrder(mandatum)
    await this._attachQueuePlace(run, a)
    return run
  }

  /**
   * Stop one of the caller's in-flight runs and settle it — the agent twin of the cancel a
   * chat user already reaches from `/status`. Same single settlement path (`completor.fail`):
   * the pod is killed before the signa are released, the run lands `fractus`, and nothing is
   * charged. No second cancel mechanism exists here — this is the surface, not the machinery.
   *
   * OWNER-SCOPED through `_owns`, exactly as `getRun` is: a stranger's run id is
   * `not_found.run`, never `forbidden`, so run ids stay non-enumerable — the same convention
   * `getStudio`/`releaseStudio` state for studios.
   *
   * IDEMPOTENT, like `DELETE /v1/studios/:id`: cancelling a run that has already settled is
   * not an error. The terminal view comes back, 200, and no second settlement is invoked —
   * `completor.fail` re-reads the record and returns it untouched when it is already terminal,
   * so a double-cancel can neither double-release signa nor overwrite a recorded cause.
   *
   * Returns the run through `getRun`, so a cancel answers with the same projection a poll of
   * `GET /v1/runs/:id` would return.
   */
  async cancelRun(auctor: AuctorKey, id: string): Promise<Run> {
    const a = await this.deps.actorum.findById(id)
    if (!a || !(await this._owns(auctor, a))) throw Errors.notFoundRun(id)
    if (a.status !== 'completus' && a.status !== 'fractus') {
      await this._settleCancelled(a)
    }
    return this.getRun(auctor, id)
  }

  /**
   * List the caller's SETTLED spend history — owner-scoped, cursor-paginated, newest first,
   * plus a lifetime running total (`GET /v1/me/runs`).
   *
   * OWNERSHIP: the settled index is keyed by the owner (`animaId` OR anon `commitment`), so
   * the store's `listSettled(auctor, …)` is inherently owner-scoped — the SAME identity-blind
   * primitive `/status` uses to list in-flight gens (`findFor(auctorKey)`). There is no
   * list-by-`_owns` (Actum carries no identity column — the whole reason this index exists);
   * `_owns` is for single-run fetch (`getRun`), not listing. A bursaToken caller gets an empty
   * page (those runs are never indexed). SETTLED = `completus` only — a refunded `fractus` run
   * is not spend and was pruned at settlement.
   *
   * Degrades to an empty page when the wired index lacks the settled-history methods (dev/in-
   * memory doubles that don't retain).
   */
  async listRuns(auctor: AuctorKey, opts: ListRunsOpts = {}): Promise<RunsPage> {
    const index = this.deps.actumIndex
    if (!index?.listSettled || !index.sumSettledImpetus) {
      return { runs: [], runningTotal: { impetus: '0', usd: 0 } }
    }
    const limit = Math.min(Math.max(Math.trunc(opts.limit ?? 20) || 20, 1), 100)
    const [page, totalImpetus] = await Promise.all([
      index.listSettled(auctor, { limit, ...(opts.cursor ? { cursor: opts.cursor } : {}) }),
      index.sumSettledImpetus(auctor),
    ])
    return {
      runs: page.entries.map(toSettledRun),
      ...(page.nextCursor ? { nextCursor: page.nextCursor } : {}),
      runningTotal: { impetus: totalImpetus, usd: Number(totalImpetus) * IMPETUS_USD_RATE },
    }
  }

  /**
   * The caller's ACTIVITY — one owner-scoped projection of what they have in flight and
   * what has settled, newest first, with a door to each run's artifact
   * (`GET /v1/me/activity`).
   *
   * READ-ONLY and purely compositional: it reads the two owner-scoped listings the run
   * index already exposes — `findFor` (in-flight: `nascens|agens`) and `listSettled`
   * (settled: `completus`) — and adds nothing to either. Ownership is the index key
   * itself (`animaId` OR anon `commitment`), the same identity-blind primitive `/status`
   * and `/me/runs` use; a foreign key reaches no row, and a bursaToken caller gets an
   * empty page (those runs are never indexed).
   *
   * PAGINATION: `findFor` is an unpaginated, bounded in-flight set, so the in-flight rows
   * ride the FIRST page (no `?cursor=`); subsequent pages walk settled history through the
   * settled cursor, exactly as `/me/runs` does.
   *
   * DOORS: one bounded `actorum.findById` per row ON THIS PAGE (the collection-pieces
   * precedent), read only for the artifact ids the run recorded. A run whose door cannot
   * be resolved ships without one.
   *
   * Degrades to an empty page when the wired index lacks the settled-history method.
   */
  async listActivity(auctor: AuctorKey, opts: ListActivityOpts = {}): Promise<ActivityPage> {
    const index = this.deps.actumIndex
    if (!index?.listSettled) return { activity: [] }
    const limit = Math.min(Math.max(Math.trunc(opts.limit ?? 20) || 20, 1), 100)
    const [inFlight, page, releasedPage] = await Promise.all([
      opts.cursor ? Promise.resolve([]) : index.findFor(auctor),
      index.listSettled(auctor, { limit, ...(opts.cursor ? { cursor: opts.cursor } : {}) }),
      // Released rows ride the FIRST page alongside in-flight — same reasoning as `inFlight`
      // above: they are few and recent, not a cursor-walked history of their own.
      opts.cursor || !index.listReleased ? Promise.resolve({ entries: [] }) : index.listReleased(auctor, { limit }),
    ])

    const rows: ActivityRow[] = [
      ...inFlight.map(e => this._toActivityRow(e, 'running')),
      ...page.entries.map(e => this._toActivityRow(e, 'settled')),
      ...releasedPage.entries.map(e => this._toActivityRow(e, 'released')),
    ].sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? ''))

    for (const row of rows) {
      const actum = await this.deps.actorum?.findById(row.actumId)
      if (!actum) continue
      const door = activityDoorFor(row.kind, actum.aditus, actum.exitus)
      if (door) row.door = door
      // A run still in flight may not be running at all — it may be holding a place in the
      // warm-pod line. This list is what someone opens when they come BACK to a run they
      // walked away from, so it is the surface that owes them the difference; leaving it out
      // would show a queued run as running, and a queue that is never shown is a queue
      // nobody trusts. Settled rows are never in a line and are not asked about.
      if (row.status === 'running') await this._attachActivityQueuePlace(row, actum)
    }

    return { activity: rows, ...(page.nextCursor ? { nextCursor: page.nextCursor } : {}) }
  }

  /** Project one owner-scoped index row onto its public activity row (doors added separately). */
  protected _toActivityRow(entry: ActumIndex, status: ActivityRow['status']): ActivityRow {
    const row: ActivityRow = {
      actumId: entry.actumId,
      kind: activityKindFor(entry.modusId),
      modusId: entry.modusId,
      status,
    }
    if (entry.modusLabel !== undefined) row.modusLabel = entry.modusLabel
    if (entry.createdAt !== undefined) row.createdAt = new Date(entry.createdAt).toISOString()
    if (entry.settledAt !== undefined) row.settledAt = new Date(entry.settledAt).toISOString()
    if (entry.releasedAt !== undefined) row.releasedAt = new Date(entry.releasedAt).toISOString()
    return row
  }

  /**
   * What the caller has EARNED — the read side of the royalty rails (`GET /v1/me/earnings`).
   *
   * Runs pay their author and their models' authors on every completion (spellRoyalty,
   * modelRoyalty), a host on every guest gen served from their pod (hostCut, hospitium),
   * and a referrer on a referred deposit (referralSplit). Every one of those lands as a
   * ledger row on the earner. This is where the earner reads them back: the lifetime total,
   * the per-stream breakdown behind it, and a newest-first page of the payments themselves.
   *
   * OWNER-SCOPED by construction — the ledger rows ARE keyed by identity, so the store's
   * two queries are scoped to the caller's own `animaId` (or anon `commitment`) and can
   * return no one else's earnings. A bursaToken caller has no ledger identity and never
   * earns, so it gets an empty view rather than an error.
   *
   * SPENDING DOES NOT REDUCE IT: the totals sum every status, because a royalty the earner
   * has since spent was still earned. This is an earnings statement, not a balance —
   * `GET /v1/me/status` is the balance.
   */
  async listEarnings(auctor: AuctorKey, opts: ListEarningsOpts = {}): Promise<EarningsView> {
    const empty: EarningsView = { lifetime: { impetus: '0', usd: 0 }, streams: [], earnings: [] }
    if ('bursaToken' in auctor) return empty

    const limit = Math.min(Math.max(Math.trunc(opts.limit ?? 20) || 20, 1), 100)
    const [totals, page] = await Promise.all([
      this.deps.signorum.earningTotals(auctor),
      this.deps.signorum.listEarnings(auctor, { limit, ...(opts.cursor ? { cursor: opts.cursor } : {}) }),
    ])

    // Fold the per-auctor totals onto their streams — modelRoyalty pays one row per payee
    // weight, so two auctors could in principle map to one kind; the fold is what keeps the
    // breakdown keyed by what the earner recognises rather than by the hook that minted it.
    const byKind = new Map<EarningKind, EarningStream>()
    let lifetime = 0n
    for (const t of totals) {
      const kind = earningKind(t.auctor)
      if (!kind) continue
      const prev = byKind.get(kind)
      const impetus = (prev ? BigInt(prev.impetus) : 0n) + t.impetus
      byKind.set(kind, {
        kind,
        impetus: impetus.toString(),
        usd: Number(impetus) * IMPETUS_USD_RATE,
        count: (prev?.count ?? 0) + t.count,
      })
      lifetime += t.impetus
    }

    return {
      lifetime: { impetus: lifetime.toString(), usd: Number(lifetime) * IMPETUS_USD_RATE },
      streams: EARNING_KIND_ORDER.map(k => byKind.get(k)).filter((s): s is EarningStream => !!s),
      earnings: page.entries.map(toEarning),
      ...(page.nextCursor ? { nextCursor: page.nextCursor } : {}),
    }
  }

  /** List the flows (atomic + compositus) the caller owns — the picker's "mine" filter, the
   *  smaller-diff twin of `GET /v1/flows` (spec: "either extend with ?mine=1 or filter the
   *  registry list" — this is the filter route, owner-scoped like `/me/models`). */
  async listMyFlows(auctor: AuctorKey): Promise<FlowSummary[]> {
    const modi = await this.deps.modorum.list({ auctor })
    return modi.map((m) => {
      const categoria = (m as { categoria?: unknown }).categoria
      return {
        id: m.id,
        nomen: m.nomen,
        versio: m.versio,
        ...(m.descriptio !== undefined ? { descriptio: m.descriptio } : {}),
        ...(categoria !== undefined ? { categoria } : {}),
        ...(m.genus === 'compositus' ? { steps: m.gradus?.length ?? 0 } : {}),
        modusGenus: resolveCanonVerb(m),
      }
    })
  }

  /** List the canonical flows (atomic + compositus spells) as compact summaries. */
  async listFlows(): Promise<FlowSummary[]> {
    const modi = await this.deps.modorum.list({ canonica: true })
    return modi.map((m) => {
      // `categoria` is an optional catalog tag not on the core Modus type — read it
      // off whatever the registry carries without widening the primitive.
      const categoria = (m as { categoria?: unknown }).categoria
      return {
        id: m.id,
        nomen: m.nomen,
        versio: m.versio,
        ...(m.descriptio !== undefined ? { descriptio: m.descriptio } : {}),
        ...(categoria !== undefined ? { categoria } : {}),
        ...(m.genus === 'compositus' ? { steps: m.gradus?.length ?? 0 } : {}),
        modusGenus: resolveCanonVerb(m),
      }
    })
  }

  /** Describe one flow's JSON-Schema input/output. Unknown id → `not_found.flow`. */
  async describeFlow(id: string): Promise<FlowDescription> {
    const m = await this.deps.modorum.find(id)
    if (!m) throw Errors.notFoundFlow(id)
    // Modus carries every field describeFlow reads; the cast supplies the
    // index-signature DescribableModus declares for its passthrough meta.
    const description = describeFlow(m as unknown as DescribableModus)
    // `familia` — read-only, additive: derive the flow's model family from its FULL
    // weight manifest — the linked Fundamentum's base weights UNION the flow's own
    // extra weights (`Modus.intellae`) — mirroring Compiler.ts's `_manifestRefs`
    // union (Compiler.ts:446-453) without touching Compiler.ts or any trigger-
    // resolution logic. Atomic image-gen essentiae (e.g. klein) declare no `intellae`
    // of their own; their family-bearing base weights live entirely on the Fundamentum,
    // so reading `Modus.intellae` alone silently under-reports for most flows. First
    // non-empty distinct `familia` across the unioned weights wins (base-first, same
    // precedence as `_manifestRefs`). No weights, no registry, or no family on any
    // weight → leave `familia` undefined (safe default: no highlight for that flow).
    const fundamentumId = (m as { fundamentumId?: string }).fundamentumId
    const fundamentumVersio = (m as { fundamentumVersio?: string }).fundamentumVersio
    const fundamentum = fundamentumId
      ? await this.deps.fundamentorum.find(fundamentumId, fundamentumVersio).catch(() => null)
      : null
    const ownIntellae = (m as { intellae?: Array<{ id: string; role: string }> }).intellae ?? []
    const intellae = [...(fundamentum?.intellae ?? []), ...ownIntellae]
      .filter((w, i, all) => all.findIndex(o => o.id === w.id) === i)
    if (intellae.length > 0 && this.deps.intellarum) {
      for (const w of intellae) {
        const intella = await this.deps.intellarum.find(w.id).catch(() => null)
        if (intella?.familia) { description.familia = intella.familia; break }
      }
    }
    return description
  }

  /**
   * Quote a run's cost WITHOUT dispatching — the upper-bound reservation the cursor
   * declares for this modus + aditus (side-effect-free; `run().impetus ≤ reserve()`).
   * Exact for fixed-cost flows, an upper bound for duration-based pod flows.
   */
  async quote(auctor: AuctorKey, target: InvokeTarget, aditus: Record<string, unknown>): Promise<{ impetus: string; recipient: string }> {
    let modusId: string | undefined = target.modusId
    if (!modusId && target.verb) {
      modusId = (await this.deps.consuetudinum?.resolve(auctor, target.verb)) ?? CANON_VERBS[target.verb]
    }
    if (!modusId) throw Errors.notFoundFlow(target.verb ?? '?')
    // The embed sweep's reservation is a function of the caller's OWN backlog, which the
    // cursor refuses to price without an `_owner`/`_sweep` stamp (`EmbedSweepCursor.resolveWork`
    // throws a plain, unhandled Error otherwise). `invokeFlow` stamps before estimating for the
    // same reason; `_stampEmbedSweep` only reads the backlog, so doing it here stays side-effect-
    // free and the quote the client sees is the one `invokeFlow` would actually reserve — with
    // `recipient` hashed over the SAME aditus the dispatch path commits to, so an arcanum proof
    // built against this quote still verifies at `ActumInceptor`.
    const effectiveAditus = modusId === MODUS_EMBED_SWEEP.id
      ? await this._stampEmbedSweep(auctor, aditus)
      : aditus
    return {
      impetus:   (await this._estimate(modusId, effectiveAditus)).toString(),
      recipient: computeRecipient(modusId, effectiveAditus),
    }
  }

  /**
   * Save a reusable, owner-keyed flow — the agent twin of the bot's Save-as. Derive a
   * new Modus from a base (an owned run via `fromRun`, or an explicit `modusId`), baking
   * the captured `aditus` as input defaults + folding pinned LoRAs + prompt affixes. The
   * chosen name yields a global-unique slug (collision → `conflict.slug_taken`).
   */
  async saveFlow(auctor: AuctorKey, opts: SaveFlowOpts): Promise<{ id: string }> {
    if ('bursaToken' in auctor) throw Errors.authForbidden('Bursa tokens cannot own saved flows')
    let baseModusId = opts.modusId
    let aditus = opts.aditus ?? {}
    let pinned = opts.pinnedModels
    if (opts.fromRun) {
      const a = await this.deps.actorum.findById(opts.fromRun)
      if (!a || !(await this._owns(auctor, a))) throw Errors.notFoundRun(opts.fromRun)
      baseModusId = a.modusId
      if (opts.aditus === undefined) aditus = a.aditus ?? {}
      if (pinned === undefined && a.pinnedModels) pinned = a.pinnedModels.map((m) => ({ id: m.id }))
    }
    if (!baseModusId) throw Errors.inputMalformed('saveFlow needs fromRun or modusId')
    const base = await this.deps.modorum.find(baseModusId)
    if (!base) throw Errors.notFoundFlow(baseModusId)

    const slug = slugify(opts.name)
    if (!slug) throw Errors.inputMalformed('name produces an empty slug')
    if (await this.deps.modorum.find(slug)) throw Errors.conflictSlug(slug)

    const derived = deriveSavedModus(base, {
      slug, name: opts.name, owner: auctor, aditus,
      promptMode: opts.promptMode ?? 'open',
      ...(opts.affix?.prefix ? { promptPraefixum: opts.affix.prefix } : {}),
      ...(opts.affix?.suffix ? { promptSuffixum: opts.affix.suffix } : {}),
      ...(pinned ? { pinned } : {}),
    })
    // Stamp the licence terms the base carries through its whole lineage onto the saved flow, so
    // a save of a save never depends on walking back to a parent that declared them.
    const terms = await requiredUseTerms(base, (id) => this.deps.modorum.find(id))
    if (terms.length > 0) derived.useTerms = terms
    await this.deps.modorum.register(derived)
    return { id: derived.id }
  }

  /** Rebind one of the caller's canon verbs to a flow (owner-keyed Consuetudinum). */
  async bind(auctor: AuctorKey, verb: string, modusId: string): Promise<{ verb: string; modusId: string }> {
    if ('bursaToken' in auctor) throw Errors.authForbidden('Bursa tokens cannot rebind verbs')
    if (!this.deps.consuetudinum) throw Errors.internal('verb binding not configured')
    if (!(verb in CANON_VERBS)) throw Errors.inputMalformed(`'${verb}' is not a rebindable verb`)
    if (!(await this.deps.modorum.find(modusId))) throw Errors.notFoundFlow(modusId)
    await this.deps.consuetudinum.bind(auctor, verb, modusId)
    return { verb, modusId }
  }
}
