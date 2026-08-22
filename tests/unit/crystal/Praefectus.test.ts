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
    async findWarm({ imageRef, podPolicy, shareToken }) {
      return materiae.find(m => {
        if (m.status !== 'idle') return false
        if (shareToken) return m.shareToken === shareToken
        if (imageRef && m.imageRef !== imageRef) return false
        if (podPolicy && m.podPolicy !== podPolicy) return false
        return true
      }) ?? null
    },
    // The rest of the MateriaStore surface. Praefectus is exercised here through
    // findWarm/findById/update only, so these are unreached and throw rather than
    // return a plausible default.
    async findActive(): Promise<Materia[]> {
      throw new Error('makeStore.findActive: not implemented for this suite')
    },
    async reapIdle(): Promise<Materia[]> {
      throw new Error('makeStore.reapIdle: not implemented for this suite')
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

// ── findWarm() — economy routing ──────────────────────────────────────────────

test('findWarm(forEconomy) returns only economy-policy pods', async () => {
  const privateM = makeMateria({ id: 'mat-priv', podPolicy: 'private' })
  const economyM = makeMateria({ id: 'mat-eco', podPolicy: 'economy' })
  const praefectus = new Praefectus(makeStore([privateM, economyM]))
  const result = await praefectus.findWarm('stationthis/flux-comfyui:v1', { forEconomy: true })
  assert.ok(result)
  assert.equal(result.id, 'mat-eco')
})

test('findWarm(forEconomy) returns null when no economy pod is available', async () => {
  const privateM = makeMateria({ podPolicy: 'private' })
  const praefectus = new Praefectus(makeStore([privateM]))
  const result = await praefectus.findWarm('stationthis/flux-comfyui:v1', { forEconomy: true })
  assert.equal(result, null)
})

test('findWarm() without forEconomy returns any idle pod regardless of policy', async () => {
  const privateM = makeMateria({ id: 'mat-priv', podPolicy: 'private' })
  const praefectus = new Praefectus(makeStore([privateM]))
  const result = await praefectus.findWarm('stationthis/flux-comfyui:v1')
  assert.ok(result)
  assert.equal(result.id, 'mat-priv')
})

// ── findByShareToken() ────────────────────────────────────────────────────────

test('findByShareToken() returns the pod matching the token', async () => {
  const materia = makeMateria({ podPolicy: 'link', shareToken: 'tok-abc' })
  const praefectus = new Praefectus(makeStore([materia]))
  const result = await praefectus.findByShareToken('tok-abc')
  assert.ok(result)
  assert.equal(result.shareToken, 'tok-abc')
})

test('findByShareToken() returns null for wrong token', async () => {
  const materia = makeMateria({ podPolicy: 'link', shareToken: 'tok-abc' })
  const praefectus = new Praefectus(makeStore([materia]))
  const result = await praefectus.findByShareToken('tok-xyz')
  assert.equal(result, null)
})

test('findByShareToken() returns null when pod is not idle', async () => {
  const materia = makeMateria({ status: 'active', podPolicy: 'link', shareToken: 'tok-abc' })
  const praefectus = new Praefectus(makeStore([materia]))
  const result = await praefectus.findByShareToken('tok-abc')
  assert.equal(result, null)
})
