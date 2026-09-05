import type { Flow, FlowContext, Step, Resolution, PrimitiveEvent, Primitive } from '../types.js'
import type { Modorum, Forma } from '../../types/modus.js'
import type { ModelRef } from '../../types/actum.js'
import { validateAditus } from '../../execution/validateAditus.js'
import { ownedAditusVerdict, type OwnedResourceStores } from '../../execution/ownedAditusGuard.js'
import type { Signorum } from '../../types/significandi.js'
import type { Actorum, ActumCompletor, Cursorum } from '../../types/cursus.js'
import type { ActumInceptor } from '../../execution/ActumInceptor.js'
import { classifyError } from '../../lib/classifyError.js'
import { dispatchInceptio } from '../../execution/dispatchInceptio.js'

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
  /**
   * The flow-card "editing field" marker. When set (via an `a:edit_<key>` tap),
   * the next `prompt`/photo reply fills THIS field rather than the next unfilled
   * required one (the hot-path default). Cleared once the field is filled.
   */
  editingField?: string
  /**
   * Entry media sourced from the Telegram envelope (attached or replied-to photo,
   * video, clip or file). Mapped onto the first Porta of the matching type in `enter`,
   * so the media is neither re-requested (gap-fill) nor shown as unfilled (card).
   * A parameter, not new vocabulary.
   */
  entryMediaUrl?: string
  /** The Porta type `entryMediaUrl` fills: 'image', 'video' or 'audio'. */
  entryMediaType?: string
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
  /** Compositus engine (ADR-0008) — passed straight through to dispatchInceptio so
   *  /run can cast a compositus (spell) modus. Absent → compositus modi throw. */
  compositusCursor?: import('../../execution/dispatchInceptio.js').DispatchDeps['compositusCursor']
  /**
   * The stores a declared owned-resource reference resolves through. `/run` can cast any
   * canonical atomic modus, three of which take the id of a stored, owner-bearing record, and
   * this flow is the last seam that still knows who is casting. Absent → every declared
   * reference is refused, the same fail-closed rule the REST run route follows.
   */
  ownedResources?: OwnedResourceStores
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

    // Entry with modusId pre-set (slash command / spell shortcut). One CONFIGURE
    // state, three presentations keyed on how much of the *required* aditus is
    // already satisfied:
    //   • complete  → fast-path submit (no card)        — /make a cat
    //   • partial   → sequential gap-fill prompt         — fill the next required field
    //   • empty     → the flow card                      — bare /make, /run <flow>
    if (existing?.modusId) {
      const state: ExecuteFlowState = {
        step: 'CONFIGURE',
        modusId: existing.modusId,
        aditus: { ...(existing.aditus ?? {}) },
        browsePageIndex: existing.browsePageIndex ?? 0,
        mode: existing.mode,
        category: existing.category,
        ...(existing.pinnedModels ? { pinnedModels: existing.pinnedModels } : {}),
        ...(existing.shareTokenHint ? { shareTokenHint: existing.shareTokenHint } : {}),
      }
      ctx.state = state
      const modus = await this._resolveModus(state)

      // Map envelope-borne entry media onto the first Porta of its own type, so it counts
      // as filled (neither re-requested nor shown as unfilled). A video does not belong in
      // an image Porta, so a modus with no Porta of that type ignores the media entirely.
      if (existing.entryMediaUrl && existing.entryMediaType) {
        const key = Object.entries(modus.aditus).find(([, p]) => p.type === existing.entryMediaType)?.[0]
        if (key && !(key in state.aditus)) {
          state.aditus[key] = existing.entryMediaUrl
        }
      }

      const hadAnyAditus = Object.keys(state.aditus).length > 0

      // Cold entry — nothing given → the flow card. Surface every Porta; the user
      // tweaks fields and taps Execute once all required have a value.
      if (!hadAnyAditus) {
        return this._buildConfigureStep(state)
      }

      // Required-complete → fast-path submit. We validate-and-strip first so the
      // submitted aditus is canonical (defaults applied, unknowns dropped).
      if (this._requiredSatisfied(modus.aditus, state.aditus)) {
        state.aditus = validateAditus(modus.aditus, state.aditus)
        return this._submit(ctx, state) as Promise<Step>
      }

      // Partial — some aditus given but a required field is still missing →
      // sequential gap-fill (prompt for the next unfilled required field, not the card).
      return this._buildConfigureStep(state, false)
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

  /** True when every required Porta has a value in `aditus` (or a schema default). */
  private _requiredSatisfied(schema: Forma, aditus: Record<string, unknown>): boolean {
    return Object.entries(schema).every(([key, porta]) =>
      !porta.required || key in aditus || porta.default !== undefined
    )
  }

  // ── handle ────────────────────────────────────────────────────────────────

  async handle(ctx: FlowContext, event: PrimitiveEvent): Promise<Step | Resolution> {
    const state = ctx.state as ExecuteFlowState

    switch (state.step) {
      case 'SELECT_MODE':      return this._handleSelectMode(ctx, state, event)
      case 'SELECT_CATEGORY':  return this._handleSelectCategory(ctx, state, event)
      case 'BROWSE_TOOLS':     return this._handleBrowseTools(ctx, state, event)
      case 'CONFIGURE':        return this._handleConfigure(ctx, state, event)
      case 'AWAITING_COMPLETION':
        // Free text sent while a run is in flight isn't addressed to this
        // flow — stay silent, the result posts on its own when it lands. A
        // deliberate tap/submit on this flow's own controls still gets the
        // waiting acknowledgement.
        return event.kind === 'prompt' ? { primitives: [] } : this._buildWaitingStep()
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
    const modus = await this._resolveModus(state)

    // ── Flow-card actions ───────────────────────────────────────────────────
    if (event.kind === 'action') {
      // Tap a field's edit button → mark which field the next reply fills, then
      // ask for it (force-reply / send-a-photo). The card render mechanism reuses
      // the same input path the gap-fill walks.
      if (event.actionId.startsWith('edit_')) {
        const key = event.actionId.slice('edit_'.length)
        if (key in modus.aditus) {
          state.editingField = key
          const porta = modus.aditus[key]
          const label = porta.description ?? porta.label ?? key
          const text = porta.type === 'image'
            ? `Send a photo for ${label}`
            : `Reply with ${label}`
          return { primitives: [{ kind: 'Prompt', label: text }] }
        }
        return this._buildConfigureStep(state)
      }

      // Execute tap → validate (rejects on a missing required field, so a half-filled
      // card cannot submit) and submit exactly as the fast path does.
      if (event.actionId === 'execute') {
        const validated = validateAditus(modus.aditus, state.aditus)  // throws if a required field is missing
        state.aditus = validated
        return this._runBalanceGateAndSubmit(ctx, state, modus)
      }

      return this._buildConfigureStep(state)
    }

    // ── Value input (form bundle, or a single prompt/photo reply) ────────────
    let formValues: Record<string, unknown>
    let viaEditMarker = false
    if (event.kind === 'form') {
      formValues = event.values
    } else if (event.kind === 'prompt') {
      // The editing marker (card edit) targets THAT field; absent it, fill the
      // next unfilled required field (the hot-path gap-fill default).
      if (state.editingField && state.editingField in modus.aditus) {
        formValues = { [state.editingField]: event.text }
        viaEditMarker = true
        state.editingField = undefined
      } else {
        const firstRequired = Object.entries(modus.aditus).find(([k, p]) => p.required && !(k in state.aditus))
        if (!firstRequired) return this._buildConfigureStep(state)
        formValues = { [firstRequired[0]]: event.text }
      }
    } else {
      return this._buildConfigureStep(state)
    }

    // Coerce each supplied value through its own one-key schema slice (so `steps='8'`
    // becomes the int `8`), then merge. We can't validateAditus the whole schema here —
    // a card edit fills one field at a time and may leave required fields unset, which
    // validateAditus would reject. The full validate happens at submit / Execute.
    const coerced: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(formValues)) {
      const porta = modus.aditus[key]
      if (porta) {
        Object.assign(coerced, validateAditus({ [key]: porta }, { [key]: value }))
      } else {
        coerced[key] = value
      }
    }
    state.aditus = { ...state.aditus, ...coerced }

    // Card edit → re-render the card (explicit Execute tap submits). Gap-fill →
    // walk to the next required field, or submit once all required are filled.
    if (viaEditMarker) {
      return this._buildConfigureStep(state)
    }

    const stillMissing = Object.entries(modus.aditus).find(([k, p]) => p.required && !(k in state.aditus) && p.default === undefined)
    if (stillMissing) {
      // Keep walking required fields with the sequential prompt (not the card).
      return this._buildConfigureStep(state, false)
    }

    state.aditus = validateAditus(modus.aditus, state.aditus)
    return this._runBalanceGateAndSubmit(ctx, state, modus)
  }

  /** Balance gate (shared by gap-fill auto-submit and the card's Execute tap) → submit. */
  private async _runBalanceGateAndSubmit(
    ctx: FlowContext,
    state: ExecuteFlowState,
    modus: Awaited<ReturnType<ExecuteFlow['_resolveModus']>>,
  ): Promise<Step | Resolution> {

    // Bursa runs pre-debit at inceptio — no signorum balance needed here.
    if ('bursaToken' in ctx.identity) return this._submit(ctx, state)

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
    // Resource scope comes from the CASTER. A modus declares which of its aditus ports name a
    // stored, owner-bearing record (`Porta.owned`), and this is the last seam that still knows
    // who is casting: an Actum is identity-blind, so by the time a cursor reads the port there is
    // no caller left to scope it against. Refused HERE, above `dispatchInceptio`, so a refusal
    // reserves no signa, creates no actum and provisions no pod. A modus that declares no
    // reference costs nothing — the verdict returns before any store is read.
    const casting = await this.deps.modorum.find(state.modusId!)
    const verdict = await ownedAditusVerdict(
      this.deps.ownedResources ?? {},
      ctx.identity,
      casting,
      state.aditus,
    )
    if (!verdict.ok) {
      // Names the port, never the value and never whether a record exists behind it — the same
      // non-enumerability the REST refusal preserves.
      return {
        primitives: [{
          kind: 'Detail',
          label: 'Not your input',
          content: `The value in \`${verdict.field}\` names something this account cannot use.\n\nCheck the id and try again.`,
          actions: [
            { id: 'edit',   label: 'edit' },
            { id: 'cancel', label: '✕'    },
          ],
        }],
      }
    }

    // The neutral initiate→dispatch core lives in `dispatchInceptio` so any facade
    // (REST/MCP/…) reuses the exact same logic. Pinned models (Mod • → Add) ride a
    // first-class field alongside shareTokenHint → stored on the Actum → unioned into
    // spec.models by the Compiler. (Not smuggled through aditus — validateAditus would
    // strip it.) The actumIndex recording lives inside dispatchInceptio.
    const { actum, exitus } = await dispatchInceptio(this.deps, {
      modusId: state.modusId!,
      aditus: state.aditus,
      by: ctx.identity,
      modoId: ctx.modoId,
      ...(state.shareTokenHint ? { shareTokenHint: state.shareTokenHint } : {}),
      ...(state.pinnedModels?.length ? { pinnedModels: state.pinnedModels } : {}),
    })

    state.actumId = actum.id

    if (exitus !== undefined) {
      // Sync: dispatch already completed the actum → render the result.
      state.step = 'RESULT'
      state.result = exitus
      const opts = this._buildReplyOpts(state, state.result)
      return this._buildResultStep(state.result, actum.id, opts)
    } else {
      // Async: set waiting state — the completion webhook finishes it.
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

  /**
   * Build the CONFIGURE step. Two presentations off one primitive:
   *   • `asCard: true`  → carry `values` (the current aditus). The adapter renders the
   *     full flow card (every Porta + its current/default value, per-field edit buttons,
   *     an Execute button gated on all-required-filled).
   *   • `asCard: false` → omit `values`. The adapter renders the legacy single-field
   *     gap-fill prompt (ask for the next unfilled required field).
   */
  private async _buildConfigureStep(state: ExecuteFlowState, asCard = true): Promise<Step> {
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
        ...(asCard ? { values: { ...state.aditus } } : {}),
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
    // Deliver by VALUE, not key name: any string value that is an http(s) URL is a
    // media output (type inferred from its extension); everything else is text. This
    // is key-agnostic, so it works whatever the flow's exitus schema names its output
    // (`image`, `imageUrl`, `mesh`, …) — the schema/runtime key never has to match a
    // delivery convention again.
    const isUrl = (v: unknown): v is string => typeof v === 'string' && /^https?:\/\//.test(v)
    const mediaType = (url: string): 'video' | 'audio' | 'image' => {
      const ext = url.split('?')[0].split('.').pop()?.toLowerCase() ?? ''
      if (/^(mp4|webm|mov|m4v|mkv)$/.test(ext)) return 'video'
      if (/^(mp3|wav|ogg|flac|m4a|aac)$/.test(ext)) return 'audio'
      return 'image'
    }

    const media = Object.entries(result)
      .filter(([, v]) => isUrl(v))
      .map(([, v]) => ({ url: v as string, type: mediaType(v as string) }))

    // Text content: non-URL values, skipping internal underscore-prefixed keys (collection bookkeeping).
    const textEntries = Object.entries(result).filter(([k, v]) => !isUrl(v) && !k.startsWith('_'))
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

    // Extract the assistant's text reply (for chat continuation). Value-driven:
    // genuine text = string values that are NOT URLs, so a media output (e.g. an
    // `image` URL) never pollutes the conversation thread. Image-only flows yield
    // no text → no priorMessages.
    const isUrl = (v: unknown): v is string => typeof v === 'string' && /^https?:\/\//.test(v)
    const textEntries = Object.entries(result).filter(([, v]) => typeof v === 'string' && !isUrl(v))
    if (textEntries.length === 0) return { modusId: state.modusId }

    const rawText = String(result.response ?? result.text ?? textEntries[0]?.[1] ?? '')

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
