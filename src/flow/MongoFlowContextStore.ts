import type { Db } from 'mongodb'
import type { FlowContext, Platform } from './types.js'
import type { FlowContextStore } from './FlowContextStore.js'

export class MongoFlowContextStore implements FlowContextStore {
  private readonly collection
  private readonly primary = new Map<string, FlowContext>()
  private readonly actumIndex = new Map<string, string>()

  constructor(db: Db, collectionName = 'flowContexts') {
    this.collection = (db as unknown as { collection: (name: string) => unknown }).collection
      ? (db as unknown as { collection: (name: string) => unknown }).collection(collectionName)
      : db  // accept a pre-built collection directly (used in tests)
  }

  key(platform: Platform, userId: string): string {
    return `${platform}:${userId}`
  }

  get(platform: Platform, userId: string): FlowContext | undefined {
    return this.primary.get(this.key(platform, userId))
  }

  set(platform: Platform, userId: string, ctx: FlowContext): void {
    const k = this.key(platform, userId)

    // Maintain actumIndex
    const existing = this.primary.get(k)
    if (existing?.pendingActumId) this.actumIndex.delete(existing.pendingActumId)

    this.primary.set(k, ctx)
    if (ctx.pendingActumId) this.actumIndex.set(ctx.pendingActumId, k)

    // Fire-and-forget Mongo upsert
    this._upsert(k, ctx).catch(err => console.error('[MongoFlowContextStore] upsert error:', err))
  }

  delete(platform: Platform, userId: string): void {
    const k = this.key(platform, userId)
    const existing = this.primary.get(k)
    if (existing?.pendingActumId) this.actumIndex.delete(existing.pendingActumId)
    this.primary.delete(k)
    this._delete(k).catch(err => console.error('[MongoFlowContextStore] delete error:', err))
  }

  findByPendingActumId(actumId: string): FlowContext | undefined {
    const k = this.actumIndex.get(actumId)
    return k ? this.primary.get(k) : undefined
  }

  async hydrate(): Promise<void> {
    const col = this.collection as {
      createIndexes: (indexes: unknown[]) => Promise<void>
      find: (filter?: unknown) => { toArray: () => Promise<Array<Record<string, unknown>>> }
    }

    await col.createIndexes([
      { key: { pendingActumId: 1 }, sparse: true, name: 'pendingActumId_sparse' },
      { key: { updatedAt: 1 }, expireAfterSeconds: 30 * 24 * 60 * 60, name: 'ttl_30d' },
    ])

    const docs = await col.find({}).toArray()
    for (const doc of docs) {
      const ctx = doc.ctx as FlowContext
      this.primary.set(doc._id as string, ctx)
      if (ctx.pendingActumId) this.actumIndex.set(ctx.pendingActumId, doc._id as string)
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
