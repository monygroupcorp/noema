import type { Flow, FlowContext, Step, Resolution, Intent, Platform, PrimitiveEvent, AuctorKey } from './types.js'
import type { FlowContextStore } from './FlowContextStore.js'

// ---------------------------------------------------------------------------
// Callbacks
// ---------------------------------------------------------------------------

export type StepCallback = (ctx: FlowContext, step: Step) => void
export type ResolutionCallback = (ctx: FlowContext, resolution: Resolution) => void

// ---------------------------------------------------------------------------
// FlowRouterDeps
// ---------------------------------------------------------------------------

export interface FlowRouterDeps {
  store: FlowContextStore
  /** Called when a flow emits a step (including async completion steps) */
  onStep: StepCallback
  /** Called when a flow reaches a terminal resolution */
  onResolution: ResolutionCallback
}

// ---------------------------------------------------------------------------
// FlowRouter
// ---------------------------------------------------------------------------

/**
 * A flow that optionally supports handleCompletion for async actum results.
 */
interface FlowWithCompletion extends Flow {
  handleCompletion(
    ctx: FlowContext,
    result:
      | { kind: 'complete'; exitus: Record<string, unknown> }
      | { kind: 'failed'; error: string }
  ): Promise<Step | Resolution>
}

function hasCompletion(flow: Flow): flow is FlowWithCompletion {
  return typeof (flow as FlowWithCompletion).handleCompletion === 'function'
}

export class FlowRouter {
  private readonly flows = new Map<Intent, Flow>()

  constructor(private readonly deps: FlowRouterDeps) {}

  /** Register a Flow implementation for its intent */
  register(flow: Flow): void {
    this.flows.set(flow.intent, flow)
  }

  /**
   * Enter a new flow for a user. If a flow is already active for this user,
   * the existing context is abandoned and a new one starts.
   */
  async enter(
    intent: Intent,
    platform: Platform,
    userId: string,
    chatId: string,
    identity: AuctorKey,
    initialCtx?: Partial<Pick<FlowContext, 'modoId' | 'messageId'>> & { state?: unknown }
  ): Promise<void> {
    const { store, onStep, onResolution } = this.deps

    // Abandon any existing context (in THIS chat only — other chats' contexts for the
    // same user are untouched)
    const existing = store.get(platform, userId, chatId)
    if (existing) {
      store.delete(platform, userId, chatId)
      const abandonResolution: Resolution = { kind: 'abandon' }
      onResolution(existing, abandonResolution)
    }

    const flow = this.flows.get(intent)
    if (!flow) throw new Error(`No flow registered for intent '${intent}'`)

    const { state: initialState, ...restCtx } = initialCtx ?? {}
    const ctx: FlowContext = {
      intent,
      state: initialState ?? {},
      identity,
      platform,
      platformUserId: userId,
      platformChatId: chatId,
      ...restCtx,
    }

    const step = await flow.enter(ctx)
    // Store after enter (ctx.state may have been mutated by flow.enter)
    store.set(platform, userId, chatId, ctx)
    onStep(ctx, step)
  }

  /**
   * Route a user event to the active flow for this user, in this chat.
   * If no active flow in this chat, ignores the event.
   */
  async handle(
    platform: Platform,
    userId: string,
    chatId: string,
    event: PrimitiveEvent
  ): Promise<void> {
    const { store, onStep, onResolution } = this.deps

    const ctx = store.get(platform, userId, chatId)
    if (!ctx) return

    const flow = this.flows.get(ctx.intent)
    if (!flow) return

    const result = await flow.handle(ctx, event)

    if ('primitives' in result) {
      // Step — update stored context (state may have legitimately advanced)
      // and notify only when there's something to emit. An empty-primitives
      // step means "state preserved, emit nothing."
      store.set(platform, userId, chatId, ctx)
      if (result.primitives.length > 0) {
        onStep(ctx, result)
      }
    } else {
      // Resolution
      if (result.kind === 'handoff') {
        // Re-enter with the target flow. Delete the old context first.
        store.delete(platform, userId, chatId)
        await this._enterWithContext(result.toIntent, ctx, result.withContext)
      } else {
        // complete or abandon
        store.delete(platform, userId, chatId)
        onResolution(ctx, result)
      }
    }
  }

  /**
   * Resume a flow that was waiting for an async actum to complete.
   * Called by the Nexus execution_spend hook when an async Actum finishes.
   * If no context is waiting on this actumId, this is a no-op.
   */
  /**
   * Resume a flow that was waiting for an async actum to complete.
   * Returns the identity (AuctorKey) of the flow context that consumed this
   * actumId, or null if no context was waiting. Callers use the returned
   * identity to fire post-completion side-effects (e.g. vestigium indexing)
   * without storing identity on the Actum itself (privacy partition).
   */
  async handleActumComplete(
    actumId: string,
    result: { kind: 'complete'; exitus: Record<string, unknown> } | { kind: 'failed'; error: string }
  ): Promise<AuctorKey | null> {
    const { store, onStep, onResolution } = this.deps

    const ctx = store.findByPendingActumId(actumId)
    if (!ctx) return null

    const flow = this.flows.get(ctx.intent)
    if (!flow || !hasCompletion(flow)) return null

    const identity = ctx.identity

    const outcome = await flow.handleCompletion(ctx, result)

    if ('primitives' in outcome) {
      // Update store — ctx.pendingActumId was cleared by handleCompletion
      store.set(ctx.platform, ctx.platformUserId, ctx.platformChatId, ctx)
      onStep(ctx, outcome)
    } else {
      store.delete(ctx.platform, ctx.platformUserId, ctx.platformChatId)
      onResolution(ctx, outcome)
    }

    return identity
  }

  /** Clear the active flow for a user in a specific chat (abandon). */
  clear(platform: Platform, userId: string, chatId: string): void {
    this.deps.store.delete(platform, userId, chatId)
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private async _enterWithContext(
    intent: Intent,
    fromCtx: FlowContext,
    withContext: unknown
  ): Promise<void> {
    const { store, onStep } = this.deps

    const flow = this.flows.get(intent)
    if (!flow) throw new Error(`No flow registered for intent '${intent}' (handoff target)`)

    const ctx: FlowContext = {
      intent,
      state: withContext ?? {},
      identity: fromCtx.identity,
      platform: fromCtx.platform,
      platformUserId: fromCtx.platformUserId,
      platformChatId: fromCtx.platformChatId,
      modoId: fromCtx.modoId,
      messageId: fromCtx.messageId,
    }

    const step = await flow.enter(ctx)
    store.set(ctx.platform, ctx.platformUserId, ctx.platformChatId, ctx)
    onStep(ctx, step)
  }
}
