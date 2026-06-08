import { test } from 'node:test'
import assert from 'node:assert/strict'
import { MemoryConsuetudinum } from '../../../src/crystal/MemoryConsuetudinum.js'

test('MemoryConsuetudinum — bind then resolve round-trips', async () => {
  const store = new MemoryConsuetudinum()
  const owner = { animaId: 'anima-1' }
  await store.bind(owner, 'make', 'sd1-5')
  assert.equal(await store.resolve(owner, 'make'), 'sd1-5')
})

test('MemoryConsuetudinum — unbound verb resolves to undefined', async () => {
  const store = new MemoryConsuetudinum()
  assert.equal(await store.resolve({ animaId: 'anima-1' }, 'make'), undefined)
})

test('MemoryConsuetudinum — rebind overwrites the prior binding', async () => {
  const store = new MemoryConsuetudinum()
  const owner = { animaId: 'anima-1' }
  await store.bind(owner, 'make', 'sd1-5')
  await store.bind(owner, 'make', 'flux-schnell')
  assert.equal(await store.resolve(owner, 'make'), 'flux-schnell')
})

test('MemoryConsuetudinum — owner isolation (animaId form)', async () => {
  const store = new MemoryConsuetudinum()
  await store.bind({ animaId: 'anima-1' }, 'make', 'sd1-5')
  assert.equal(await store.resolve({ animaId: 'anima-2' }, 'make'), undefined)
})

test('MemoryConsuetudinum — owner isolation (commitment form)', async () => {
  const store = new MemoryConsuetudinum()
  await store.bind({ commitment: 'c-1' }, 'make', 'sd1-5')
  assert.equal(await store.resolve({ commitment: 'c-2' }, 'make'), undefined)
  assert.equal(await store.resolve({ commitment: 'c-1' }, 'make'), 'sd1-5')
})

test('MemoryConsuetudinum — animaId and commitment owners never collide', async () => {
  const store = new MemoryConsuetudinum()
  await store.bind({ animaId: 'x' }, 'make', 'sd1-5')
  assert.equal(await store.resolve({ commitment: 'x' }, 'make'), undefined)
})
