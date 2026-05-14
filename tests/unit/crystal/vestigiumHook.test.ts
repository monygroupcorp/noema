import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createVestigiumFromActum } from '../../../src/execution/hooks/vestigiumHook.js'
import { MemoryVestigiorum } from '../../../src/rag/MemoryVestigiorum.js'
import type { Actum } from '../../../src/types/actum.js'

function makeActum(overrides: Partial<Actum> = {}): Actum {
  const now = new Date()
  return {
    id: 'actum-1',
    modusId: 'modus-flux',
    modusVersiono: '1.0.0',
    impetus: 100n,
    signaConsumed: [],
    aditus: { prompt: 'a cat in space', negative_prompt: 'blurry ugly' },
    status: 'completus',
    exitus: { imageUrl: 'https://cdn.example.com/img.png', caption: 'stellar feline' },
    inceptum: now,
    completum: now,
    expirat: now,
    ...overrides,
  }
}

// ── createVestigiumFromActum ──────────────────────────────────────────────────

test('creates vestigium with correct modusId and auctorKey', async () => {
  const store = new MemoryVestigiorum()
  const v = await createVestigiumFromActum(makeActum(), { animaId: 'anima-abc' }, store)
  assert.equal(v.modusId, 'modus-flux')
  assert.deepEqual(v.auctorKey, { animaId: 'anima-abc' })
})

test('extracts promptum from aditus.prompt', async () => {
  const store = new MemoryVestigiorum()
  const v = await createVestigiumFromActum(
    makeActum({ aditus: { prompt: 'a starry night' } }),
    { animaId: 'anima-abc' },
    store,
  )
  assert.equal(v.promptum, 'a starry night')
})

test('extracts negativum from aditus.negative_prompt', async () => {
  const store = new MemoryVestigiorum()
  const v = await createVestigiumFromActum(
    makeActum({ aditus: { prompt: 'portrait', negative_prompt: 'blurry ugly' } }),
    { animaId: 'anima-abc' },
    store,
  )
  assert.equal(v.negativum, 'blurry ugly')
})

test('negativum is undefined when negative_prompt is absent', async () => {
  const store = new MemoryVestigiorum()
  const v = await createVestigiumFromActum(
    makeActum({ aditus: { prompt: 'portrait' } }),
    { animaId: 'anima-abc' },
    store,
  )
  assert.equal(v.negativum, undefined)
})

test('extracts imagoUrl from exitus.imageUrl', async () => {
  const store = new MemoryVestigiorum()
  const v = await createVestigiumFromActum(
    makeActum({ exitus: { imageUrl: 'https://cdn.example.com/img.png' } }),
    { animaId: 'anima-abc' },
    store,
  )
  assert.equal(v.imagoUrl, 'https://cdn.example.com/img.png')
})

test('imagoUrl is undefined when imageUrl is absent from exitus', async () => {
  const store = new MemoryVestigiorum()
  const v = await createVestigiumFromActum(
    makeActum({ exitus: { caption: 'a scene' } }),
    { animaId: 'anima-abc' },
    store,
  )
  assert.equal(v.imagoUrl, undefined)
})

test('falls back to serialized aditus when no prompt key', async () => {
  const store = new MemoryVestigiorum()
  const v = await createVestigiumFromActum(
    makeActum({ aditus: { seed: 42, steps: 20 } }),
    { animaId: 'anima-abc' },
    store,
  )
  assert.ok(v.promptum.length > 0)
})

test('extracts summarium from exitus caption', async () => {
  const store = new MemoryVestigiorum()
  const v = await createVestigiumFromActum(
    makeActum({ exitus: { imageUrl: 'https://x.com/img.png', caption: 'golden hour' } }),
    { animaId: 'anima-abc' },
    store,
  )
  assert.equal(v.summarium, 'golden hour')
})

test('extracts summarium from exitus text when no caption', async () => {
  const store = new MemoryVestigiorum()
  const v = await createVestigiumFromActum(
    makeActum({ exitus: { text: 'generated prose paragraph' } }),
    { animaId: 'anima-abc' },
    store,
  )
  assert.equal(v.summarium, 'generated prose paragraph')
})

test('falls back to empty string summarium when exitus has no text', async () => {
  const store = new MemoryVestigiorum()
  const v = await createVestigiumFromActum(
    makeActum({ exitus: { imageUrl: 'https://x.com/img.png' } }),
    { animaId: 'anima-abc' },
    store,
  )
  assert.equal(typeof v.summarium, 'string')
})

test('stores intellaIds when provided in options', async () => {
  const store = new MemoryVestigiorum()
  const v = await createVestigiumFromActum(
    makeActum(),
    { animaId: 'anima-abc' },
    store,
    { intellaIds: ['intella-flux-schnell', 'intella-lora-portrait'] },
  )
  assert.deepEqual(v.intellaIds, ['intella-flux-schnell', 'intella-lora-portrait'])
})

test('stores intellaDescription when provided in options', async () => {
  const store = new MemoryVestigiorum()
  const v = await createVestigiumFromActum(
    makeActum(),
    { animaId: 'anima-abc' },
    store,
    { intellaDescription: 'FLUX.1 Schnell — fast latent diffusion, portrait LoRA' },
  )
  assert.equal(v.intellaDescription, 'FLUX.1 Schnell — fast latent diffusion, portrait LoRA')
})

test('sets default visibilitas to privata', async () => {
  const store = new MemoryVestigiorum()
  const v = await createVestigiumFromActum(makeActum(), { animaId: 'anima-abc' }, store)
  assert.equal(v.visibilitas, 'privata')
})

test('sets default genus to image', async () => {
  const store = new MemoryVestigiorum()
  const v = await createVestigiumFromActum(makeActum(), { animaId: 'anima-abc' }, store)
  assert.equal(v.genus, 'image')
})

test('accepts explicit genus override', async () => {
  const store = new MemoryVestigiorum()
  const v = await createVestigiumFromActum(makeActum(), { animaId: 'anima-abc' }, store, { genus: 'video' })
  assert.equal(v.genus, 'video')
})

test('accepts arcanumHash auctorKey', async () => {
  const store = new MemoryVestigiorum()
  const v = await createVestigiumFromActum(makeActum(), { arcanumHash: 'deadbeef' }, store)
  assert.deepEqual(v.auctorKey, { arcanumHash: 'deadbeef' })
})

test('passes actumId onto the vestigium', async () => {
  const store = new MemoryVestigiorum()
  const v = await createVestigiumFromActum(makeActum({ id: 'actum-xyz' }), { animaId: 'anima-abc' }, store)
  assert.equal(v.actumId, 'actum-xyz')
})
