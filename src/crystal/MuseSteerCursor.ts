import type { Cursor, CursorResult } from '../types/cursus.js'
import type { Actum } from '../types/actum.js'
import type { Modus } from '../types/modus.js'
import type { ApiProvider } from './apiProviders.js'
import { chatImpetus } from './apiProviders.js'
import type { FetchLike } from './muse/garden.js'
import {
  MAX_FLOOR_FRAGMENTS,
  MAX_INSTRUCTION_CHARS,
  parseProposal,
  steerMessages,
  validateProposal,
  type FragmentIdentity,
  type SteerProposal,
} from './muse/steer.js'
import { isCategory } from './muse/taxonomy.js'

// =============================================================================
// MuseSteerCursor — an instruction and a floor in, a proposal out
// =============================================================================
//
// The dispatch half of the steer job (`modus.muse-steer`). It takes an
// instruction and the floor it is about, makes ONE chat call, and returns a
// validated `SteerProposal`.
//
// It is a NORMAL METERED RUN on the chat rail: it reserves a ceiling before the
// first provider call, settles the summed real token cost, appears in run
// history, and has no separate lifecycle and no free lane. Structurally it is
// `MuseDecomposeCursor` — the same rail, the same four load-bearing properties —
// with one more of its own.
//
// FIVE PROPERTIES ARE LOAD-BEARING HERE:
//
//   READ-ONLY — this cursor performs NO SESSION WRITE. It holds no session store
//     and cannot reach one: it is handed a floor and returns a proposal. A steer
//     PROPOSES and never applies; the floor moves only when the user confirms the
//     sheet and the app calls the floor routes that already exist. An interpreter
//     that could write would make the sheet a formality, and the failure would be
//     silent — the tests would pass, the pills would render, and the floor would
//     already have moved.
//
//   NO RESOURCE ID IN THE ADITUS — the floor arrives INLINE and this cursor never
//     receives a session id. `Actum` carries no `animaId` (ownership travels
//     identity-blind through `nullifier` → `signum`), so a cursor cannot resolve
//     an owner; a cursor that took a session id out of the aditus and read it
//     would be unscoped by construction, and for a read-only steer that would put
//     a stranger's floor — their private prompt material — into a proposal
//     returned to the caller. The API layer resolves the session for the
//     authenticated caller and passes the floor it read; this cursor's inputs are
//     values, not references.
//
//   OWN MINISTERIUM — `Cursorum` is a flat Map<ministerium, Cursor> whose
//     `register` is a bare set. Registering this cursor under 'openai' would
//     replace the ApiCursor bound to that key and send every hosted-API chat,
//     image and image-edit dispatch here; registering it under 'musegarden' would
//     take over the decomposer. It owns `'musesteer'` and nothing else.
//
//   CAP BEFORE SPEND — the instruction bound and the floor bound are both checked
//     in `reserve()`, i.e. before the reservation is taken and before the first
//     provider call, so an oversized steer is refused up front rather than
//     discovered part-way through a paid run.
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

/** The ministerium this cursor owns. Never 'openai' and never 'musegarden' — see the header. */
export const MUSE_STEER_MINISTERIUM = 'musesteer'

/**
 * Fixed token estimate used for the RESERVATION only.
 *
 * The steering system prompt is fixed and the instruction is bounded, so the only
 * variable part of one call is the floor. Deliberately generous: the reservation
 * is an upper bound that `run()` settles down to the real usage, so an estimate
 * set low would clamp the settlement and undercharge, while one set high only
 * locks credits for the length of a single call.
 */
export const DEFAULT_STEER_BASE_TOKENS = 900

/** Per-floor-fragment token estimate for the reservation: the fragment in the prompt, and possibly again in the answer. */
export const DEFAULT_TOKENS_PER_FLOOR_FRAGMENT = 24

/** A provider descriptor plus the bearer key the container resolved for it. */
export interface ChatProviderBinding {
  provider: ApiProvider
  apiKey: string
}

export interface MuseSteerCursorDeps {
  /**
   * Hosted-API providers available to this run, in container order. Only entries
   * declaring a `chat` capability and carrying a key are usable; when none is,
   * the cursor refuses (see FAIL CLOSED above).
   */
  providers: ChatProviderBinding[]
  /** Injected transport — tests pass a fake; production leaves it to global `fetch`. */
  fetchImpl?: FetchLike
  /** Overrides `MAX_INSTRUCTION_CHARS`. */
  maxInstructionChars?: number
  /** Overrides `MAX_FLOOR_FRAGMENTS`. */
  maxFloorFragments?: number
  /** Overrides `DEFAULT_STEER_BASE_TOKENS`. */
  baseTokens?: number
  /** Overrides `DEFAULT_TOKENS_PER_FLOOR_FRAGMENT`. */
  tokensPerFloorFragment?: number
}

/**
 * Provider preference when several are registered: OpenRouter first, because it
 * is the one rail that routes to every model family through a single key. An
 * explicit `provider` aditus overrides this, and anything not listed falls to
 * container order.
 */
const PROVIDER_PREFERENCE = ['openrouter', 'openai', 'venice']

export class MuseSteerCursor implements Cursor {
  constructor(private readonly deps: MuseSteerCursorDeps) {}

  async reserve(modus: Modus, aditus: Record<string, unknown>): Promise<bigint> {
    // Both refusals happen HERE — before the reservation is locked and before any
    // provider call — so an oversized or unservable steer costs nothing.
    const binding = this.pickProvider(aditus)
    const { floor } = this.resolveWork(aditus)

    if (modus.impetusFixum !== undefined) return modus.impetusFixum

    const base = this.deps.baseTokens ?? DEFAULT_STEER_BASE_TOKENS
    const perFragment = this.deps.tokensPerFloorFragment ?? DEFAULT_TOKENS_PER_FLOOR_FRAGMENT
    return chatImpetus(base + floor.length * perFragment, binding.provider.pricing.chatImpetusPer1kTokens)
  }

  async run(actum: Actum): Promise<CursorResult> {
    const aditus = actum.aditus
    // The reservation ActumInceptor locked — the upper bound run() must not exceed.
    const reserved = actum.impetus

    const binding = this.pickProvider(aditus)
    const { instruction, floor } = this.resolveWork(aditus)

    const chat = binding.provider.capabilities.chat
    if (!chat) throw new Error('muse steer: the selected provider declares no chat capability')
    const model = typeof aditus.model === 'string' && aditus.model.trim()
      ? aditus.model.trim()
      : chat.defaultModel

    const call: FetchLike = this.deps.fetchImpl
      ?? ((url, init) => fetch(url, init) as unknown as ReturnType<FetchLike>)

    const response = await call(`${binding.provider.baseUrl}${chat.path}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${binding.apiKey}`,
      },
      body: JSON.stringify({
        model,
        temperature: 0.2,
        response_format: { type: 'json_object' },
        messages: steerMessages(instruction, floor),
      }),
    })

    // The body is read ONCE and both the usage tee and the proposal come off that
    // one read: the metering must be the real cost rather than the estimate, and a
    // second read of a consumed body would come back empty.
    const body = await response.text()
    if (!response.ok) {
      throw new Error(`muse steer: chat completion failed (${response.status}): ${body.slice(0, 200)}`)
    }

    // `validateProposal` is the single validation point (`muse/steer.ts`); nothing
    // is filtered here. A malformed or hallucinated answer is normal input — it
    // drops to an empty proposal with the drops counted, rather than throwing and
    // billing the user for a run that produced nothing.
    const proposal: SteerProposal = validateProposal(parseProposal(body), floor)

    const impetus = chatImpetus(totalTokens(body), binding.provider.pricing.chatImpetusPer1kTokens)
    return {
      kind: 'sync',
      exitus: {
        exitus: {
          // The catalog ports: honest counts of what this run produced.
          eliminations: proposal.eliminations.length,
          additions: proposal.additions.length,
          dropped: proposal.dropped,
          // `Exitus.exitus` is a `Record<string, unknown>`, so the typed proposal
          // rides as an OBJECT rather than as JSON stuffed into a string port. The
          // API layer reads it from here and returns it; it is never persisted.
          proposal,
        },
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
        throw new Error(`muse steer: no chat provider '${named}' is registered on this deployment`)
      }
      return match
    }

    for (const id of PROVIDER_PREFERENCE) {
      const match = usable.find((p) => p.provider.id === id)
      if (match) return match
    }
    const first = usable[0]
    if (!first) {
      throw new Error('muse steer: no chat-capable API provider is registered on this deployment')
    }
    return first
  }

  /**
   * Read the instruction and the floor out of the aditus, refusing anything this
   * job cannot honestly do.
   *
   * Both bounds are checked here, and this is called from `reserve()` — an
   * instruction or a floor above the cap is refused BEFORE the reservation and
   * before the first provider call.
   *
   * NOTE what this does NOT do: it takes no id and reads no store. The floor is a
   * value in the aditus, put there by the API layer from the session it resolved
   * for the authenticated caller.
   */
  private resolveWork(
    aditus: Record<string, unknown>,
  ): { instruction: string; floor: FragmentIdentity[] } {
    const instruction = typeof aditus.instruction === 'string' ? aditus.instruction.trim() : ''
    if (!instruction) throw new Error('muse steer: `instruction` is required')

    const maxChars = this.deps.maxInstructionChars ?? MAX_INSTRUCTION_CHARS
    if (instruction.length > maxChars) {
      throw new Error(
        `muse steer: the instruction is ${instruction.length} characters, above the ${maxChars}-character limit`,
      )
    }

    const raw = Array.isArray(aditus.floor) ? (aditus.floor as Array<Record<string, unknown>>) : []
    const floor: FragmentIdentity[] = []
    for (const entry of raw) {
      const category = String(entry?.category ?? '')
      const text = typeof entry?.text === 'string' ? entry.text.trim() : ''
      if (!isCategory(category) || !text) continue
      floor.push({ category, text })
    }
    if (floor.length === 0) throw new Error('muse steer: `floor` is required (the fragments to steer)')

    const maxFloor = this.deps.maxFloorFragments ?? MAX_FLOOR_FRAGMENTS
    if (floor.length > maxFloor) {
      throw new Error(
        `muse steer: the floor carries ${floor.length} fragments, above the ${maxFloor}-fragment per-steer cap`,
      )
    }

    return { instruction, floor }
  }
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
