import { test } from 'node:test'
import assert from 'node:assert/strict'
import { MemoryFundamentorum } from '../../../src/crystal/MemoryFundamentorum.js'
import type { Fundamentum } from '../../../src/types/fundamentum.js'

function fund(overrides: Partial<Fundamentum> = {}): Fundamentum {
  return {
    id: 'flux-comfyui',
    versio: '1.0.0',
    imageId: 'runpod/pytorch',
    imageVersion: '2.4.0',
    runtime: 'ComfyUI',
    intellae: [{ id: 'intella.flux-schnell-fp8-scaled', role: 'unet' }],
    vramGb: 24,
    canonica: true,
    natum: new Date('2025-01-01'),
    mutatum: new Date('2025-01-01'),
    ...overrides,
  }
}

test('register then find round-trips; find without versio returns the latest', async () => {
  const store = new MemoryFundamentorum()
  await store.register(fund({ versio: '1.0.0', natum: new Date('2025-01-01') }))
  await store.register(fund({ versio: '2.0.0', natum: new Date('2025-06-01'), vramGb: 48 }))

  assert.equal((await store.find('flux-comfyui', '1.0.0'))?.vramGb, 24, 'pinned version resolves exactly')
  assert.equal((await store.find('flux-comfyui', '2.0.0'))?.vramGb, 48)
  assert.equal((await store.find('flux-comfyui'))?.versio, '2.0.0', 'no pin → latest by natum')
  assert.equal(await store.find('nope'), null)
})

test('the version pin is what isolates flows from a fundament edit', async () => {
  // A flow pinned to @1.0.0 keeps resolving the OLD substrate after a new version is published.
  const store = new MemoryFundamentorum([fund({ versio: '1.0.0', imageVersion: '2.4.0' })])
  await store.register(fund({ versio: '2.0.0', imageVersion: '2.5.0', natum: new Date('2025-06-01') }))
  assert.equal((await store.find('flux-comfyui', '1.0.0'))?.imageVersion, '2.4.0', 'pinned flow unaffected by the new version')
})

test('list filters by canonica and owner', async () => {
  const store = new MemoryFundamentorum([
    fund({ id: 'flux-comfyui', canonica: true }),
    fund({ id: 'my-fund', canonica: false, auctor: { animaId: 'anima-1' } }),
  ])
  assert.deepEqual((await store.list({ canonica: true })).map(f => f.id), ['flux-comfyui'])
  assert.deepEqual((await store.list({ auctor: { animaId: 'anima-1' } })).map(f => f.id), ['my-fund'])
  assert.equal((await store.list()).length, 2)
})
