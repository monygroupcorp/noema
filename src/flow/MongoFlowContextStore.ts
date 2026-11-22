import type { Db } from 'mongodb'
import type { FlowContext, Platform } from './types.js'
import { FLOW_CONTEXT_TTL_MS, type FlowContextStore, type FlowContextStoreOptions } from './FlowContextStore.js'
import { makeLogger } from '../lib/logger.js'

const log = makeLogger('flow:context-store')

export class MongoFlowContextStore implements FlowContextStore {
  private readonly collection
  private readonly primary = new Map<string, FlowContext>()
  // actumIndex holds the CONTEXT ITSELF, not a key into `primary` — mirrors
  // MemoryFlowContextStore: a context vacated by `abandon()` (superseded by a newer
  // command) is no longer reachable through any key in `primary`, so a pending actum has to
  // stay findable independent of whichever context currently owns its chat's slot.
  private readonly actumIndex = new Map<string, FlowContext>()
  private readonly actumTouchedAt = new Map<string, number>()
  // When each cached context was last written (or, after hydrate, last persisted). The TTL
  // index below expires the document; this expires the cache, so the two agree on what is live.
  private readonly touchedAt = new Map<string, number>()
  private readonly ttlMs: number
  private readonly now: () => number

  constructor(db: Db, collectionName = 'flowContexts', opts: FlowContextStoreOptions = {}) {
    this.collection = (db as unknown as { collection: (name: string) => unknown }).collection
      ? (db as unknown as { collection: (name: string) => unknown }).collection(collectionName)
      : db  // accept a pre-built collection directly (used in tests)
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
    // whatever actum it was tracking before (see MemoryFlowContextStore for the external-
    // takeover case, handled by `abandon()` instead).
    const existing = this.primary.get(k)
    if (existing?.pendingActumId) {
      this.actumIndex.delete(existing.pendingActumId)
      this.actumTouchedAt.delete(existing.pendingActumId)
    }

    this.primary.set(k, ctx)
    this.touchedAt.set(k, this.now())
    if (ctx.pendingActumId) {
      this.actumIndex.set(ctx.pendingActumId, ctx)
      this.actumTouchedAt.set(ctx.pendingActumId, this.now())
    }

    // Fire-and-forget Mongo upsert
    this._upsert(k, ctx).catch((err: unknown) => log.error('upsert error', { error: String(err) }))
  }

  delete(platform: Platform, userId: string, chatId: string): void {
    const k = this.key(platform, userId, chatId)
    this._evict(k)
    this._delete(k).catch((err: unknown) => log.error('delete error', { error: String(err) }))
  }

  abandon(platform: Platform, userId: string, chatId: string): FlowContext | undefined {
    const k = this.key(platform, userId, chatId)
    const existing = this.primary.get(k)
    this.primary.delete(k)
    this.touchedAt.delete(k)
    // No actumIndex cleanup, and no persisted delete: the slot's OWN document still needs to
    // exist for `findByPendingActumId`'s eventual `settlePending` to resolve against, and a
    // process restart before that must still be able to re-hydrate it (hydrate() re-derives
    // the actumIndex from `pendingActumId` on every persisted doc, not from which chat slot
    // currently claims it).
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
      this._upsert(k, nextCtx).catch((err: unknown) => log.error('upsert error', { error: String(err) }))
    } else {
      this.primary.delete(k)
      this.touchedAt.delete(k)
      this._delete(k).catch((err: unknown) => log.error('delete error', { error: String(err) }))
    }
  }

  /** The cached context under `k`, unless it has sat idle past the TTL — then it is dropped
   *  from the cache (the document expires on its own index) and reads as absent. */
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

  async hydrate(): Promise<void> {
    const col = this.collection as {
      createIndexes: (indexes: unknown[]) => Promise<void>
      dropIndex: (name: string) => Promise<unknown>
      find: (filter?: unknown) => { toArray: () => Promise<Array<Record<string, unknown>>> }
    }

    // Mongo refuses a second index on the same key pattern under a different name, and
    // refuses to recreate an existing name with different options — drop the prior TTL
    // index first. A fresh database has no such index; swallow only that case.
    await col.dropIndex('ttl_30d').catch((err: unknown) => {
      const msg = String((err as { message?: string })?.message ?? err)
      // "index not found" — no prior index to drop. "ns not found" — collection doesn't
      // exist yet (fresh database, nothing has hydrated/written before). Both expected.
      if (!/index not found|ns not found/i.test(msg)) throw err
    })

    await col.createIndexes([
      { key: { pendingActumId: 1 }, sparse: true, name: 'pendingActumId_sparse' },
      { key: { updatedAt: 1 }, expireAfterSeconds: 24 * 60 * 60, name: 'ttl_24h' },
    ])

    const docs = await col.find({}).toArray()
    for (const doc of docs) {
      const ctx = doc.ctx as FlowContext
      const k = doc._id as string
      this.primary.set(k, ctx)
      // Carry the persisted write time so a context that was already old at boot does not get
      // a fresh 24h from the restart. A document with no stamp is treated as written now.
      const updatedAt = doc.updatedAt instanceof Date ? doc.updatedAt.getTime() : this.now()
      this.touchedAt.set(k, updatedAt)
      if (ctx.pendingActumId) {
        this.actumIndex.set(ctx.pendingActumId, ctx)
        this.actumTouchedAt.set(ctx.pendingActumId, updatedAt)
      }
    }
  }

  private async _upsert(key: string, ctx: FlowContext): Promise<void> {
    const col = this.collection as {
      replaceOne: (filter: unknown, doc: unknown, opts: unknown) => Promise<unknown>
    }
    await col.replaceOne(
      { _id: key as unknown as never },
      { _id: key as unknown as never, ctx, pendingActumId: ctx.pendingActumId ?? null, updatedAt: new Date() },
      { upsert: true }
    )
  }

  private async _delete(key: string): Promise<void> {
    const col = this.collection as {
      deleteOne: (filter: unknown) => Promise<unknown>
    }
    await col.deleteOne({ _id: key as unknown as never })
  }
}
