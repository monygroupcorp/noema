import type { Cursor, CursorResult } from '../types/cursus.js'
import type { Actum } from '../types/actum.js'
import type { Modus } from '../types/modus.js'
import { isArchived } from '../types/dataset.js'
import type { Captionset, Dataset, Datasets } from '../types/dataset.js'
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
// FOUR PROPERTIES ARE LOAD-BEARING HERE:
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
// Ring rules: `src/crystal` is platform-neutral. Nothing here reads
// `process.env` — provider descriptors and their resolved keys arrive from the
// container, exactly as they do for `ApiCursor`.
// =============================================================================

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
  /** Injected transport — tests pass a fake; production leaves it to global `fetch`. */
  fetchImpl?: FetchLike
  /** Overrides `DEFAULT_MAX_DECOMPOSE_CAPTIONS`. */
  maxCaptions?: number
  /** Overrides `DEFAULT_TOKENS_PER_CAPTION`. */
  tokensPerCaption?: number
}

/**
 * Provider preference when several are registered: OpenRouter first, because it
 * is the one rail that routes to every model family through a single key. An
 * explicit `provider` aditus overrides this, and anything not listed falls to
 * container order.
 */
const PROVIDER_PREFERENCE = ['openrouter', 'openai', 'venice']

export class MuseDecomposeCursor implements Cursor {
  constructor(private readonly deps: MuseDecomposeCursorDeps) {}

  async reserve(modus: Modus, aditus: Record<string, unknown>): Promise<bigint> {
    // Both refusals happen HERE — before the reservation is locked and before any
    // provider call — so an oversized or unservable job costs nothing.
    const binding = this.pickProvider(aditus)
    const { captions } = await this.resolveWork(aditus)

    if (modus.impetusFixum !== undefined) return modus.impetusFixum

    const perCaption = this.deps.tokensPerCaption ?? DEFAULT_TOKENS_PER_CAPTION
    return chatImpetus(captions.length * perCaption, binding.provider.pricing.chatImpetusPer1kTokens)
  }

  async run(actum: Actum): Promise<CursorResult> {
    const aditus = actum.aditus
    // The reservation ActumInceptor locked — the upper bound run() must not exceed.
    const reserved = actum.impetus

    const binding = this.pickProvider(aditus)
    const { dataset, captions } = await this.resolveWork(aditus)

    const trigger = typeof aditus.trigger === 'string' ? aditus.trigger.trim() : ''
    const model = typeof aditus.model === 'string' && aditus.model.trim() ? aditus.model.trim() : undefined

    // Summed real usage across every call this run makes, teed off the response
    // bodies by the wrapper below. `createChatExtractor` returns fragments, not
    // usage, and the metering must be the REAL cost rather than the estimate.
    let tokens = 0
    const base: FetchLike = this.deps.fetchImpl ?? ((url, init) => fetch(url, init) as unknown as ReturnType<FetchLike>)
    const metered: FetchLike = async (url, init) => {
      const res = await base(url, init)
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

    let decomposed = 0
    let written = 0
    for (const [mediaId, caption] of captions) {
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

    const impetus = chatImpetus(tokens, binding.provider.pricing.chatImpetusPer1kTokens)
    return {
      kind: 'sync',
      exitus: {
        exitus: { decomposed, fragments: written },
        impetus: impetus > reserved ? reserved : impetus,
      },
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
   */
  private async resolveWork(
    aditus: Record<string, unknown>,
  ): Promise<{ dataset: Dataset; captionset: Captionset; captions: Array<[string, string]> }> {
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

    const cap = this.deps.maxCaptions ?? DEFAULT_MAX_DECOMPOSE_CAPTIONS
    if (captions.length > cap) {
      throw new Error(
        `muse decompose: captionset '${captionsetId}' carries ${captions.length} captions, above the ${cap}-caption per-job cap`,
      )
    }

    const known = new Set(dataset.media.map((m) => m.id))
    for (const [mediaId] of captions) {
      if (!known.has(mediaId)) {
        throw new Error(
          `muse decompose: caption key '${mediaId}' does not name a media item on dataset '${datasetId}'`,
        )
      }
    }

    return { dataset, captionset, captions }
  }
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
