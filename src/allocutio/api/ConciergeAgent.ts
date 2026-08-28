// =============================================================================
// ConciergeAgent — the bounded, read-only tool-use "brain"
// =============================================================================
//
// Given a user message + conversation history + the caller's context (spicyMode,
// generatio, bindings, an optional prior run for the critique/adjusted case), this
// module runs a BOUNDED (<= maxToolIterations) LLM tool-use loop over EXACTLY the
// twelve READ-ONLY discovery handlers (`list_flows`, `describe_flow`,
// `search_models`/`list_models`, `quote`, `get_run`, `list_runs`, `status`,
// `list_collections`, `get_collection`, `list_studios`, `get_studio`,
// `list_fundamenta`) and emits a discriminated result:
//   - `{ kind: 'proposal', ... }` — a chosen flow + filled/embellished aditus +
//     chosen loras/pinnedModels + an authoritative quote; the critique/ADJUSTED
//     case is the SAME `proposal` kind, distinguished only by an optional
//     `priorRunId` + `delta` note (NOT a third kind), OR
//   - `{ kind: 'reply', text }` — a plain conversational reply (also what the
//     forced closing turn usually produces when the iteration cap is reached).
//
// It is a pure-logic, dependency-injected LEAF: it receives `runToolChat`
// (noema-093 / OpenRouterToolClient) + its transport deps, a `CrystalApi`
// instance, and the caller's context. It has NO runtime caller yet — the HTTP
// `/dicta` endpoint, per-turn metering, and persistence are noema-095 (money-code)
// and out of scope here.
//
// HARD INVARIANTS (the entire risk surface of this module):
//   (a) It NEVER exposes a spend handler to the LLM and never calls a spend method
//       — the tool surface is the twelve read-only handlers only; `run_flow`,
//       `provision_studio`, and `collect` are never registered, and this module
//       never calls `invokeFlow`/`runFlow`/`provisionStudio`/`collect`/`createRun`.
//       (Mechanically enforced by the item's `verify` grep.) It proposes; the user
//       confirms (GO) separately, elsewhere.
//   (b) It NEVER double-applies `generatio.style`: `CrystalApi.applyAccountDefaults`
//       already prepends `style` as `` `${style}, ${prompt}` `` on the dispatch
//       path, so `embellishedPrompt` here is the user's CORE prompt enriched only —
//       the style is never prepended here.
//   (c) It NEVER runs the loop unbounded: `maxToolIterations` is a finite,
//       non-optional cap. Reaching it ends the tool loop and makes EXACTLY ONE
//       closing call with no tool set, so the model answers from the context it
//       already gathered. The closing call cannot invoke a tool and cannot
//       re-enter the loop; a fixed reply covers the case where it errors or comes
//       back empty. Total model calls per turn are therefore at most cap + 1.
// =============================================================================

import type {
  OpenRouterToolClientDeps,
  OpenRouterToolChatOpts,
  OpenRouterChatResult,
  OpenRouterChatMessage,
  OpenRouterToolSpec,
} from './OpenRouterToolClient.js'
import type { CrystalApi } from './CrystalApi.js'
import type { Run } from './types.js'
import type { AuctorKey } from '../../flow/types.js'
import type { Generatio } from '../../types/consuetudo.js'
import type { IntelligensGenus } from '../../types/intelligendi.js'
import {
  listFlowsTool,
  describeFlowTool,
  quoteTool,
  getRunTool,
  listRunsTool,
  statusTool,
  listCollectionsTool,
  getCollectionTool,
  listStudiosTool,
  getStudioTool,
  listFundamentaTool,
  type McpResult,
} from './mcp/tools.js'

// ---------------------------------------------------------------------------
// Loop bound (invariant (c)) — finite and non-optional. Six full round-trips is
// enough for a discover -> describe -> narrow-models -> quote -> propose arc with
// slack for one retry; the cap is the safety net, not the expected path.
// ---------------------------------------------------------------------------
export const maxToolIterations = 6

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** Summed per-turn token usage across every `runToolChat` call in the loop. This is
 *  the exact number noema-095's per-turn metering debits. `promptTokens`/
 *  `completionTokens` are present only if at least one call reported them. */
export interface ConciergeTokenUsage {
  totalTokens: number
  promptTokens?: number
  completionTokens?: number
}

/** The `quote` shape mirrors `CrystalApi.quote` exactly (read-only price estimate). */
export type ConciergeQuote = Awaited<ReturnType<CrystalApi['quote']>>

export interface ConciergeProposal {
  kind: 'proposal'
  /** Explicit flow id, when the agent chose one directly (grounded in `list_flows`). */
  modusId?: string
  /** ...or the resolved verb, when routing by the caller's bindings. One of the two is set. */
  verb?: string
  /** The filled inputs for the chosen flow (post-embellishment; NOT style-prepended). */
  aditus: Record<string, unknown>
  /** Chosen loras / models (intellaId or slug), grounded in `search_models`. */
  pinnedModels: string[]
  /** Authoritative read-only price estimate for THIS proposal's modusId/verb + aditus. */
  quote: ConciergeQuote
  /** The user's CORE prompt enriched with trigger words / detail — style is NOT prepended
   *  here (see invariant (b)). Visible/editable (Fooocus-style transparency), never a silent
   *  DALL-E rewrite. */
  embellishedPrompt: string
  /** Short human-readable justification of the routing/model/embellishment choices. */
  rationale: string
  tokenUsage: ConciergeTokenUsage
  /** Set ONLY on the critique/ADJUSTED case: the prior run being adjusted (from ctx). */
  priorRunId?: string
  /** Set ONLY on the critique/ADJUSTED case: what changed vs the prior run. */
  delta?: string
}

export interface ConciergeReply {
  kind: 'reply'
  text: string
  tokenUsage: ConciergeTokenUsage
}

export type ConciergeResult = ConciergeProposal | ConciergeReply

/** The caller's context for one turn. `spicyMode` is the adult-content gate the model
 *  catalog respects (Q2 seam). `generatio` is informational (style is NOT applied here).
 *  `priorRun` is set only for the critique/adjusted case (owner-scoped, from
 *  `CrystalApi.getRun` -> `toRunDetail`); the agent reasons over its inputs. */
export interface ConciergeContext {
  auctor: AuctorKey
  spicyMode: boolean
  generatio?: Generatio
  /** Owner's verb -> modusId bindings, informational grounding for the model. */
  bindings?: Record<string, string>
  /** Prior turns (already in OpenRouter wire shape); prepended after the system prompt. */
  history?: OpenRouterChatMessage[]
  /** The prior run being critiqued/adjusted, if any. */
  priorRun?: Run
}

/** Injected dependencies. `runToolChat` + `toolClient` are the noema-093 seam; `api`
 *  is the read-only handler backend; `model` overrides the OpenRouter default. */
export interface ConciergeDeps {
  runToolChat: (
    deps: OpenRouterToolClientDeps,
    opts: OpenRouterToolChatOpts,
  ) => Promise<OpenRouterChatResult>
  toolClient: OpenRouterToolClientDeps
  api: CrystalApi
  model?: string
}

// ---------------------------------------------------------------------------
// Tool surface (invariant (a)) — EXACTLY the twelve read-only discovery handlers,
// wrapped as OpenRouterToolSpec[]. `run_flow`/`provision_studio`/`collect` (and any
// other spend method) are DELIBERATELY absent; adding one here would breach the
// item's `verify` grep and the propose-never-spend house rule.
// ---------------------------------------------------------------------------
const TOOL_SPECS: OpenRouterToolSpec[] = [
  {
    type: 'function',
    function: {
      name: 'list_flows',
      description:
        'List the runnable flow catalog (id, name, version, verb-genus, step count). Call this to ' +
        'ground any flow choice in a REAL id — never invent a flow id.',
      parameters: { type: 'object', properties: {}, additionalProperties: false },
    },
  },
  {
    type: 'function',
    function: {
      name: 'describe_flow',
      description:
        "Describe one flow's JSON-Schema inputs/outputs (so you can fill its aditus correctly). " +
        'Pass the flow id from list_flows.',
      parameters: {
        type: 'object',
        properties: { id: { type: 'string', description: 'flow id from list_flows' } },
        required: ['id'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      // Exposed under one name; the executor also accepts `list_models` as an alias.
      name: 'search_models',
      description:
        'Search the model/LoRA catalog (filter by genus, base family, fundamentum, trigger word, or free ' +
        'text). Use this to pick loras/pinnedModels and to read their trigger words before weaving them ' +
        'into the core prompt. The adult-content gate is applied server-side per the turn spicyMode.',
      parameters: {
        type: 'object',
        properties: {
          genus: { type: 'string', description: 'model kind, e.g. lora / checkpoint' },
          basis: { type: 'string', description: 'base model family (compat), e.g. sd15 / flux' },
          fundamentumId: { type: 'string' },
          trigger: { type: 'string', description: 'exact trigger word to match' },
          q: { type: 'string', description: 'free-text search over name/description/tags' },
          limit: { type: 'integer' },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'quote',
      description:
        'Read-only upper-bound price estimate (impetus) for a flow + aditus. Side-effect-free; this ' +
        'NEVER spends. Use it to show the user a cost before they confirm.',
      parameters: {
        type: 'object',
        properties: {
          modusId: { type: 'string' },
          verb: { type: 'string' },
          aditus: { type: 'object', additionalProperties: true },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_run',
      description:
        "Fetch one of the caller's own runs by id — status, outputs, cost, when it ran. Owner-scoped " +
        '(never another owner\'s run). Use this to look up a run the user names or references.',
      parameters: {
        type: 'object',
        properties: { id: { type: 'string', description: 'run id' } },
        required: ['id'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_runs',
      description:
        "List the caller's own settled run history (spend history), newest first, plus their lifetime " +
        'spend total. Owner-scoped. Use this to answer "what did I make recently" or to find a prior run ' +
        'to reference/adjust when the user does not give an exact run id.',
      parameters: {
        type: 'object',
        properties: {
          limit: { type: 'integer', description: 'page size, default 20, max 100' },
          cursor: { type: 'string', description: 'opaque page cursor from a prior list_runs call' },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'status',
      description:
        "The caller's own account snapshot — balance (impetus/usd), in-flight gens, and studios. Call " +
        'this before proposing something the user may not be able to afford, or when asked about balance ' +
        'or what is currently running.',
      parameters: { type: 'object', properties: {}, additionalProperties: false },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_collections',
      description:
        "List the caller's own saved collections (a base flow expanded over a grid of variations). " +
        'Owner-scoped. Use this to answer "what collections do I have" or to find one the user ' +
        'references loosely before calling get_collection.',
      parameters: { type: 'object', properties: {}, additionalProperties: false },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_collection',
      description:
        "Fetch one of the caller's own collections by id. Owner-scoped (never another owner's " +
        'collection). Use this when the user names or references a specific collection.',
      parameters: {
        type: 'object',
        properties: { id: { type: 'string', description: 'collection id' } },
        required: ['id'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_studios',
      description:
        "List the caller's own provisioned studios. Owner-scoped. Use this to answer \"what studios " +
        'do I have running" or to find one the user references loosely before calling get_studio.',
      parameters: { type: 'object', properties: {}, additionalProperties: false },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_studio',
      description:
        "Fetch one of the caller's own studios by id — its state and readiness. Owner-scoped (never " +
        "another owner's studio). Use this when the user names or references a specific studio.",
      parameters: {
        type: 'object',
        properties: { id: { type: 'string', description: 'studio id' } },
        required: ['id'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_fundamenta',
      description:
        'List the compute-substrate catalog (base-model families available to provision a studio ' +
        'against). Use this to ground a studio or model discussion in a REAL fundamentum id — never ' +
        'invent one.',
      parameters: { type: 'object', properties: {}, additionalProperties: false },
    },
  },
]

// ---------------------------------------------------------------------------
// System prompt (Q3 first draft — the exact text is the operator-reserved PR-review
// carve-out, DOCTRINE §4). Encodes the house rules; refine at PR.
//
// PRELOAD-vs-DISCOVER posture (flagged for PR review): this draft does NOT preload
// the flow catalog into the prompt — it instructs the model to DISCOVER via
// `list_flows` in-loop. Rationale: the catalog is small-to-moderate and changes over
// time; keeping discovery in-loop avoids a stale/oversized system prompt and forces
// every flow choice to be grounded in a live tool call (no invented ids). If turn
// latency proves to matter more than freshness, the reviewer may flip this to a
// preloaded catalog block appended below.
// ---------------------------------------------------------------------------
export function buildSystemPrompt(ctx: ConciergeContext): string {
  const spicy = ctx.spicyMode
    ? 'Spicy mode is ON for this caller (adult models/content are permitted where the catalog allows).'
    : 'Spicy mode is OFF: keep to safe-for-work models and content.'
  const style = ctx.generatio?.style
    ? `The caller has a saved default style ("${ctx.generatio.style}"). Do NOT prepend it to the prompt — ` +
      'the run pipeline applies it automatically. Embellish the CORE prompt only.'
    : 'Embellish the CORE prompt only; never prepend a saved style — the run pipeline applies that.'
  const bindings = ctx.bindings && Object.keys(ctx.bindings).length > 0
    ? `The caller has these verb->flow bindings you may route through: ${JSON.stringify(ctx.bindings)}.`
    : 'The caller has no custom verb bindings; route by an explicit flow id from list_flows.'
  const prior = ctx.priorRun
    ? `This is a CRITIQUE/ADJUSTMENT of prior run ${ctx.priorRun.id}. Its stored inputs were ` +
      `${JSON.stringify(ctx.priorRun.aditus ?? {})}` +
      (ctx.priorRun.pinnedModels ? ` with pinnedModels ${JSON.stringify(ctx.priorRun.pinnedModels)}` : '') +
      '. Reason over them and propose an ADJUSTED result, describing what changed in the "delta" field.'
    : ''

  return [
    'You are the concierge for an image/video generation studio. Your job for each turn is to either:',
    '  (1) route the user to ONE typed flow, fill/embellish its inputs, and pick loras/models — emitting a',
    '      structured PROPOSAL, or',
    '  (2) answer conversationally with a plain REPLY when no generation is being requested yet.',
    '',
    'HOUSE RULES:',
    '- You PROPOSE, you never SPEND. You have read-only discovery tools only (list_flows, describe_flow,',
    '  search_models, quote, get_run, list_runs, status, list_collections, get_collection, list_studios,',
    '  get_studio, list_fundamenta). There is NO run/collect/provision tool and you must never claim to',
    '  have run anything — the user confirms (GO) separately, elsewhere.',
    '- You can see the caller\'s own saved collections and provisioned studios (list_collections/',
    '  get_collection, list_studios/get_studio), and the compute-substrate catalog (list_fundamenta). Use',
    '  them to answer questions about what the user has saved or running, or to ground a studio discussion',
    '  in a real fundamentum id — never invent one.',
    '- Ground EVERY flow and model choice in a tool call. Never invent a flow id or a model id/trigger word;',
    '  read them from list_flows / describe_flow / search_models first.',
    '- Read the catalog ONCE, then commit. After you have listed the flows and searched the models you need,',
    '  prefer proposing over searching again: repeating a search you have already run returns the same',
    '  result and spends a step you need for the proposal. If a search comes back thin, propose the best',
    '  available option (or ask ONE specific question) rather than re-querying.',
    '- Reply in the language the user is writing in. Match their language for every reply, rationale, and',
    '  question; the prompt you build for the image/video model stays in English.',
    '- Before finalizing a proposal, call quote so you know the real price. Your rationale MUST state that',
    '  price plainly — the amount and its unit — and briefly say what it buys; never bury or omit the cost.',
    '- Embellishment is VISIBLE and EDITABLE (Fooocus-style transparency), never a silent DALL-E-style rewrite.',
    '  Put your enriched prompt in "embellishedPrompt" so the user can see and edit exactly what changed.',
    `- ${style}`,
    '- When you choose a lora/model, weave its trigger word(s) (from search_models) into embellishedPrompt so',
    '  it actually activates.',
    '- You know the user\'s OWN history and balance — use it, don\'t claim to be blind to it. Call status',
    '  before proposing something that might exceed the caller\'s balance, or when asked about balance or',
    '  what is currently running. Call list_runs to answer "what did I make recently/yesterday" or to find a',
    '  prior run the user references loosely; call get_run when they (or a prior list_runs result) give you',
    '  a specific run id. Use a run you found this way as the basis for an ADJUSTED proposal exactly like the',
    '  prior-run case below.',
    `- ${spicy}`,
    `- ${bindings}`,
    prior,
    '',
    'OUTPUT CONTRACT — your FINAL message (the one with no tool calls) MUST be a single JSON object, no prose',
    'around it, one of:',
    '  {"kind":"proposal","modusId":"<flow id>"|null,"verb":"<verb>"|null,"aditus":{...filled inputs...},',
    '   "pinnedModels":["<intellaId or slug>",...],"embellishedPrompt":"<core prompt enriched, NO style prefix>",',
    '   "rationale":"<why this flow/models/embellishment, stating the price plainly (amount + unit) and what it buys>",',
    '   "delta":"<what changed vs prior run, only when adjusting>"}',
    '  {"kind":"reply","text":"<plain conversational answer>"}',
    'Set exactly one of modusId / verb on a proposal. Do NOT include a "quote" field — the system computes the',
    'authoritative quote for your chosen flow + aditus and attaches it. Do NOT include a "priorRunId" field —',
    'the system sets it from context on the adjust case.',
  ].filter((l) => l !== '').join('\n')
}

// ---------------------------------------------------------------------------
// The close-out instruction for the forced final turn (invariant (c)). Appended
// once, after the tool loop has spent its cap, on a request that carries no tool
// set at all.
// ---------------------------------------------------------------------------
export const FORCED_FINAL_INSTRUCTION = [
  'You have used all of your tool steps for this turn. No more tools are available — this is your',
  'final message and it must answer the user now, from what you have already gathered.',
  'Do not say you ran out of steps and do not ask the user to start over.',
  'If you have enough to route the request, emit the PROPOSAL object using the flow, models, and inputs',
  'you already read; fill any input the user did not specify with a sensible value and say so in the',
  'rationale. If you genuinely cannot route it, emit the REPLY object with the single most useful',
  'question — one question, specific, answerable in a few words.',
  'Reply in the language the user is writing in. Use the same OUTPUT CONTRACT as before: one JSON object,',
  'no prose around it.',
].join('\n')

// ---------------------------------------------------------------------------
// Tool execution — dispatch a named tool call to its read-only handler.
// The `search_models`/`list_models` executor implements the Q2 spicy seam: it calls
// `api.listModels({ ...args, includeAdult: ctx.spicyMode, auctor: ctx.auctor })` DIRECTLY,
// bypassing `listModelsTool`'s wrapper (whose arg type omits `includeAdult`/`auctor`). We do
// not widen the wrapper; the direct call is the chosen seam. Passing `ctx.auctor` unions in
// the caller's own imported models (noema-116) — `listModels` owner-scopes strictly, so a
// caller only ever sees canonical + THEIR OWN, never another owner's private imports.
// ---------------------------------------------------------------------------
function textOf(r: McpResult): string {
  const body = r.content.map((c) => c.text).join('\n')
  return r.isError ? `ERROR ${body}` : body
}

async function executeTool(
  name: string,
  args: Record<string, unknown>,
  deps: ConciergeDeps,
  ctx: ConciergeContext,
): Promise<string> {
  switch (name) {
    case 'list_flows':
      return textOf(await listFlowsTool(deps.api))
    case 'describe_flow':
      return textOf(await describeFlowTool(deps.api, { id: String(args.id ?? '') }))
    case 'search_models':
    case 'list_models': {
      const models = await deps.api.listModels({
        genus: args.genus as IntelligensGenus | undefined,
        basis: args.basis as string | undefined,
        fundamentumId: args.fundamentumId as string | undefined,
        trigger: args.trigger as string | undefined,
        q: args.q as string | undefined,
        limit: args.limit as number | undefined,
        includeAdult: ctx.spicyMode, // Q2 seam
        auctor: ctx.auctor, // noema-116: union in the caller's own imported models
      })
      return JSON.stringify({ models }, null, 2)
    }
    case 'quote':
      return textOf(
        await quoteTool(deps.api, ctx.auctor, {
          modusId: args.modusId as string | undefined,
          verb: args.verb as string | undefined,
          aditus: args.aditus as Record<string, unknown> | undefined,
        }),
      )
    case 'get_run':
      return textOf(await getRunTool(deps.api, ctx.auctor, { id: String(args.id ?? '') }))
    case 'list_runs':
      return textOf(
        await listRunsTool(deps.api, ctx.auctor, {
          limit: args.limit as number | undefined,
          cursor: args.cursor as string | undefined,
        }),
      )
    case 'status':
      return textOf(await statusTool(deps.api, ctx.auctor))
    case 'list_collections':
      return textOf(await listCollectionsTool(deps.api, ctx.auctor))
    case 'get_collection':
      return textOf(await getCollectionTool(deps.api, ctx.auctor, { id: String(args.id ?? '') }))
    case 'list_studios':
      return textOf(await listStudiosTool(deps.api, ctx.auctor))
    case 'get_studio':
      return textOf(await getStudioTool(deps.api, ctx.auctor, { id: String(args.id ?? '') }))
    case 'list_fundamenta':
      return textOf(await listFundamentaTool(deps.api))
    default:
      return `ERROR unknown.tool: ${name} is not an available tool`
  }
}

// ---------------------------------------------------------------------------
// tokenUsage accumulation (sum across every runToolChat call this turn).
// ---------------------------------------------------------------------------
interface UsageAcc {
  totalTokens: number
  promptTokens: number
  completionTokens: number
  hasPrompt: boolean
  hasCompletion: boolean
}

function accumulate(acc: UsageAcc, u: OpenRouterChatResult['tokenUsage']): void {
  acc.totalTokens += u.totalTokens
  if (u.promptTokens !== undefined) {
    acc.promptTokens += u.promptTokens
    acc.hasPrompt = true
  }
  if (u.completionTokens !== undefined) {
    acc.completionTokens += u.completionTokens
    acc.hasCompletion = true
  }
}

function finalizeUsage(acc: UsageAcc): ConciergeTokenUsage {
  return {
    totalTokens: acc.totalTokens,
    ...(acc.hasPrompt ? { promptTokens: acc.promptTokens } : {}),
    ...(acc.hasCompletion ? { completionTokens: acc.completionTokens } : {}),
  }
}

// ---------------------------------------------------------------------------
// Parse the model's final message into a result. Tolerant of a ```json fence.
// ---------------------------------------------------------------------------
function stripFence(s: string): string {
  const t = s.trim()
  const fenced = t.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/)
  return (fenced ? fenced[1] : t).trim()
}

async function finalize(
  content: string,
  usage: UsageAcc,
  deps: ConciergeDeps,
  ctx: ConciergeContext,
): Promise<ConciergeResult> {
  const tokenUsage = finalizeUsage(usage)
  let parsed: unknown
  try {
    parsed = JSON.parse(stripFence(content))
  } catch {
    // Not JSON — treat as a plain conversational reply.
    return { kind: 'reply', text: content, tokenUsage }
  }

  if (typeof parsed !== 'object' || parsed === null) {
    return { kind: 'reply', text: content, tokenUsage }
  }
  const obj = parsed as Record<string, unknown>

  if (obj.kind === 'proposal') {
    const modusId = typeof obj.modusId === 'string' ? obj.modusId : undefined
    const verb = typeof obj.verb === 'string' ? obj.verb : undefined
    const aditus =
      typeof obj.aditus === 'object' && obj.aditus !== null
        ? (obj.aditus as Record<string, unknown>)
        : {}
    // A proposal with no target can't be priced or run — degrade to a reply rather
    // than emitting an unpriceable proposal.
    if (!modusId && !verb) {
      const text = typeof obj.rationale === 'string' ? obj.rationale : content
      return { kind: 'reply', text, tokenUsage }
    }
    // Authoritative quote for the FINAL chosen target + aditus (read-only; direct
    // api.quote call, mirroring the Q2 direct-seam philosophy). If pricing fails, we
    // cannot honestly present a proposal — fall back to a reply.
    let quote: ConciergeQuote
    try {
      quote = await deps.api.quote(ctx.auctor, { modusId, verb }, aditus)
    } catch (e) {
      return {
        kind: 'reply',
        text: `I found a flow for that but couldn't price it: ${String(e)}`,
        tokenUsage,
      }
    }
    const pinnedModels = Array.isArray(obj.pinnedModels)
      ? obj.pinnedModels.filter((m): m is string => typeof m === 'string')
      : []
    // Pre-GO resolvability check (noema-113): the price/quote path never receives pinnedModels, so
    // nothing else verifies the concierge's picks compile. Run each through the SAME normalizer the
    // run path uses; if any is unresolvable/forbidden, do NOT emit a GO-able proposal — degrade to a
    // reply so the pick becomes a caught, re-proposable error instead of a paid 500 on GO.
    if (pinnedModels.length > 0) {
      try {
        await deps.api.resolvePinnedModels(ctx.auctor, pinnedModels)
      } catch (e) {
        return {
          kind: 'reply',
          text:
            `I lined up a model for that, but it isn't available to run (${String(e)}). ` +
            'Tell me a bit more about the look you want and I\'ll pick a different one.',
          tokenUsage,
        }
      }
    }
    return {
      kind: 'proposal',
      ...(modusId ? { modusId } : {}),
      ...(verb ? { verb } : {}),
      aditus,
      pinnedModels,
      quote,
      embellishedPrompt: typeof obj.embellishedPrompt === 'string' ? obj.embellishedPrompt : '',
      rationale: typeof obj.rationale === 'string' ? obj.rationale : '',
      tokenUsage,
      // priorRunId comes from CONTEXT (the real prior run), never the model.
      ...(ctx.priorRun ? { priorRunId: ctx.priorRun.id } : {}),
      ...(typeof obj.delta === 'string' ? { delta: obj.delta } : {}),
    }
  }

  if (obj.kind === 'reply' && typeof obj.text === 'string') {
    return { kind: 'reply', text: obj.text, tokenUsage }
  }

  // Recognized JSON but not our contract — surface it as a reply verbatim.
  return { kind: 'reply', text: content, tokenUsage }
}

// ---------------------------------------------------------------------------
// The bounded tool-use loop (invariant (c)).
// ---------------------------------------------------------------------------
export async function runConcierge(
  deps: ConciergeDeps,
  ctx: ConciergeContext,
  userMessage: string,
): Promise<ConciergeResult> {
  const messages: OpenRouterChatMessage[] = [
    { role: 'system', content: buildSystemPrompt(ctx) },
    ...(ctx.history ?? []),
    { role: 'user', content: userMessage },
  ]

  const usage: UsageAcc = {
    totalTokens: 0,
    promptTokens: 0,
    completionTokens: 0,
    hasPrompt: false,
    hasCompletion: false,
  }

  for (let iteration = 0; iteration < maxToolIterations; iteration++) {
    const result = await deps.runToolChat(deps.toolClient, {
      ...(deps.model !== undefined ? { model: deps.model } : {}),
      messages,
      tools: TOOL_SPECS,
    })
    accumulate(usage, result.tokenUsage)

    if (result.toolCalls?.length) {
      // Record the assistant turn that requested the tools (multi-turn history shape),
      // then answer EVERY tool_call_id — including a parse failure, which becomes a
      // tool-role error message so the model can retry within the bound (DOCTRINE §2:
      // never silently guess unparseable arguments, never let a parse error throw the loop).
      // The client's `result.toolCalls` is the FRIENDLY parsed shape
      // ({id, name, arguments} — OpenRouterToolClient.ts) it hands back for the
      // agent's convenience. The next request's assistant message must instead
      // carry the OpenAI/OpenRouter WIRE shape ({id, type: 'function', function:
      // {name, arguments}}) — the same shape `tools[]` already sends on the
      // request. Echoing the friendly shape back verbatim is what 400s every
      // real turn (`messages[].tool_calls[].type` missing); convert here.
      messages.push({
        role: 'assistant',
        content: result.content ?? '',
        tool_calls: result.toolCalls.map((tc) => ({
          id: tc.id,
          type: 'function' as const,
          function: { name: tc.name, arguments: tc.arguments },
        })) as unknown as OpenRouterChatMessage['tool_calls'],
      })
      for (const tc of result.toolCalls) {
        let parsedArgs: Record<string, unknown>
        try {
          parsedArgs = tc.arguments ? (JSON.parse(tc.arguments) as Record<string, unknown>) : {}
        } catch {
          messages.push({
            role: 'tool',
            tool_call_id: tc.id,
            content: `ERROR arguments.unparseable: the arguments you sent for "${tc.name}" were not valid JSON; resend valid JSON.`,
          })
          continue
        }
        const out = await executeTool(tc.name, parsedArgs, deps, ctx)
        messages.push({ role: 'tool', tool_call_id: tc.id, content: out })
      }
      continue
    }

    // No tool calls → this is the model's final answer.
    return finalize(result.content ?? '', usage, deps, ctx)
  }

  // Iteration cap reached (invariant (c)). The tool loop is over, but the context
  // gathered inside it — catalog reads, quotes, the user's own stated choice — is the
  // work of the turn and is what an answer should be built from. Make EXACTLY ONE more
  // model call with NO tool set and an explicit close-out instruction, and return its
  // answer through the normal `finalize` path. This call is outside the loop: it cannot
  // re-enter it, and with `tools` omitted from the request there is no tool for it to
  // invoke, so the bound holds at cap + 1 calls.
  messages.push({ role: 'system', content: FORCED_FINAL_INSTRUCTION })

  try {
    const closing = await deps.runToolChat(deps.toolClient, {
      ...(deps.model !== undefined ? { model: deps.model } : {}),
      messages,
      // `tools` is DELIBERATELY omitted — the client sends no `tools` key at all when it
      // is undefined, so the closing call has no tool surface. Any `toolCalls` on the
      // response are ignored; they are never executed.
    })
    accumulate(usage, closing.tokenUsage)
    const content = closing.content ?? ''
    if (content.trim() !== '') {
      return finalize(content, usage, deps, ctx)
    }
  } catch {
    // Fall through to the fixed reply below.
  }

  // The closing call errored or returned nothing to say: a fixed reply, so the turn
  // always terminates with something addressed to the user.
  return {
    kind: 'reply',
    text:
      "I wasn't able to settle on a concrete proposal for that in the allotted steps. Could you give me a " +
      'bit more detail about what you want to make?',
    tokenUsage: finalizeUsage(usage),
  }
}
