import type { Flow, FlowContext, Step, Resolution, PrimitiveEvent, Primitive } from '../types.js'
import type { Modorum } from '../../types/modus.js'
import type { ModelRef } from '../../types/actum.js'
import { validateAditus } from '../../execution/validateAditus.js'
import type { Signorum } from '../../types/significandi.js'
import type { Actorum, ActumCompletor, Cursorum } from '../../types/cursus.js'
import type { ActumInceptor } from '../../execution/ActumInceptor.js'
import { classifyError } from '../../lib/classifyError.js'
import { withTrace, getTrace, makeTraceContext } from '../../lib/trace.js'

// ---------------------------------------------------------------------------
// ExecuteFlow state types
// ---------------------------------------------------------------------------

type ExecuteStep =
  | 'SELECT_MODE'
  | 'SELECT_CATEGORY'
  | 'BROWSE_TOOLS'
  | 'CONFIGURE'
  | 'AWAITING_COMPLETION'
  | 'RESULT'

interface ExecuteFlowState {
  step: ExecuteStep
  mode?: 'create' | 'effect'
  category?: string
  modusId?: string
  aditus: Record<string, unknown>
  actumId?: string
  result?: Record<string, unknown>
  browsePageIndex: number
  priorMessages?: Array<{ role: 'user' | 'assistant'; content: string }>
  /** Deep-link routing hint from a /start pod_<token>; consumed by the inceptor. */
  shareTokenHint?: string
  /**
   * Models the host queued onto the session loadout via `Mod • → Add`. Passed to the
   * inceptor at submit (first-class, alongside shareTokenHint) → stored on the Actum →
   * unioned into `spec.models` by the Compiler. `dest` is a fallback the Compiler
   * overrides from the resolved Intella.
   */
  pinnedModels?: ModelRef[]
}

// ---------------------------------------------------------------------------
// ExecuteFlowDeps
// ---------------------------------------------------------------------------

export interface ExecuteFlowDeps {
  modorum: Modorum
  signorum: Signorum
  actorum: Actorum
  completor: ActumCompletor
  cursorum: Cursorum
  inceptor: { initiate: ActumInceptor['initiate'] }
  /**
   * Optional per-anima aggregation index. When present + the runner has an
   * animaId, we record the dispatched actum so `/status` can list YOUR GENS
   * without ever touching the modo/actum row's identity (privacy invariant
   * stays intact — see `src/types/actumIndex.ts`). Commitment runs skip.
   */
  actumIndex?: import('../../types/actumIndex.js').ActumIndexStore
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const PAGE_SIZE = 5

const CREATE_CATEGORIES = [
  { id: 'image', label: 'Image', description: 'Generate images with AI' },
  { id: 'sound', label: 'Sound', description: 'Generate audio and music' },
  { id: 'text', label: 'Text', description: 'Generate text and stories' },
  { id: 'movie', label: 'Movie', description: 'Generate video content' },
]

const EFFECT_CATEGORIES = [
  { id: 'image', label: 'Image', description: 'Transform existing images' },
  { id: 'caption', label: 'Caption', description: 'Generate captions from images' },
  { id: 'video', label: 'Video', description: 'Apply video effects' },
  { id: 'sound', label: 'Sound', description: 'Apply audio effects' },
]

// ---------------------------------------------------------------------------
// ExecuteFlow
// ---------------------------------------------------------------------------

export class ExecuteFlow implements Flow {
  readonly intent = 'execute' as const

  constructor(private readonly deps: ExecuteFlowDeps) {}

  // ── enter ─────────────────────────────────────────────────────────────────

  async enter(ctx: FlowContext): Promise<Step> {
    const existing = ctx.state as Partial<ExecuteFlowState> | undefined

    // Pre-filled shortcut: modusId + non-empty aditus → validate and submit directly
    if (existing?.modusId && existing.aditus && Object.keys(existing.aditus as Record<string, unknown>).length > 0 && !Array.isArray((existing.aditus as Record<string, unknown>).messages)) {
      const state: ExecuteFlowState = {
        step: 'CONFIGURE',
        modusId: existing.modusId,
        aditus: {},
        browsePageIndex: 0,
        mode: existing.mode,
        category: existing.category,
        ...(existing.pinnedModels ? { pinnedModels: existing.pinnedModels } : {}),
      }
      ctx.state = state
      const modus = await this._resolveModus(state)
      state.aditus = validateAditus(modus.aditus, existing.aditus as Record<string, unknown>)
      return this._submit(ctx, state) as Promise<Step>
    }

    // Conversational reply shortcut: modusId + messages[] already set → skip form, submit directly
    if (existing?.modusId && Array.isArray(existing.aditus?.messages)) {
      const state: ExecuteFlowState = {
        step: 'CONFIGURE',
        modusId: existing.modusId,
        aditus: existing.aditus ?? {},
        browsePageIndex: existing.browsePageIndex ?? 0,
        mode: existing.mode,
        category: existing.category,
      }
      ctx.state = state
      return this._submit(ctx, state) as Promise<Step>
    }

    // Direct entry with modusId pre-set (spell shortcut)
    if (existing?.modusId) {
      const state: ExecuteFlowState = {
        step: 'CONFIGURE',
        modusId: existing.modusId,
        aditus: existing.aditus ?? {},
        browsePageIndex: 0,
        mode: existing.mode,
        category: existing.category,
        ...(existing.pinnedModels ? { pinnedModels: existing.pinnedModels } : {}),
      }
      ctx.state = state
      return this._buildConfigureStep(state)
    }

    // Fresh entry
    const state: ExecuteFlowState = {
      step: 'SELECT_MODE',
      aditus: {},
      browsePageIndex: 0,
    }
    ctx.state = state
    return this._buildSelectModeStep()
  }

  // ── handle ────────────────────────────────────────────────────────────────

  async handle(ctx: FlowContext, event: PrimitiveEvent): Promise<Step | Resolution> {
    const state = ctx.state as ExecuteFlowState

    switch (state.step) {
      case 'SELECT_MODE':      return this._handleSelectMode(ctx, state, event)
      case 'SELECT_CATEGORY':  return this._handleSelectCategory(ctx, state, event)
      case 'BROWSE_TOOLS':     return this._handleBrowseTools(ctx, state, event)
      case 'CONFIGURE':        return this._handleConfigure(ctx, state, event)
      case 'AWAITING_COMPLETION': return this._buildWaitingStep()
      case 'RESULT':           return this._handleResult(ctx, state, event)
      default:
        return { kind: 'complete' }
    }
  }

  // ── handleCompletion (public — called by FlowRouter) ──────────────────────

  async handleCompletion(
    ctx: FlowContext,
    result: { kind: 'complete'; exitus: Record<string, unknown> } | { kind: 'failed'; error: string }
  ): Promise<Step | Resolution> {
    const state = ctx.state as ExecuteFlowState
    ctx.pendingActumId = undefined

    if (result.kind === 'complete') {
      state.step = 'RESULT'
      state.result = result.exitus
      const opts = this._buildReplyOpts(state, result.exitus)
      return this._buildResultStep(result.exitus, state.actumId ?? '', opts)
    } else {
      return {
        primitives: [{
          kind: 'Detail',
          label: 'Generation failed',
          content: classifyError(result.error),
          actions: [{ id: 'run_again', label: 'Try again' }],
        }],
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Private step handlers
  // ---------------------------------------------------------------------------

  private _handleSelectMode(ctx: FlowContext, state: ExecuteFlowState, event: PrimitiveEvent): Step | Resolution {
    if (event.kind !== 'select') return this._buildSelectModeStep()

    const mode = event.selectedId as 'create' | 'effect'
    state.mode = mode
    state.step = 'SELECT_CATEGORY'

    const categories = mode === 'create' ? CREATE_CATEGORIES : EFFECT_CATEGORIES
    return {
      primitives: [{
        kind: 'Select',
        label: 'Choose a category',
        options: categories,
      }],
    }
  }

  private async _handleSelectCategory(ctx: FlowContext, state: ExecuteFlowState, event: PrimitiveEvent): Promise<Step | Resolution> {
    if (event.kind !== 'select') return { primitives: [{ kind: 'Select', label: 'Choose a category', options: [] }] }

    state.category = event.selectedId
    state.step = 'BROWSE_TOOLS'
    state.browsePageIndex = 0

    return this._buildBrowseStep(state)
  }

  private async _handleBrowseTools(ctx: FlowContext, state: ExecuteFlowState, event: PrimitiveEvent): Promise<Step | Resolution> {
    if (event.kind !== 'paginate') return this._buildBrowseStep(state)

    if (event.action === 'select') {
      const selectedId = event.selectedId
      if (!selectedId) return this._buildBrowseStep(state)

      state.modusId = selectedId
      state.step = 'CONFIGURE'
      return this._buildConfigureStep(state)
    }

    if (event.action === 'next') {
      state.browsePageIndex = state.browsePageIndex + 1
    } else if (event.action === 'prev') {
      state.browsePageIndex = Math.max(0, state.browsePageIndex - 1)
    }

    return this._buildBrowseStep(state)
  }

  private async _handleConfigure(ctx: FlowContext, state: ExecuteFlowState, event: PrimitiveEvent): Promise<Step | Resolution> {
    // Accept plain text as the value for the first unfilled required field
    let formValues: Record<string, unknown>
    if (event.kind === 'form') {
      formValues = event.values
    } else if (event.kind === 'prompt') {
      const modus = await this._resolveModus(state)
      const firstRequired = Object.entries(modus.aditus).find(([k, p]) => p.required && !(k in state.aditus))
      if (!firstRequired) return this._buildConfigureStep(state)
      formValues = { [firstRequired[0]]: event.text }
    } else {
      return this._buildConfigureStep(state)
    }

    // Merge form values into aditus, then validate and strip against schema
    const modus = await this._resolveModus(state)
    const validated = validateAditus(modus.aditus, { ...state.aditus, ...formValues })
    state.aditus = validated

    // Balance check — skipped in dev when DEV_FREE_EXECUTION is set
    const balance = await this.deps.signorum.balance(ctx.identity)
    const cursor = this.deps.cursorum.resolve(modus)
    const reservation = await cursor.reserve(modus, state.aditus)

    if (balance < reservation && !process.env.DEV_FREE_EXECUTION) {
      return {
        primitives: [{
          kind: 'Detail',
          label: 'Insufficient balance',
          content: `This tool costs ${reservation} but your balance is ${balance}.\n\nTop up to continue.`,
          actions: [
            { id: 'connect_wallet', label: 'connect wallet' },
            { id: 'buy_credits',    label: 'buy credits'   },
            { id: 'cancel',         label: '✕'             },
          ],
        }],
      }
    }

    return this._submit(ctx, state)
  }

  private _handleResult(ctx: FlowContext, state: ExecuteFlowState, event: PrimitiveEvent): Step | Resolution | Promise<Step | Resolution> {
    if (event.kind === 'prompt') {
      if (state.priorMessages && state.priorMessages.length > 0) {
        // Text conversation continuation
        state.aditus = {
          ...state.aditus,
          messages: [...state.priorMessages, { role: 'user' as const, content: event.text }],
        }
        return this._submit(ctx, state)
      }
      // Non-conversation result (image, etc.) — restart
      state.step = 'SELECT_MODE'
      state.modusId = undefined
      state.category = undefined
      state.mode = undefined
      state.aditus = {}
      state.result = undefined
      state.priorMessages = undefined
      state.browsePageIndex = 0
      return this._buildSelectModeStep()
    }

    if (event.kind !== 'action') return this._buildResultStep(state.result ?? {}, state.actumId ?? '')

    switch (event.actionId) {
      case 'run_again':
        // Reset to SELECT_MODE
        state.step = 'SELECT_MODE'
        state.modusId = undefined
        state.category = undefined
        state.mode = undefined
        state.aditus = {}
        state.result = undefined
        state.priorMessages = undefined
        state.browsePageIndex = 0
        return this._buildSelectModeStep()

      case 'rate':
        return { kind: 'complete', output: { rated: true } }

      default:
        return { kind: 'complete' }
    }
  }

  // ---------------------------------------------------------------------------
  // SUBMIT logic
  // ---------------------------------------------------------------------------

  private async _submit(ctx: FlowContext, state: ExecuteFlowState): Promise<Step | Resolution> {
    const { inceptor, modorum, cursorum, completor } = this.deps

    // 1. Initiate — balance check + lock signa + create Actum. Pinned models (Mod • → Add)
    // ride a first-class field alongside shareTokenHint → stored on the Actum → unioned into
    // spec.models by the Compiler. (Not smuggled through aditus — validateAditus would strip it.)
    const actum = await inceptor.initiate({
      modusId: state.modusId!,
      aditus: state.aditus,
      by: ctx.identity,
      modoId: ctx.modoId,
      ...(state.shareTokenHint ? { shareTokenHint: state.shareTokenHint } : {}),
      ...(state.pinnedModels?.length ? { pinnedModels: state.pinnedModels } : {}),
    })

    state.actumId = actum.id

    // 1b. ActumIndex — both identified and anonymous runs append to the per-
    // AuctorKey aggregation so `/status` can list YOUR GENS for either side.
    // Indexing a commitment doesn't leak: every spend already carries the
    // commitment as the arcanum signum's `testis`. The remove site is the
    // completion webhook (terminal status clears the entry).
    if (this.deps.actumIndex) {
      const branch = 'animaId' in ctx.identity
        ? { animaId:    ctx.identity.animaId }
        : { commitment: ctx.identity.commitment }
      void this.deps.actumIndex.record({
        ...branch,
        actumId:  actum.id,
        modusId:  actum.modusId,
        createdAt: actum.inceptum,
      }).catch(() => {})
    }

    // 2. Resolve modus and cursor
    const modus = await modorum.find(actum.modusId, actum.modusVersiono)
    if (!modus) throw new Error(`Modus '${actum.modusId}' not found after initiation`)

    const cursor = cursorum.resolve(modus)

    // 3. Run — propagate identity + actum id through the trace context so the
    // cursor (and anything downstream) can read them without putting identity on
    // any durable schema (Materia/Modo/Actum stay identity-blind). The auctor key
    // is a union — identified (animaId) or anonymous arcanum (commitment); we
    // carry both sides as separate optional fields, at most one set.
    const animaId    = 'animaId'    in ctx.identity ? ctx.identity.animaId    : undefined
    const commitment = 'commitment' in ctx.identity ? ctx.identity.commitment : undefined
    const cursorResult = await withTrace(
      makeTraceContext({ ...getTrace(), animaId, commitment, actumId: actum.id }),
      () => cursor.run(actum),
    )

    if (cursorResult.kind === 'sync') {
      // 4a. Sync: complete immediately
      const completed = await completor.complete(actum, cursorResult.exitus)
      state.step = 'RESULT'
      state.result = completed.exitus ?? {}
      const opts = this._buildReplyOpts(state, state.result)
      return this._buildResultStep(state.result, actum.id, opts)
    } else {
      // 4b. Async: set waiting state
      state.step = 'AWAITING_COMPLETION'
      ctx.pendingActumId = actum.id
      return {
        primitives: [{
          kind: 'Stream',
          label: 'Executing…',
          actumId: actum.id,
          status: 'running',
        }],
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Step builders
  // ---------------------------------------------------------------------------

  private _buildSelectModeStep(): Step {
    return {
      primitives: [{
        kind: 'Select',
        label: 'What do you want to do?',
        options: [
          { id: 'create', label: 'Create', description: 'Generate something new' },
          { id: 'effect', label: 'Effect', description: 'Transform existing content' },
        ],
      }],
    }
  }

  private async _buildBrowseStep(state: ExecuteFlowState): Promise<Step> {
    const all = await this.deps.modorum.list({ genus: 'atomicus' })
    // Since Modus doesn't have a category field, we return all atomicus for now
    const items = all.map(m => ({ id: m.id, label: m.nomen, description: m.ministerium }))
    const totalPages = Math.max(1, Math.ceil(items.length / PAGE_SIZE))
    const page = state.browsePageIndex
    const pageItems = items.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE)

    return {
      primitives: [{
        kind: 'Paginate',
        label: 'Choose a tool',
        items: pageItems,
        page,
        totalPages,
      }],
    }
  }

  private async _buildConfigureStep(state: ExecuteFlowState): Promise<Step> {
    const modus = await this._resolveModus(state)

    const fields = Object.entries(modus.aditus).map(([key, porta]) => ({
      key,
      label: porta.description ?? key,
      type: porta.type,
      required: porta.required ?? false,
      default: porta.default,
    }))

    return {
      primitives: [{
        kind: 'Form',
        label: `Configure ${modus.nomen}`,
        fields,
      }],
    }
  }

  private _buildResultStep(
    result: Record<string, unknown>,
    actumId = '',
    _opts?: {
      modusId?: string
      priorMessages?: Array<{ role: 'user' | 'assistant'; content: string }>
    }
  ): Step {
    // Detect media URLs by key convention: keys ending in 'Url', 'url', or 'imageUrl'
    const mediaEntries = Object.entries(result).filter(([k]) =>
      k.toLowerCase().endsWith('url')
    )

    const media = mediaEntries.map(([k, v]) => ({
      url: String(v),
      type: k.toLowerCase().includes('video') ? 'video' as const
          : k.toLowerCase().includes('audio') ? 'audio' as const
          : 'image' as const,
    }))

    // Text content: anything that is not a URL
    const textEntries = Object.entries(result).filter(([k]) =>
      !k.toLowerCase().endsWith('url')
    )
    const textContent = textEntries.length > 0
      ? textEntries.map(([k, v]) => `${k}: ${String(v)}`).join('\n')
      : undefined

    return {
      primitives: [{
        kind: 'Result',
        actumId,
        label: 'Result',
        media: media.length > 0 ? media : undefined,
        textContent,
        actions: [
          { id: 'rate_beautiful', label: '😻' },
          { id: 'rate_funny',     label: '😹' },
          { id: 'rate_negative',  label: '😿' },
          { id: 'info',           label: 'ℹ' },
          { id: 'tweak',          label: '✎ Tweak' },
          { id: 'rerun',          label: '↻ Rerun' },
        ],
      }],
    }
  }

  private _buildWaitingStep(): Step {
    return {
      primitives: [{
        kind: 'Prompt',
        label: 'Working…',
        placeholder: 'Your result will appear shortly.',
      }],
    }
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  /**
   * Build conversation history (priorMessages) after a text result and persist it to state.
   * Only builds for text-only results (no URL keys). Returns undefined for media results,
   * leaving state.priorMessages unset.
   */
  private _buildReplyOpts(
    state: ExecuteFlowState,
    result: Record<string, unknown>
  ): { modusId?: string; priorMessages?: Array<{ role: 'user' | 'assistant'; content: string }> } | undefined {
    if (!state.modusId) return undefined

    // Extract raw text from result (for text-only cursor responses)
    const textEntries = Object.entries(result).filter(([k]) => !k.toLowerCase().endsWith('url'))
    if (textEntries.length === 0) return { modusId: state.modusId }

    const rawText = String(result.response ?? Object.values(result)[0] ?? '')

    // Build priorMessages: continuation (messages already in aditus) or first turn
    let priorMessages: Array<{ role: 'user' | 'assistant'; content: string }>
    if (Array.isArray(state.aditus.messages)) {
      const existing = state.aditus.messages as Array<{ role: 'user' | 'assistant'; content: string }>
      priorMessages = [...existing, { role: 'assistant', content: rawText }]
    } else {
      const userPrompt = String(state.aditus.prompt ?? '')
      priorMessages = [
        { role: 'user', content: userPrompt },
        { role: 'assistant', content: rawText },
      ]
    }

    // Persist to state so RESULT+prompt handler can continue the conversation
    state.priorMessages = priorMessages

    return { modusId: state.modusId, priorMessages }
  }

  private async _resolveModus(state: ExecuteFlowState) {
    const modus = await this.deps.modorum.find(state.modusId!)
    if (!modus) throw new Error(`Modus '${state.modusId}' not found`)
    return modus
  }
}
