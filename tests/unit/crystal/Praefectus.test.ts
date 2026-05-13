import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Praefectus } from '../../../src/crystal/Praefectus.js'
import type { Materia, MateriaStore } from '../../../src/types/materia.js'

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeMateria(overrides: Partial<Materia> = {}): Materia {
  return {
    id: 'mat-1',
    genus: 'runpod',
    externusId: 'pod-abc',
    gpu: 'NVIDIA GeForce RTX 4090',
    vramGb: 24,
    ramGb: 64,
    impetusPerSecond: 1n,
    status: 'idle',
    imageRef: 'stationthis/flux-comfyui:v1',
    sshHost: '1.2.3.4',
    sshPort: 12345,
    ...overrides,
  }
}

function makeStore(materiae: Materia[] = []): MateriaStore {
  return {
    async create(input) { return { ...input, id: 'mat-new' } },
    async findById(id) { return materiae.find(m => m.id === id) ?? null },
    async update(id, patch) {
      const m = materiae.find(m => m.id === id)
      if (!m) throw new Error(`Materia ${id} not found`)
      return { ...m, ...patch }
    },
    async findWarm({ imageRef }) {
      return materiae.find(m => m.status === 'idle' && m.imageRef === imageRef) ?? null
    },
  }
}

// ── findWarm() ────────────────────────────────────────────────────────────────

test('findWarm() returns an idle Materia with matching imageRef', async () => {
  const materia = makeMateria({ status: 'idle', imageRef: 'stationthis/flux-comfyui:v1' })
  const praefectus = new Praefectus(makeStore([materia]))
  const result = await praefectus.findWarm('stationthis/flux-comfyui:v1')
  assert.ok(result)
  assert.equal(result.id, 'mat-1')
})

test('findWarm() returns null when no idle Materia exists', async () => {
  const praefectus = new Praefectus(makeStore([]))
  const result = await praefectus.findWarm('stationthis/flux-comfyui:v1')
  assert.equal(result, null)
})

test('findWarm() returns null when matching Materia is active (not idle)', async () => {
  const materia = makeMateria({ status: 'active', imageRef: 'stationthis/flux-comfyui:v1' })
  const praefectus = new Praefectus(makeStore([materia]))
  const result = await praefectus.findWarm('stationthis/flux-comfyui:v1')
  assert.equal(result, null)
})

test('findWarm() returns null when imageRef does not match', async () => {
  const materia = makeMateria({ status: 'idle', imageRef: 'stationthis/sdxl:v2' })
  const praefectus = new Praefectus(makeStore([materia]))
  const result = await praefectus.findWarm('stationthis/flux-comfyui:v1')
  assert.equal(result, null)
})

test('findWarm() returns null when Materia has no imageRef', async () => {
  const materia = makeMateria({ status: 'idle', imageRef: undefined })
  const praefectus = new Praefectus(makeStore([materia]))
  const result = await praefectus.findWarm('stationthis/flux-comfyui:v1')
  assert.equal(result, null)
})

test('findWarm() returns null when Materia is terminated', async () => {
  const materia = makeMateria({ status: 'terminated', imageRef: 'stationthis/flux-comfyui:v1' })
  const praefectus = new Praefectus(makeStore([materia]))
  const result = await praefectus.findWarm('stationthis/flux-comfyui:v1')
  assert.equal(result, null)
})
