import { test } from 'node:test'
import assert from 'node:assert/strict'
import { MemoryFlowContextStore } from '../../../src/flow/FlowContextStore.js'
import type { FlowContext } from '../../../src/flow/types.js'

function makeCtx(overrides: Partial<FlowContext> = {}): FlowContext {
  return {
    intent: 'execute',
    state: {},
    identity: { animaId: 'anima-1' },
    platform: 'telegram',
    platformUserId: 'user-1',
    ...overrides,
  }
}

test('set and get by platform+userId', () => {
  const store = new MemoryFlowContextStore()
  const ctx = makeCtx()
  store.set('telegram', 'user-1', ctx)
  const result = store.get('telegram', 'user-1')
  assert.deepEqual(result, ctx)
})

test('get returns undefined for unknown user', () => {
  const store = new MemoryFlowContextStore()
  assert.equal(store.get('telegram', 'unknown'), undefined)
})

test('delete removes context', () => {
  const store = new MemoryFlowContextStore()
  store.set('telegram', 'user-1', makeCtx())
  store.delete('telegram', 'user-1')
  assert.equal(store.get('telegram', 'user-1'), undefined)
})

test('key format is platform:userId', () => {
  const store = new MemoryFlowContextStore()
  assert.equal(store.key('telegram', 'user-42'), 'telegram:user-42')
  assert.equal(store.key('discord', 'abc'), 'discord:abc')
})

test('findByPendingActumId returns context when pendingActumId matches', () => {
  const store = new MemoryFlowContextStore()
  const ctx = makeCtx({ pendingActumId: 'actum-99' })
  store.set('telegram', 'user-1', ctx)
  const result = store.findByPendingActumId('actum-99')
  assert.deepEqual(result, ctx)
})

test('findByPendingActumId returns undefined when actumId not present in any context', () => {
  const store = new MemoryFlowContextStore()
  store.set('telegram', 'user-1', makeCtx())
  assert.equal(store.findByPendingActumId('actum-missing'), undefined)
})

test('findByPendingActumId returns undefined after context deleted', () => {
  const store = new MemoryFlowContextStore()
  store.set('telegram', 'user-1', makeCtx({ pendingActumId: 'actum-99' }))
  store.delete('telegram', 'user-1')
  assert.equal(store.findByPendingActumId('actum-99'), undefined)
})

test('set with updated pendingActumId updates the actum index', () => {
  const store = new MemoryFlowContextStore()
  const ctx1 = makeCtx({ pendingActumId: 'actum-old' })
  store.set('telegram', 'user-1', ctx1)

  // update ctx with new actumId
  const ctx2 = makeCtx({ pendingActumId: 'actum-new' })
  store.set('telegram', 'user-1', ctx2)

  assert.equal(store.findByPendingActumId('actum-old'), undefined, 'old actum index should be removed')
  const result = store.findByPendingActumId('actum-new')
  assert.deepEqual(result, ctx2)
})

test('set with no pendingActumId removes old actum index entry', () => {
  const store = new MemoryFlowContextStore()
  store.set('telegram', 'user-1', makeCtx({ pendingActumId: 'actum-99' }))
  // overwrite without pendingActumId
  store.set('telegram', 'user-1', makeCtx())
  assert.equal(store.findByPendingActumId('actum-99'), undefined)
})

test('different platforms with same userId are independent', () => {
  const store = new MemoryFlowContextStore()
  const ctxA = makeCtx({ platform: 'telegram', intent: 'execute' })
  const ctxB = makeCtx({ platform: 'discord', intent: 'train' })
  store.set('telegram', 'user-1', ctxA)
  store.set('discord', 'user-1', ctxB)
  assert.equal(store.get('telegram', 'user-1')?.intent, 'execute')
  assert.equal(store.get('discord', 'user-1')?.intent, 'train')
})
