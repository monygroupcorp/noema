import type { FlowContext, Platform } from './types.js'

// ---------------------------------------------------------------------------
// FlowContextStore interface
// ---------------------------------------------------------------------------

export interface FlowContextStore {
  get(platform: Platform, userId: string): FlowContext | undefined
  set(platform: Platform, userId: string, ctx: FlowContext): void
  delete(platform: Platform, userId: string): void
  /** Find the context that is waiting on a specific actum's completion. */
  findByPendingActumId(actumId: string): FlowContext | undefined
  /** Returns the store key for a given platform+userId pair */
  key(platform: Platform, userId: string): string
}

// ---------------------------------------------------------------------------
// MemoryFlowContextStore — in-memory implementation
// ---------------------------------------------------------------------------

export class MemoryFlowContextStore implements FlowContextStore {
  // primary: Map<`${platform}:${userId}`, FlowContext>
  private readonly primary = new Map<string, FlowContext>()
  // actumIndex: Map<actumId, storeKey>  — only contexts with pendingActumId set
  private readonly actumIndex = new Map<string, string>()

  key(platform: Platform, userId: string): string {
    return `${platform}:${userId}`
  }

  get(platform: Platform, userId: string): FlowContext | undefined {
    return this.primary.get(this.key(platform, userId))
  }

  set(platform: Platform, userId: string, ctx: FlowContext): void {
    const k = this.key(platform, userId)

    // Remove any old actum index entry for this key
    const existing = this.primary.get(k)
    if (existing?.pendingActumId) {
      this.actumIndex.delete(existing.pendingActumId)
    }

    this.primary.set(k, ctx)

    // Index the new pendingActumId if present
    if (ctx.pendingActumId) {
      this.actumIndex.set(ctx.pendingActumId, k)
    }
  }

  delete(platform: Platform, userId: string): void {
    const k = this.key(platform, userId)
    const existing = this.primary.get(k)
    if (existing?.pendingActumId) {
      this.actumIndex.delete(existing.pendingActumId)
    }
    this.primary.delete(k)
  }

  findByPendingActumId(actumId: string): FlowContext | undefined {
    const k = this.actumIndex.get(actumId)
    if (!k) return undefined
    return this.primary.get(k)
  }
}
