import type { FlowContext, Platform } from './types.js'

/**
 * How long an untouched flow context stays answerable. The same 24h the Mongo TTL index
 * gives the persisted copy — the in-memory copy used to live until the process restarted,
 * so a card a user opened weeks ago was still waiting: their next stray message filled its
 * prompt and submitted a paid run they had long forgotten asking for.
 */
export const FLOW_CONTEXT_TTL_MS = 24 * 60 * 60 * 1000

export interface FlowContextStoreOptions {
  /** Idle lifetime of a context, ms. Default `FLOW_CONTEXT_TTL_MS`. */
  ttlMs?: number
  /** Clock, for tests. */
  now?: () => number
}

// ---------------------------------------------------------------------------
// FlowContextStore interface
// ---------------------------------------------------------------------------

export interface FlowContextStore {
  get(platform: Platform, userId: string, chatId: string): FlowContext | undefined
  set(platform: Platform, userId: string, chatId: string, ctx: FlowContext): void
  delete(platform: Platform, userId: string, chatId: string): void
  /**
   * Vacate the chat's primary slot WITHOUT touching the pending-actum index. Used when a
   * new command takes over a chat whose active context is still waiting on an async actum
   * (a second `/make` while the first is still running on a pod) — the conversational slot
   * moves on to the new command, but the in-flight run stays reachable through
   * `findByPendingActumId` until it resolves through `settlePending`, so its eventual
   * delivery is never silently dropped (noema warm-pod-second-make-lost-and-reprovisions).
   */
  abandon(platform: Platform, userId: string, chatId: string): FlowContext | undefined
  /** Find the context that is waiting on a specific actum's completion. */
  findByPendingActumId(actumId: string): FlowContext | undefined
  /**
   * Resolve a pending actum: drop it from the pending index, and write `nextCtx` (or clear
   * the slot, when null) into the chat's primary slot ONLY if that slot still holds the
   * exact context this actum was indexed under. A newer command that has since taken the
   * chat's slot (via `enter()`/`abandon()`) is never clobbered by a stale completion
   * arriving after it.
   */
  settlePending(actumId: string, nextCtx: FlowContext | null): void
  /** Returns the store key for a given platform+userId+chatId triple */
  key(platform: Platform, userId: string, chatId: string): string
}

// ---------------------------------------------------------------------------
// MemoryFlowContextStore — in-memory implementation
// ---------------------------------------------------------------------------

export class MemoryFlowContextStore implements FlowContextStore {
  // primary: Map<`${platform}:${userId}:${chatId}`, FlowContext>
  private readonly primary = new Map<string, FlowContext>()
  // actumIndex holds the CONTEXT ITSELF, not a key into `primary` — a context vacated by
  // `abandon()` (superseded by a newer command) is no longer reachable through any key in
  // `primary`, so the pending-actum index has to carry it directly for `settlePending` to
  // find later.
  private readonly actumIndex = new Map<string, FlowContext>()
  // actumTouchedAt: Map<actumId, ms> — mirrors `touchedAt` but for the actum index, since an
  // abandoned context's entry no longer shares a lifetime with any `primary` key.
  private readonly actumTouchedAt = new Map<string, number>()
  // touchedAt: Map<storeKey, ms> — when the context was last set; read against the TTL
  private readonly touchedAt = new Map<string, number>()
  private readonly ttlMs: number
  private readonly now: () => number

  constructor(opts: FlowContextStoreOptions = {}) {
    this.ttlMs = opts.ttlMs ?? FLOW_CONTEXT_TTL_MS
    this.now = opts.now ?? Date.now
  }

  key(platform: Platform, userId: string, chatId: string): string {
    return `${platform}:${userId}:${chatId}`
  }

  get(platform: Platform, userId: string, chatId: string): FlowContext | undefined {
    return this._live(this.key(platform, userId, chatId))
  }

  set(platform: Platform, userId: string, chatId: string, ctx: FlowContext): void {
    const k = this.key(platform, userId, chatId)

    // Self-overwrite at the same slot — the active flow advancing its own state — retires
    // whatever actum it was tracking before. This is the context replacing ITSELF (not an
    // external takeover via `enter()`/`abandon()`), so there is nothing left for the old
    // actum to deliver into.
    const existing = this.primary.get(k)
    if (existing?.pendingActumId) {
      this.actumIndex.delete(existing.pendingActumId)
      this.actumTouchedAt.delete(existing.pendingActumId)
    }

    this.primary.set(k, ctx)
    this.touchedAt.set(k, this.now())

    // Index the new pendingActumId if present
    if (ctx.pendingActumId) {
      this.actumIndex.set(ctx.pendingActumId, ctx)
      this.actumTouchedAt.set(ctx.pendingActumId, this.now())
    }
  }

  delete(platform: Platform, userId: string, chatId: string): void {
    this._evict(this.key(platform, userId, chatId))
  }

  abandon(platform: Platform, userId: string, chatId: string): FlowContext | undefined {
    const k = this.key(platform, userId, chatId)
    const existing = this.primary.get(k)
    this.primary.delete(k)
    this.touchedAt.delete(k)
    // Deliberately no actumIndex cleanup here — `existing`'s pending actum, if any, stays
    // reachable by `findByPendingActumId` until `settlePending` resolves it or it ages out.
    return existing
  }

  findByPendingActumId(actumId: string): FlowContext | undefined {
    const ctx = this.actumIndex.get(actumId)
    if (!ctx) return undefined
    const touched = this.actumTouchedAt.get(actumId)
    if (touched !== undefined && this.now() - touched >= this.ttlMs) {
      this.actumIndex.delete(actumId)
      this.actumTouchedAt.delete(actumId)
      return undefined
    }
    return ctx
  }

  settlePending(actumId: string, nextCtx: FlowContext | null): void {
    const ctx = this.actumIndex.get(actumId)
    this.actumIndex.delete(actumId)
    this.actumTouchedAt.delete(actumId)
    if (!ctx) return

    const k = this.key(ctx.platform, ctx.platformUserId, ctx.platformChatId)
    // Only touch the chat's primary slot if it still holds THIS context — a newer command
    // that has since taken the slot must never be overwritten by a stale completion landing
    // after it.
    if (this.primary.get(k) !== ctx) return

    if (nextCtx) {
      this.primary.set(k, nextCtx)
      this.touchedAt.set(k, this.now())
      if (nextCtx.pendingActumId) {
        this.actumIndex.set(nextCtx.pendingActumId, nextCtx)
        this.actumTouchedAt.set(nextCtx.pendingActumId, this.now())
      }
    } else {
      this.primary.delete(k)
      this.touchedAt.delete(k)
    }
  }

  /** The context under `k`, unless its idle lifetime has run out — then it is gone, as if deleted. */
  private _live(k: string): FlowContext | undefined {
    const ctx = this.primary.get(k)
    if (!ctx) return undefined
    const touched = this.touchedAt.get(k)
    if (touched !== undefined && this.now() - touched >= this.ttlMs) {
      this._evict(k)
      return undefined
    }
    return ctx
  }

  private _evict(k: string): void {
    const existing = this.primary.get(k)
    if (existing?.pendingActumId) {
      this.actumIndex.delete(existing.pendingActumId)
      this.actumTouchedAt.delete(existing.pendingActumId)
    }
    this.primary.delete(k)
    this.touchedAt.delete(k)
  }
}
