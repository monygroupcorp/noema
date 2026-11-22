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
  /** Find the context that is waiting on a specific actum's completion. */
  findByPendingActumId(actumId: string): FlowContext | undefined
  /** Returns the store key for a given platform+userId+chatId triple */
  key(platform: Platform, userId: string, chatId: string): string
}

// ---------------------------------------------------------------------------
// MemoryFlowContextStore — in-memory implementation
// ---------------------------------------------------------------------------

export class MemoryFlowContextStore implements FlowContextStore {
  // primary: Map<`${platform}:${userId}:${chatId}`, FlowContext>
  private readonly primary = new Map<string, FlowContext>()
  // actumIndex: Map<actumId, storeKey>  — only contexts with pendingActumId set
  private readonly actumIndex = new Map<string, string>()
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

    // Remove any old actum index entry for this key
    const existing = this.primary.get(k)
    if (existing?.pendingActumId) {
      this.actumIndex.delete(existing.pendingActumId)
    }

    this.primary.set(k, ctx)
    this.touchedAt.set(k, this.now())

    // Index the new pendingActumId if present
    if (ctx.pendingActumId) {
      this.actumIndex.set(ctx.pendingActumId, k)
    }
  }

  delete(platform: Platform, userId: string, chatId: string): void {
    this._evict(this.key(platform, userId, chatId))
  }

  findByPendingActumId(actumId: string): FlowContext | undefined {
    const k = this.actumIndex.get(actumId)
    if (!k) return undefined
    return this._live(k)
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
    }
    this.primary.delete(k)
    this.touchedAt.delete(k)
  }
}
