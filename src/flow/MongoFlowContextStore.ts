import type { Db } from 'mongodb'
import type { FlowContext, Platform } from './types.js'
import type { FlowContextStore } from './FlowContextStore.js'
import { makeLogger } from '../lib/logger.js'

const log = makeLogger('flow:context-store')

export class MongoFlowContextStore implements FlowContextStore {
  private readonly collection
  private readonly primary = new Map<string, FlowContext>()
  private readonly actumIndex = new Map<string, string>()

  constructor(db: Db, collectionName = 'flowContexts') {
    this.collection = (db as unknown as { collection: (name: string) => unknown }).collection
      ? (db as unknown as { collection: (name: string) => unknown }).collection(collectionName)
      : db  // accept a pre-built collection directly (used in tests)
  }

  key(platform: Platform, userId: string, chatId: string): string {
    return `${platform}:${userId}:${chatId}`
  }

  get(platform: Platform, userId: string, chatId: string): FlowContext | undefined {
    return this.primary.get(this.key(platform, userId, chatId))
  }

  set(platform: Platform, userId: string, chatId: string, ctx: FlowContext): void {
    const k = this.key(platform, userId, chatId)

    // Maintain actumIndex
    const existing = this.primary.get(k)
    if (existing?.pendingActumId) this.actumIndex.delete(existing.pendingActumId)

    this.primary.set(k, ctx)
    if (ctx.pendingActumId) this.actumIndex.set(ctx.pendingActumId, k)

    // Fire-and-forget Mongo upsert
    this._upsert(k, ctx).catch((err: unknown) => log.error('upsert error', { error: String(err) }))
  }

  delete(platform: Platform, userId: string, chatId: string): void {
    const k = this.key(platform, userId, chatId)
    const existing = this.primary.get(k)
    if (existing?.pendingActumId) this.actumIndex.delete(existing.pendingActumId)
    this.primary.delete(k)
    this._delete(k).catch((err: unknown) => log.error('delete error', { error: String(err) }))
  }

  findByPendingActumId(actumId: string): FlowContext | undefined {
    const k = this.actumIndex.get(actumId)
    return k ? this.primary.get(k) : undefined
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
