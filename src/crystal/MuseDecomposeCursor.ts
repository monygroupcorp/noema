import type { Actorum, ActumCompletor, Cursor, CursorResult, Exitus } from '../types/cursus.js'
import type { Actum } from '../types/actum.js'
import type { Modus } from '../types/modus.js'
import { isArchived } from '../types/dataset.js'
import type { Captionset, Dataset, Datasets } from '../types/dataset.js'
import { getTrace } from '../lib/trace.js'
import { makeLogger } from '../lib/logger.js'
import type { ApiProvider } from './apiProviders.js'
import { chatImpetus } from './apiProviders.js'
import { buildGarden, createChatExtractor, type FetchLike } from './muse/garden.js'
import { CATEGORIES, type Fragment } from './muse/taxonomy.js'

// =============================================================================
// MuseDecomposeCursor — a captionset in, fragments on the dataset's media items
// =============================================================================
//
// The dispatch half of the dataset decompose job (`modus.dataset-decompose`). It
// takes a dataset id + a captionset id, runs every caption in that captionset
// through the Muse extractor (`muse/garden.ts`) and writes the resulting
// `Fragment[]` back onto the `DatasetMediaItem` each caption belongs to. That
// write is what fills `DatasetMediaItem.fragments`, which the dataset screen's
// chip garden already renders.
//
// It is a NORMAL METERED RUN on the chat rail: it reserves a ceiling before the
// first provider call, settles the summed real token cost, appears in run
// history, and has no separate lifecycle and no free lane.
//
// It is also an ASYNC run. `run()` returns at dispatch and the per-caption loop
// continues off-request — see ASYNC AT DISPATCH below — so the caller gets a run
// id immediately and watches the run like any other.
//
// NINE PROPERTIES ARE LOAD-BEARING HERE:
//
//   OWN MINISTERIUM — `Cursorum` is a flat Map<ministerium, Cursor> whose
//     `register` is a bare set. Registering this cursor under 'openai' would
//     replace the ApiCursor bound to that key and send every hosted-API chat,
//     image and image-edit dispatch here instead. It owns `'musegarden'`, and
//     the provider registrations are left exactly as they are.
//
//   MEDIA-ID KEYING — a captionset's captions are keyed by
//     `DatasetMediaItem.id`, and fragments are written back by that same id.
//     `media` is append-only (that is what `DatasetVersion` records), so an
//     index-keyed write re-binds every fragment to a different item the first
//     time media is appended. A caption whose media id does not resolve on the
//     dataset FAILS the job; there is no positional fallback.
//
//   CAP BEFORE SPEND — one chat call is made per caption, so cost is linear in
//     the captionset. The per-job cap is checked in `reserve()`, i.e. before the
//     reservation is taken and before the first provider call, so an oversized
//     captionset is refused up front rather than discovered part-way through a
//     paid run.
//
//   FAIL CLOSED — the container registers a provider only when its key env is
//     set. With no chat-capable provider registered the cursor refuses with a
//     named error in `reserve()`, before anything is locked, rather than letting
//     a run reach the wire and come back as an upstream 401 with credits held.
//
//   ASYNC AT DISPATCH — the loop is one awaited chat call per caption, serial and
//     bounded only by the per-job cap, so a full pass is minutes to hours of wall
//     clock. Holding the dispatching request open for it makes the run's duration
//     the caller's HTTP timeout: a client whose fetch gives up reads a run that has
//     already succeeded server-side as a failure. So `run()` prepares the pass —
//     provider, dataset, captionset, work — while the caller is still waiting, then
//     returns `{ kind:'async' }` and lets the loop continue off-request. Dispatch
//     hands the run id back at that point and the client watches the run.
//
//     The handle is NOT stamped onto the actum. `externusJobId` is what enrolls a
//     run in the pod in-flight sweep, and a decompose has no pod and no webhook, so
//     a stamped run would be swept forever against a callback that cannot arrive.
//     The value in the `CursorResult` is the run's own id and is read by nothing:
//     `dispatchInceptio` ignores it on the async branch. `status` is left alone for
//     the same reason.
//
//   SETTLES ITSELF — no webhook finishes this run. Every other async cursor here is
//     completed by a pod's callback; a decompose has no pod, so the loop calls the
//     `ActumCompletor` on its own. The SAME clamp-and-settle the sync return path
//     used runs at loop completion — the summed real token cost, clamped to the
//     reservation — and a loop that dies mid-pass settles through `fail()`, which
//     releases the locked signa. Either way the run reaches a terminal state under
//     its own power rather than waiting for the expiry reaper to guess. The completor
//     arrives as a LAZY accessor because the container constructs it after this
//     registration; the accessor is called minutes into a run, long after.
//
//   SINGLE FLIGHT PER DATASET — a decompose holds a reservation for its whole
//     duration, so a second decompose started on top of a running one locks a
//     second reservation against the same work. A dataset that already has a
//     decompose running is refused in `reserve()` — i.e. in the same up-front
//     group as the two refusals above, BEFORE the reservation is locked. A guard
//     placed in `run()` instead would refuse only after the second run's credits
//     were already held, which is the thing being fixed rather than a fix. The
//     claim is taken in `run()` (so `reserve()` stays the read-only estimate its
//     contract requires) and released in a `finally` around the WHOLE pass —
//     including the settlement, and therefore long after `run()` has returned.
//     Releasing it when `run()` returns would free the dataset while the loop is
//     still spending on it, which is the double reservation the claim exists to
//     prevent. The claim lives on the cursor instance the container registers, so
//     it is per-process.
//
//   INCREMENTAL BY DEFAULT — a media item that already carries fragments is
//     already decomposed, and `DatasetMediaItem.fragments` is the record of it:
//     it is what `setFragments` writes and what the chip garden is pooled from.
//     A default decompose therefore reads the fragments the dataset already holds
//     and runs only the captions whose item has none, so growing a captioned set
//     by two images costs two calls rather than one per item in the whole set. A
//     run with NOTHING left to do is refused in `reserve()` — in the same up-front
//     group as the refusals above and for the reason stated there: a refusal taken
//     after the reservation would freeze credits against a job that was never
//     going to do any work. `redo` in the aditus is the explicit opt-in that
//     decomposes everything again (a better extractor, a changed trigger, a bad
//     pass); it is never the default, because it is the expensive path.
//
//   BOUNDED CALL — one chat call is made per caption and each is given a
//     deadline (`DEFAULT_CHAT_CALL_TIMEOUT_MS`). A provider call that never
//     answers fails the decompose with a named error and aborts the request,
//     instead of parking the run until the actum's expiry. The expiry reaper is
//     the backstop for a lost pod, not the timeout for a hung HTTP request:
//     reaching it means the reservation stays locked for the whole expiry
//     window for a run that stopped making progress in its first seconds.
//
//   HONEST TERMINUS — the actum's `expirat` is what lets the expiry reaper call a
//     run dead and refund it. A serial pass of N captions can legitimately take
//     N × the per-call deadline, which for a full job is hours — far past the
//     inceptor's 15-minute default. A run off-request has no request to keep it
//     visibly alive, so under the default the reaper would fail-and-refund a live
//     decompose that is still writing fragments. `terminus()` therefore declares
//     the pass's own length, and is clamped to `MAX_DECOMPOSE_TERMINUS_MS` so a
//     large job cannot buy an unbounded deadline. Refund-on-death is not weakened
//     by the longer window: SETTLES ITSELF is what ends a dead loop, and the reaper
//     is only the outer backstop.
//
// Ring rules: `src/crystal` is platform-neutral. Nothing here reads
// `process.env` — provider descriptors and their resolved keys arrive from the
// container, exactly as they do for `ApiCursor`.
// =============================================================================

const log = makeLogger('cursor:musedecompose')

/** The ministerium this cursor owns. Never 'openai' — see the header. */
export const MUSE_DECOMPOSE_MINISTERIUM = 'musegarden'

/**
 * Largest captionset a single decompose job will accept.
 *
 * One chat call per caption: the job's cost and wall-clock both scale linearly,
 * and the reservation is the product of this bound and the per-caption estimate.
 * Refusing above the cap keeps a single run's ceiling — and a single user's
 * locked balance — bounded. A larger dataset is decomposed in several passes.
 */
export const DEFAULT_MAX_DECOMPOSE_CAPTIONS = 200

/**
 * Per-caption token estimate used for the RESERVATION only.
 *
 * The decomposition system prompt is fixed and dominates each call; the caption
 * and the JSON answer are short. Deliberately generous: the reservation is an
 * upper bound that `run()` settles down to the summed real usage, so an estimate
 * set low would clamp the settlement and undercharge, while one set high only
 * locks credits for the duration of the run.
 */
export const DEFAULT_TOKENS_PER_CAPTION = 1500

/**
 * Deadline for ONE caption's chat call.
 *
 * A decomposition call is a short prompt and a short JSON answer, so a minute is
 * far above any healthy round trip and only a call that is not coming back hits
 * it. The number matters because it is the difference between a stuck call
 * failing its run in seconds and the run holding its reservation until the actum
 * expires — see BOUNDED CALL in the header.
 */
export const DEFAULT_CHAT_CALL_TIMEOUT_MS = 60_000

/**
 * Slack added to a decompose's declared `terminus`, over and above the per-caption
 * deadlines it is the sum of.
 *
 * The pass is more than its provider calls: resolving the dataset, writing each item's
 * fragments back, and the settlement at the end all cost wall clock that no per-call
 * deadline covers. A terminus set to exactly the call budget would expire a pass whose
 * every call answered on time.
 */
export const DECOMPOSE_TERMINUS_MARGIN_MS = 5 * 60 * 1000

/**
 * Ceiling on the `terminus` a decompose may declare — three hours.
 *
 * A full job is one call per caption up to the per-job cap, so the honest length of the
 * longest legal pass is hours rather than minutes. The ceiling is what stops that from
 * becoming an unbounded deadline: a reservation held against a run that stopped making
 * progress is released when the reaper reaches it, and this is the longest that can take.
 * The inceptor clamps every cursor-declared terminus to its own `MAX_TERMINUS_MS`; this
 * is the same bound stated where the number is chosen, so the declaration is honest on
 * its own rather than only after someone else trims it.
 */
export const MAX_DECOMPOSE_TERMINUS_MS = 3 * 60 * 60 * 1000

/**
 * A decompose was asked for on a dataset that already has one running.
 *
 * Typed rather than a bare `Error` so the API facade can map it to its own
 * conflict response instead of masking it as an internal error — the caller is
 * being told a fact about their own dataset, not about the server.
 */
export class DecomposeInFlightError extends Error {
  constructor(readonly datasetId: string) {
    super(`muse decompose: a decompose is already running on dataset '${datasetId}'`)
    this.name = 'DecomposeInFlightError'
  }
}

/**
 * A decompose was asked for on a captionset whose every media item already carries
 * fragments, and without `redo`.
 *
 * Typed for the same reason `DecomposeInFlightError` is: the caller is being told a
 * fact about their own dataset — there is nothing left to decompose — and the API
 * facade maps it to a request outcome instead of an internal error. Thrown from
 * `reserve()`, before a reservation exists.
 */
export class DecomposeNothingToDoError extends Error {
  constructor(readonly datasetId: string, readonly captionsetId: string) {
    super(
      `muse decompose: every captioned media item on dataset '${datasetId}' already carries ` +
        `fragments from captionset '${captionsetId}' — pass \`redo\` to decompose them again`,
    )
    this.name = 'DecomposeNothingToDoError'
  }
}

/** A provider descriptor plus the bearer key the container resolved for it. */
export interface ChatProviderBinding {
  provider: ApiProvider
  apiKey: string
}

export interface MuseDecomposeCursorDeps {
  /** Reads the dataset + captionset and writes fragments back onto its media items. */
  datasets: Pick<Datasets, 'find' | 'setFragments'>
  /**
   * Hosted-API providers available to this run, in container order. Only entries
   * declaring a `chat` capability and carrying a key are usable; when none is,
   * the cursor refuses (see FAIL CLOSED above).
   */
  providers: ChatProviderBinding[]
  /**
   * The actum store — re-read at settlement so the loop completes the record as it
   * stands now rather than the snapshot `run()` was handed, which is minutes to hours
   * old by then. Mirrors the pod rail's own launch-failure sink, which looks the actum
   * up for the same reason.
   */
  actorum: Pick<Actorum, 'findById'>
  /**
   * The completor this run settles itself through — see SETTLES ITSELF in the header.
   *
   * A LAZY ACCESSOR rather than the instance, because the container constructs the
   * completor after it registers this cursor. It is called at the end of a pass, long
   * after wiring is finished, so the indirection costs nothing and is what lets the
   * dependency point the way the lifecycle actually runs.
   */
  completor: () => ActumCompletor
  /** Injected transport — tests pass a fake; production leaves it to global `fetch`. */
  fetchImpl?: FetchLike
  /** Overrides `DEFAULT_MAX_DECOMPOSE_CAPTIONS`. */
  maxCaptions?: number
  /** Overrides `DEFAULT_TOKENS_PER_CAPTION`. */
  tokensPerCaption?: number
  /** Overrides `DEFAULT_CHAT_CALL_TIMEOUT_MS` — the per-caption call deadline. */
  chatCallTimeoutMs?: number
}

/**
 * Provider preference when several are registered: OpenRouter first, because it
 * is the one rail that routes to every model family through a single key. An
 * explicit `provider` aditus overrides this, and anything not listed falls to
 * container order.
 */
const PROVIDER_PREFERENCE = ['openrouter', 'openai', 'venice']

/**
 * A pass resolved down to what it will actually do, before the caller is released.
 *
 * Resolving up front is what keeps every refusal on the dispatching request: with the loop
 * detached, an error raised inside it can only reach the run record, never the caller. A
 * dataset that does not exist should still be a straight answer to the request that named it.
 */
interface PreparedPass {
  binding: ChatProviderBinding
  dataset: Dataset
  work: Array<[string, string]>
}

export class MuseDecomposeCursor implements Cursor {
  constructor(private readonly deps: MuseDecomposeCursorDeps) {}

  /**
   * Datasets with a decompose running right now, claimed for the length of `run()`.
   *
   * Read by `reserve()` and written only by `run()`: the cursor contract says
   * `reserve()` is a read-only estimate, and the reservation it prices has not been
   * locked yet when it is called — a claim taken there would be held on behalf of a
   * run that may never be dispatched.
   */
  private readonly running = new Set<string>()

  async reserve(modus: Modus, aditus: Record<string, unknown>): Promise<bigint> {
    // Every refusal happens HERE — before the reservation is locked and before any
    // provider call — so an oversized, unservable or duplicate job costs nothing.
    // The single-flight refusal is first because it needs no reads at all.
    const claimed = String(aditus.dataset ?? '')
    if (claimed && this.running.has(claimed)) throw new DecomposeInFlightError(claimed)

    const binding = this.pickProvider(aditus)
    // `work` is what this run would actually send to the model — the captions whose media
    // item has no fragments yet, or every caption under `redo`. `resolveWork` refuses an
    // empty one HERE, so a decompose with nothing left to do never reaches a reservation.
    const { work } = await this.resolveWork(aditus)

    if (modus.impetusFixum !== undefined) return modus.impetusFixum

    const perCaption = this.deps.tokensPerCaption ?? DEFAULT_TOKENS_PER_CAPTION
    // Priced on the work, not on the captionset: a re-decompose of two new images must
    // not lock the ceiling of a whole-set pass.
    return chatImpetus(work.length * perCaption, binding.provider.pricing.chatImpetusPer1kTokens)
  }

  /**
   * Wall-clock budget for a decompose — see HONEST TERMINUS in the header.
   *
   * The pass is serial, one deadline-bounded chat call per item of work, so its longest
   * legal length is the work times that deadline. The margin covers what the per-call
   * deadlines do not (the store reads, the fragment writes, the settlement), and the
   * whole thing is clamped so a large job cannot buy an unbounded window.
   *
   * Deliberately NOT derived from `reserve()`: that returns impetus, and for a modus
   * declaring `impetusFixum` it is a flat price — a price read as a duration would hand a
   * long pass a deadline of a few seconds.
   */
  async terminus(_modus: Modus, aditus: Record<string, unknown>): Promise<number> {
    const { work } = await this.resolveWork(aditus)
    const perCall = this.deps.chatCallTimeoutMs ?? DEFAULT_CHAT_CALL_TIMEOUT_MS
    const budget = work.length * perCall + DECOMPOSE_TERMINUS_MARGIN_MS
    return Math.min(budget, MAX_DECOMPOSE_TERMINUS_MS)
  }

  /**
   * Claim the dataset, prepare the pass, and hand the run back — the loop runs on.
   *
   * Everything that can refuse the job outright happens INSIDE this call, while the
   * dispatching caller is still waiting: an unservable provider, a dataset or captionset
   * that does not resolve, a caption naming no media item, a pass over the cap. Those
   * still throw from `run()`, so `dispatchInceptio` fails the actum and the caller is told
   * why, exactly as before.
   *
   * What does NOT happen inside this call is the loop. Once the pass is prepared the work
   * is detached and `run()` returns `{ kind:'async' }`; the loop settles the run itself
   * when it ends (SETTLES ITSELF). The claim is released by the loop, not here — see
   * SINGLE FLIGHT PER DATASET for why releasing it at return would be the double
   * reservation the claim exists to prevent.
   */
  async run(actum: Actum): Promise<CursorResult> {
    const datasetId = String(actum.aditus.dataset ?? '')
    const claimed = datasetId !== '' && !this.running.has(datasetId)
    if (claimed) this.running.add(datasetId)

    let prepared: PreparedPass
    try {
      prepared = await this.prepare(actum.aditus)
    } catch (err) {
      // Nothing was detached, so nothing else will free the dataset.
      if (claimed) this.running.delete(datasetId)
      throw err
    }

    // The identified owner, read from the trace context `dispatchInceptio` opened around
    // this call. The completor threads it into vestigium indexing, and the sync return
    // path used to hand it over from the inceptio; a detached loop has no inceptio, and
    // the trace is where that identity already travels. Read HERE rather than in the loop
    // so it is captured while the dispatching context is unambiguously the current one.
    const trace = getTrace()
    const auctor = trace?.animaId !== undefined ? { animaId: trace.animaId }
      : trace?.commitment !== undefined ? { commitment: trace.commitment }
      : undefined

    // The detached pass. `runDetached` handles both of its own exits, so the guard here is the
    // last resort for a wiring fault inside the handling itself: an unhandled rejection on a
    // detached promise takes the process down, and one decompose must not be able to do that.
    void this.runDetached(actum, prepared, auctor, claimed ? datasetId : null).catch((err) =>
      log.error('muse decompose: the pass could not settle itself', {
        actumId: actum.id, error: String(err),
      }),
    )

    // Not stamped anywhere — see ASYNC AT DISPATCH. `dispatchInceptio` ignores this value
    // on the async branch; it is the run's own id so that a log line reading it names the run.
    return { kind: 'async', externusJobId: actum.id }
  }

  /**
   * The pass, off-request: decompose, then settle — or fail — under this run's own power.
   *
   * This is the whole reason the cursor takes a completor. No webhook is coming: a
   * decompose has no pod and nothing external will finish it, so a loop that ended and did
   * not settle would leave the payer's credits locked until the expiry reaper released them.
   * Both exits go through the completor, and the claim is released after the settlement so
   * a second decompose cannot start against a reservation that is still being settled.
   */
  private async runDetached(
    actum: Actum,
    prepared: PreparedPass,
    auctor: { animaId: string } | { commitment: string } | undefined,
    claimId: string | null,
  ): Promise<void> {
    try {
      const exitus = await this.decompose(actum, prepared)
      await this.deps.completor().complete(await this.fresh(actum), exitus, auctor)
    } catch (err) {
      const message = (err as Error)?.message ?? String(err)
      // `fail()` releases the locked signa and stamps the actum `fractus`. It re-reads the
      // record and returns early on one already terminal, so racing the expiry reaper here
      // cannot double-release. A settle that itself fails must not mask the original error,
      // which is already on the run's own record path — swallow it and leave the reaper as
      // the last backstop.
      await this.deps.completor().fail(await this.fresh(actum), message).catch(() => {})
    } finally {
      if (claimId) this.running.delete(claimId)
    }
  }

  /** The actum as it stands now — the snapshot `run()` was handed is a whole pass old. */
  private async fresh(actum: Actum): Promise<Actum> {
    return (await this.deps.actorum.findById(actum.id).catch(() => null)) ?? actum
  }

  /** Everything the pass needs, resolved before the caller is released. */
  private async prepare(aditus: Record<string, unknown>): Promise<PreparedPass> {
    const binding = this.pickProvider(aditus)
    const { dataset, work } = await this.resolveWork(aditus)
    return { binding, dataset, work }
  }

  private async decompose(actum: Actum, prepared: PreparedPass): Promise<Exitus> {
    const aditus = actum.aditus
    // The reservation ActumInceptor locked — the upper bound the settlement must not exceed.
    const reserved = actum.impetus

    const { binding, dataset, work } = prepared

    const trigger = typeof aditus.trigger === 'string' ? aditus.trigger.trim() : ''
    const model = typeof aditus.model === 'string' && aditus.model.trim() ? aditus.model.trim() : undefined

    // Summed real usage across every call this run makes, teed off the response
    // bodies by the wrapper below. `createChatExtractor` returns fragments, not
    // usage, and the metering must be the REAL cost rather than the estimate.
    let tokens = 0
    const base: FetchLike = this.deps.fetchImpl ?? ((url, init) => fetch(url, init) as unknown as ReturnType<FetchLike>)
    const timeoutMs = this.deps.chatCallTimeoutMs ?? DEFAULT_CHAT_CALL_TIMEOUT_MS
    // Which caption's call is on the wire — the loop below sets it before each call so a
    // deadline names the media item it stopped on rather than the run as a whole.
    let inFlightMediaId = ''
    const metered: FetchLike = async (url, init) => {
      const res = await callWithin(base, url, init, timeoutMs, inFlightMediaId)
      const body = await res.text()
      tokens += totalTokens(body)
      return { ok: res.ok, status: res.status, text: async () => body }
    }

    const extract = createChatExtractor({
      provider: binding.provider,
      apiKey: binding.apiKey,
      fetchImpl: metered,
      ...(model ? { model } : {}),
    })

    // Counted over the work this run did, never over the captionset it read: a run that
    // skipped twenty-eight already-decomposed items and reported thirty would disagree
    // with its own settlement, which is the summed real token cost of the calls it made.
    let decomposed = 0
    let written = 0
    for (const [mediaId, caption] of work) {
      inFlightMediaId = mediaId
      const raw = await extract([caption], dataset.name, trigger)
      // `buildGarden` is the single validation point: out-of-taxonomy categories,
      // blanks and per-category duplicates are dropped there rather than here, so
      // one item's fragments obey exactly the rules the chip garden renders.
      const fragments = flatten(buildGarden(raw).garden)
      // Keyed by media id, never by position — see MEDIA-ID KEYING in the header.
      const updated = await this.deps.datasets.setFragments(dataset.id, mediaId, fragments)
      if (!updated) {
        throw new Error(`muse decompose: media item '${mediaId}' is no longer on dataset '${dataset.id}'`)
      }
      decomposed++
      written += fragments.length
    }

    // The settlement, unchanged by the move off-request: the summed REAL token cost,
    // clamped to the reservation the inceptor locked. The clamp is what keeps the cursor
    // cost contract (`run().impetus ≤ reserve()`) true on this rail as well — it is now
    // asserted at the completor rather than returned to the dispatcher, and the completor
    // rejects an overcharge outright.
    const impetus = chatImpetus(tokens, binding.provider.pricing.chatImpetusPer1kTokens)
    return {
      exitus: { decomposed, fragments: written },
      impetus: impetus > reserved ? reserved : impetus,
    }
  }

  // ── helpers ───────────────────────────────────────────────────────────────

  /**
   * The chat provider this run will use, or a named refusal when there is none.
   *
   * Called from `reserve()` as well as `run()` so the refusal lands before the
   * reservation, not mid-run with credits already locked.
   */
  private pickProvider(aditus: Record<string, unknown>): ChatProviderBinding {
    const usable = this.deps.providers.filter((p) => p.provider.capabilities.chat && p.apiKey)

    const named = typeof aditus.provider === 'string' ? aditus.provider.trim() : ''
    if (named) {
      const match = usable.find((p) => p.provider.id === named)
      if (!match) {
        throw new Error(`muse decompose: no chat provider '${named}' is registered on this deployment`)
      }
      return match
    }

    for (const id of PROVIDER_PREFERENCE) {
      const match = usable.find((p) => p.provider.id === id)
      if (match) return match
    }
    const first = usable[0]
    if (!first) {
      throw new Error('muse decompose: no chat-capable API provider is registered on this deployment')
    }
    return first
  }

  /**
   * Resolve the dataset + captionset named by the aditus into the exact caption
   * work this run will do, refusing anything the job cannot honestly complete.
   *
   * Every media id is checked against the dataset HERE, before the first provider
   * call: a caption whose id does not resolve fails the job outright rather than
   * silently writing its fragments onto some other item.
   *
   * `captions` is what the captionset offers; `work` is what this run would actually
   * pay for — see INCREMENTAL BY DEFAULT in the header. The cap and the reservation
   * are both taken against `work`, because that is what costs.
   */
  private async resolveWork(
    aditus: Record<string, unknown>,
  ): Promise<{
    dataset: Dataset
    captionset: Captionset
    captions: Array<[string, string]>
    work: Array<[string, string]>
  }> {
    const datasetId = String(aditus.dataset ?? '')
    if (!datasetId) throw new Error('muse decompose: `dataset` is required (a dataset id)')
    const captionsetId = String(aditus.captionset ?? '')
    if (!captionsetId) throw new Error('muse decompose: `captionset` is required (a captionset id)')

    const dataset = await this.deps.datasets.find(datasetId)
    if (!dataset) throw new Error(`muse decompose: dataset '${datasetId}' does not exist`)

    const captionset = dataset.captionsets.find((c) => c.id === captionsetId)
    if (!captionset) {
      throw new Error(`muse decompose: captionset '${captionsetId}' is not on dataset '${datasetId}'`)
    }

    // Archived media has left the working set, so a caption bound to an archived item is not
    // decomposed — dropped here rather than rejected below, because an archived id IS on the
    // dataset. An id naming no item at all is still an error (the `known` check further down).
    const archived = new Set(dataset.media.filter(isArchived).map((m) => m.id))

    const captions = Object.entries(captionset.captions ?? {})
      .map(([mediaId, text]) => [mediaId, String(text ?? '').trim()] as [string, string])
      .filter(([, text]) => text.length > 0)
      .filter(([mediaId]) => !archived.has(mediaId))
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))

    if (captions.length === 0) {
      throw new Error(`muse decompose: captionset '${captionsetId}' carries no captions to decompose`)
    }

    const known = new Set(dataset.media.map((m) => m.id))
    for (const [mediaId] of captions) {
      if (!known.has(mediaId)) {
        throw new Error(
          `muse decompose: caption key '${mediaId}' does not name a media item on dataset '${datasetId}'`,
        )
      }
    }

    // What is already decomposed, read off the record the last decompose wrote. An item
    // carrying fragments has been through the extractor; running it again buys the same
    // answer at the same price and overwrites the fragments a user may have curated
    // against. `redo` is the explicit way to ask for exactly that.
    const decomposedIds = new Set(
      dataset.media.filter((m) => (m.fragments?.length ?? 0) > 0).map((m) => m.id),
    )
    const redo = isRedo(aditus.redo)
    const work = redo ? captions : captions.filter(([mediaId]) => !decomposedIds.has(mediaId))

    // A job with nothing left to do is refused before a signum is locked — reserve()
    // reaches this, and a refusal taken any later would hold a reservation for a run
    // that was never going to make a call. See INCREMENTAL BY DEFAULT in the header.
    if (work.length === 0) throw new DecomposeNothingToDoError(datasetId, captionsetId)

    const cap = this.deps.maxCaptions ?? DEFAULT_MAX_DECOMPOSE_CAPTIONS
    if (work.length > cap) {
      throw new Error(
        `muse decompose: this decompose would run ${work.length} captions, above the ${cap}-caption per-job cap`,
      )
    }

    return { dataset, captionset, captions, work }
  }
}

/**
 * One chat call, given a deadline.
 *
 * Two mechanisms, because they answer different questions. The `AbortSignal` tears
 * the request down at the transport so a dead call stops holding a socket; the race
 * is what makes the DECOMPOSE fail on time, and it holds whether or not the injected
 * transport honours a signal. A transport that ignores the signal and answers later
 * has its result discarded — the `catch` on `pending` is there so that late answer
 * cannot surface as an unhandled rejection after the race has already settled.
 */
async function callWithin(
  base: FetchLike,
  url: string,
  init: { method: string; headers: Record<string, string>; body: string },
  timeoutMs: number,
  mediaId: string,
): Promise<{ ok: boolean; status: number; text(): Promise<string> }> {
  const controller = new AbortController()
  let timer: ReturnType<typeof setTimeout> | undefined
  const pending = base(url, { ...init, signal: controller.signal })
  pending.catch(() => {})
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort()
      const where = mediaId ? ` for media item '${mediaId}'` : ''
      reject(new Error(
        `muse decompose: the chat call${where} did not answer within ${Math.round(timeoutMs / 1000)}s`,
      ))
    }, timeoutMs)
  })
  try {
    return await Promise.race([pending, deadline])
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
}

/**
 * Whether the aditus asked for a full re-decompose.
 *
 * Strict by construction, because this is the expensive path: only a real `true` or the
 * strings a form control produces for it turn it on. Anything else — absent, empty,
 * `'false'`, `0`, a stray object — leaves the run incremental. A loose truthiness test
 * here would make `redo: 'no'` decompose the whole set.
 */
function isRedo(value: unknown): boolean {
  if (value === true) return true
  if (typeof value !== 'string') return false
  const v = value.trim().toLowerCase()
  return v === 'true' || v === '1' || v === 'yes'
}

/** One item's validated fragments, in `CATEGORIES` order so a re-run reads the same. */
function flatten(garden: ReturnType<typeof buildGarden>['garden']): Fragment[] {
  const out: Fragment[] = []
  for (const category of CATEGORIES) out.push(...(garden[category] ?? []))
  return out
}

/** Usage tokens reported by an OpenAI-compatible completion body; 0 when absent or unparseable. */
function totalTokens(body: string): number {
  try {
    const parsed = JSON.parse(body) as { usage?: { total_tokens?: unknown } }
    const n = Number(parsed.usage?.total_tokens ?? 0)
    return Number.isFinite(n) && n > 0 ? n : 0
  } catch {
    return 0
  }
}
