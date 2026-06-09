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

// ── affines (re-homed from Anima.affines) ──────────────────────────────────────

test('MemoryConsuetudinum — setAffines then resolveAffines round-trips per modus', async () => {
  const store = new MemoryConsuetudinum()
  const owner = { animaId: 'anima-1' }
  await store.setAffines(owner, 'sd1-5', { steps: 30, cfg: 7 })
  assert.deepEqual(await store.resolveAffines(owner, 'sd1-5'), { steps: 30, cfg: 7 })
  assert.equal(await store.resolveAffines(owner, 'flux-schnell'), undefined, 'per-modus, not global')
})

test('MemoryConsuetudinum — setAffines replaces the prior map; commitment owners work', async () => {
  const store = new MemoryConsuetudinum()
  await store.setAffines({ animaId: 'a' }, 'sd1-5', { steps: 10 })
  await store.setAffines({ animaId: 'a' }, 'sd1-5', { steps: 40 })
  assert.deepEqual(await store.resolveAffines({ animaId: 'a' }, 'sd1-5'), { steps: 40 })

  await store.setAffines({ commitment: 'c-1' }, 'sd1-5', { steps: 5 })
  assert.deepEqual(await store.resolveAffines({ commitment: 'c-1' }, 'sd1-5'), { steps: 5 })
  assert.equal(await store.resolveAffines({ commitment: 'c-2' }, 'sd1-5'), undefined, 'owner isolation')
})

test('MemoryConsuetudinum — verb rebinds and affines never collide on the same owner+modus', async () => {
  const store = new MemoryConsuetudinum()
  const owner = { animaId: 'anima-1' }
  await store.bind(owner, 'make', 'sd1-5')          // verb 'make' → modus 'sd1-5'
  await store.setAffines(owner, 'make', { steps: 99 })  // affines keyed by modusId 'make' (contrived overlap)
  assert.equal(await store.resolve(owner, 'make'), 'sd1-5', 'verb rebind intact')
  assert.deepEqual(await store.resolveAffines(owner, 'make'), { steps: 99 }, 'affines intact')
})
