import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { FlowContext } from '../../../src/flow/types.js'

// ---------------------------------------------------------------------------
// Mock collection
// ---------------------------------------------------------------------------

function makeMockCollection(docs: Array<Record<string, unknown>> = []) {
  const calls: { method: string; args: unknown[] }[] = []
  return {
    calls,
    find: () => ({ toArray: async () => docs }),
    replaceOne: async (...args: unknown[]) => { calls.push({ method: 'replaceOne', args }); return {} },
    deleteOne: async (...args: unknown[]) => { calls.push({ method: 'deleteOne', args }); return {} },
    createIndexes: async (...args: unknown[]) => { calls.push({ method: 'createIndexes', args }) },
    dropIndex: async (...args: unknown[]) => { calls.push({ method: 'dropIndex', args }) },
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeCtx(overrides: Partial<FlowContext> = {}): FlowContext {
  return {
    intent: 'execute',
    state: {},
    identity: { animaId: 'anima-1' },
    platform: 'telegram',
    platformUserId: 'user-1',
    platformChatId: 'chat-1',
    ...overrides,
  }
}

function makeStore(docs: Array<Record<string, unknown>> = [], opts?: { ttlMs?: number; now?: () => number }) {
  const { MongoFlowContextStore } = require('../../../src/flow/MongoFlowContextStore.js')
  const col = makeMockCollection(docs)
  const store = new MongoFlowContextStore(col as unknown, 'flowContexts', opts)
  return { store, col }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test('get returns undefined for unknown key', () => {
  const { store } = makeStore()
  assert.equal(store.get('telegram', 'user1', 'chat1'), undefined)
})

test('set stores in cache and get returns it', () => {
  const { store } = makeStore()
  const ctx = makeCtx()
  store.set('telegram', 'user1', 'chat1', ctx)
  assert.deepEqual(store.get('telegram', 'user1', 'chat1'), ctx)
})

test('set with pendingActumId updates actumIndex', () => {
  const { store } = makeStore()
  const ctx = makeCtx({ pendingActumId: 'actum-42' })
  store.set('telegram', 'user1', 'chat1', ctx)
  assert.deepEqual(store.findByPendingActumId('actum-42'), ctx)
})

test('set overwrites old pendingActumId in actumIndex', () => {
  const { store } = makeStore()
  const ctxA = makeCtx({ pendingActumId: 'actum-A' })
  store.set('telegram', 'user1', 'chat1', ctxA)

  const ctxB = makeCtx({ pendingActumId: 'actum-B' })
  store.set('telegram', 'user1', 'chat1', ctxB)

  assert.equal(store.findByPendingActumId('actum-A'), undefined)
  assert.deepEqual(store.findByPendingActumId('actum-B'), ctxB)
})

test('delete removes from cache', () => {
  const { store } = makeStore()
  store.set('telegram', 'user1', 'chat1', makeCtx())
  store.delete('telegram', 'user1', 'chat1')
  assert.equal(store.get('telegram', 'user1', 'chat1'), undefined)
})

test('delete removes from actumIndex', () => {
  const { store } = makeStore()
  store.set('telegram', 'user1', 'chat1', makeCtx({ pendingActumId: 'actum-42' }))
  store.delete('telegram', 'user1', 'chat1')
  assert.equal(store.findByPendingActumId('actum-42'), undefined)
})

test('different chats with same platform+userId are independent', () => {
  const { store } = makeStore()
  const ctxA = makeCtx({ platformChatId: 'chat-A', intent: 'execute' })
  const ctxB = makeCtx({ platformChatId: 'chat-B', intent: 'train' })
  store.set('telegram', 'user1', 'chat-A', ctxA)
  store.set('telegram', 'user1', 'chat-B', ctxB)
  assert.equal(store.get('telegram', 'user1', 'chat-A')?.intent, 'execute')
  assert.equal(store.get('telegram', 'user1', 'chat-B')?.intent, 'train')
})

test('set fires upsert to collection', async () => {
  const { store, col } = makeStore()
  const ctx = makeCtx({ pendingActumId: 'actum-99' })
  store.set('telegram', 'user1', 'chat1', ctx)

  // Fire-and-forget — yield to microtask queue
  await new Promise(resolve => setImmediate(resolve))

  assert.equal(col.calls.length, 1)
  const call = col.calls[0]
  assert.equal(call.method, 'replaceOne')

  const [filter, doc] = call.args as [Record<string, unknown>, Record<string, unknown>]
  assert.deepEqual(filter, { _id: 'telegram:user1:chat1' })
  assert.equal(doc._id, 'telegram:user1:chat1')
  assert.deepEqual(doc.ctx, ctx)
  assert.equal(doc.pendingActumId, 'actum-99')
  assert.ok(doc.updatedAt instanceof Date)
})

test('delete fires deleteOne to collection', async () => {
  const { store, col } = makeStore()
  store.set('telegram', 'user1', 'chat1', makeCtx())

  // Clear the replaceOne call from set
  await new Promise(resolve => setImmediate(resolve))
  col.calls.length = 0

  store.delete('telegram', 'user1', 'chat1')
  await new Promise(resolve => setImmediate(resolve))

  assert.equal(col.calls.length, 1)
  const call = col.calls[0]
  assert.equal(call.method, 'deleteOne')

  const [filter] = call.args as [Record<string, unknown>]
  assert.deepEqual(filter, { _id: 'telegram:user1:chat1' })
})

test('hydrate loads docs into cache', async () => {
  const ctx1 = makeCtx({ platformUserId: 'user-1', platformChatId: 'chat-1' })
  const ctx2 = makeCtx({ platform: 'discord', platformUserId: 'user-2', platformChatId: 'chat-2' })

  const { store } = makeStore([
    { _id: 'telegram:user-1:chat-1', ctx: ctx1, pendingActumId: null, updatedAt: new Date() },
    { _id: 'discord:user-2:chat-2', ctx: ctx2, pendingActumId: null, updatedAt: new Date() },
  ])

  await store.hydrate()

  assert.deepEqual(store.get('telegram', 'user-1', 'chat-1'), ctx1)
  assert.deepEqual(store.get('discord', 'user-2', 'chat-2'), ctx2)
})

test('hydrate populates actumIndex from pendingActumId', async () => {
  const ctx = makeCtx({ pendingActumId: 'actum-77' })

  const { store } = makeStore([
    { _id: 'telegram:user-1:chat-1', ctx, pendingActumId: 'actum-77', updatedAt: new Date() },
  ])

  await store.hydrate()

  assert.deepEqual(store.findByPendingActumId('actum-77'), ctx)
})

test('hydrate skips docs without pendingActumId in actumIndex', async () => {
  const ctx = makeCtx()

  const { store } = makeStore([
    { _id: 'telegram:user-1:chat-1', ctx, pendingActumId: null, updatedAt: new Date() },
  ])

  await store.hydrate()

  // The doc is in cache but not indexed by actumId
  assert.deepEqual(store.get('telegram', 'user-1', 'chat-1'), ctx)
  // No actumId to look up — just verify the doc is not causing issues
  assert.equal(store.findByPendingActumId(''), undefined)
})

test('hydrate drops the prior 30-day TTL index before creating the 24h one', async () => {
  const { store, col } = makeStore()

  await store.hydrate()

  const dropCall = col.calls.find((c: { method: string }) => c.method === 'dropIndex')
  assert.ok(dropCall, 'expected a dropIndex call')
  assert.deepEqual(dropCall!.args, ['ttl_30d'])

  const createCall = col.calls.find((c: { method: string }) => c.method === 'createIndexes')
  assert.ok(createCall, 'expected a createIndexes call')
  const indexes = createCall!.args[0] as Array<Record<string, unknown>>
  const ttlIndex = indexes.find(i => i.name === 'ttl_24h')
  assert.ok(ttlIndex, 'expected a ttl_24h index')
  assert.equal(ttlIndex!.expireAfterSeconds, 24 * 60 * 60)

  // Order matters — the drop must precede the create in the call log.
  const dropIdx = col.calls.indexOf(dropCall!)
  const createIdx = col.calls.indexOf(createCall!)
  assert.ok(dropIdx < createIdx, 'dropIndex must run before createIndexes')
})

test('hydrate swallows an index-not-found dropIndex error (fresh database)', async () => {
  const col = {
    ...makeMockCollection(),
    dropIndex: async () => { throw new Error('index not found with name [ttl_30d]') },
  }
  const { MongoFlowContextStore } = require('../../../src/flow/MongoFlowContextStore.js')
  const store = new MongoFlowContextStore(col as unknown, 'flowContexts')

  await assert.doesNotReject(() => store.hydrate())
})

test('hydrate rethrows a non-index-not-found dropIndex error', async () => {
  const col = {
    ...makeMockCollection(),
    dropIndex: async () => { throw new Error('Mongo down') },
  }
  const { MongoFlowContextStore } = require('../../../src/flow/MongoFlowContextStore.js')
  const store = new MongoFlowContextStore(col as unknown, 'flowContexts')

  await assert.rejects(() => store.hydrate(), /Mongo down/)
})

test('set fires upsert errors are caught and logged (not thrown)', async () => {
  const { MongoFlowContextStore } = require('../../../src/flow/MongoFlowContextStore.js')

  const captured: string[] = []
  const orig = process.stdout.write.bind(process.stdout)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ;(process.stdout as any).write = (chunk: string | Uint8Array, ...rest: unknown[]) => {
    if (typeof chunk === 'string') captured.push(chunk)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (orig as any)(chunk, ...rest)
  }

  try {
    const col = {
      ...makeMockCollection(),
      replaceOne: async () => { throw new Error('Mongo down') },
    }
    const store = new MongoFlowContextStore(col as unknown, 'flowContexts')

    // Should not throw
    assert.doesNotThrow(() => store.set('telegram', 'user1', 'chat1', makeCtx()))

    // Wait for the async error
    await new Promise(resolve => setImmediate(resolve))

    assert.ok(captured.length > 0, 'expected an error log line on stdout')
    const entry = JSON.parse(captured[captured.length - 1]) as Record<string, unknown>
    assert.equal(entry.level, 'error')
    assert.equal(entry.component, 'flow:context-store')
    assert.ok(
      typeof entry.error === 'string' && entry.error.includes('Mongo down'),
      `expected error field to mention the failure, got: ${entry.error}`
    )
  } finally {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(process.stdout as any).write = orig
  }
})

test('delete fires deleteOne errors are caught and logged (not thrown)', async () => {
  const { MongoFlowContextStore } = require('../../../src/flow/MongoFlowContextStore.js')

  const captured: string[] = []
  const orig = process.stdout.write.bind(process.stdout)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ;(process.stdout as any).write = (chunk: string | Uint8Array, ...rest: unknown[]) => {
    if (typeof chunk === 'string') captured.push(chunk)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (orig as any)(chunk, ...rest)
  }

  try {
    const col = {
      ...makeMockCollection(),
      deleteOne: async () => { throw new Error('Mongo down') },
    }
    const store = new MongoFlowContextStore(col as unknown, 'flowContexts')

    store.set('telegram', 'user1', 'chat1', makeCtx())
    await new Promise(resolve => setImmediate(resolve))
    captured.length = 0

    // Should not throw
    assert.doesNotThrow(() => store.delete('telegram', 'user1', 'chat1'))

    // Wait for the async error
    await new Promise(resolve => setImmediate(resolve))

    assert.ok(captured.length > 0, 'expected an error log line on stdout')
    const entry = JSON.parse(captured[captured.length - 1]) as Record<string, unknown>
    assert.equal(entry.level, 'error')
    assert.equal(entry.component, 'flow:context-store')
    assert.ok(
      typeof entry.error === 'string' && entry.error.includes('Mongo down'),
      `expected error field to mention the failure, got: ${entry.error}`
    )
  } finally {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(process.stdout as any).write = orig
  }
})

test('key returns platform:userId:chatId format', () => {
  const { store } = makeStore()
  assert.equal(store.key('telegram', 'abc', 'chat1'), 'telegram:abc:chat1')
  assert.equal(store.key('discord', '123', 'chat2'), 'discord:123:chat2')
})

// ---------------------------------------------------------------------------
// The cache expires on the same clock as the document
// ---------------------------------------------------------------------------

test('a cached context untouched past the TTL reads as absent', () => {
  let now = 0
  const { store } = makeStore([], { ttlMs: 100, now: () => now })
  store.set('telegram', 'user1', 'chat1', makeCtx({ pendingActumId: 'act-1' }))
  now = 99
  assert.ok(store.get('telegram', 'user1', 'chat1'))
  now = 100
  assert.equal(store.get('telegram', 'user1', 'chat1'), undefined)
  assert.equal(store.findByPendingActumId('act-1'), undefined)
})

test('hydrate carries the persisted write time, so a context already old at boot is not renewed', async () => {
  const now = 10_000_000
  const docs = [
    { _id: 'telegram:u:c-old', ctx: makeCtx({ platformUserId: 'u', platformChatId: 'c-old' }), pendingActumId: null, updatedAt: new Date(now - 200) },
    { _id: 'telegram:u:c-new', ctx: makeCtx({ platformUserId: 'u', platformChatId: 'c-new' }), pendingActumId: null, updatedAt: new Date(now - 50) },
  ]
  const { store } = makeStore(docs, { ttlMs: 100, now: () => now })
  await store.hydrate()
  assert.equal(store.get('telegram', 'u', 'c-old'), undefined, 'already past its lifetime when loaded')
  assert.ok(store.get('telegram', 'u', 'c-new'), 'written 50 ago, lives 50 more')
})
