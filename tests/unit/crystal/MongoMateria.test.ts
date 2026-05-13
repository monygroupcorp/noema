import { test, before, after, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { MongoClient, Collection } from 'mongodb'
import { MongoMateria } from '../../../src/crystal/MongoMateria.js'
import type { Materia } from '../../../src/types/materia.js'

const URI = process.env.MONGO_PASS ?? process.env.MONGODB_URI ?? 'mongodb://localhost:27017'
const DB = 'noemaplane_test'
const COL = 'materiae_unit'

let client: MongoClient
let col: Collection
let store: MongoMateria

function makeInput(overrides: Partial<Omit<Materia, 'id'>> = {}): Omit<Materia, 'id'> {
  return {
    genus: 'runpod',
    externusId: `ext-${Math.random().toString(36).slice(2)}`,
    gpu: 'RTX4090',
    vramGb: 24,
    ramGb: 64,
    impetusPerSecond: 1n,
    status: 'idle',
    ...overrides,
  }
}

before(async () => {
  client = new MongoClient(URI)
  await client.connect()
  col = client.db(DB).collection(COL)
  await col.createIndex({ id: 1 }, { unique: true })
  store = new MongoMateria(col)
})

afterEach(async () => {
  await col.deleteMany({})
})

after(async () => {
  await client.db(DB).dropCollection(COL).catch(() => {})
  await client.close()
})

// ── create ────────────────────────────────────────────────────────────────────

test('create returns materia with the given fields intact', async () => {
  const input = makeInput({ gpu: 'A100-80GB', vramGb: 80, ramGb: 128 })
  const m = await store.create(input)
  assert.ok(m.id)
  assert.equal(m.genus, 'runpod')
  assert.equal(m.gpu, 'A100-80GB')
  assert.equal(m.vramGb, 80)
  assert.equal(m.ramGb, 128)
  assert.equal(m.status, 'idle')
})

test('create round-trips impetusPerSecond as bigint', async () => {
  const input = makeInput({ impetusPerSecond: 337n })
  const m = await store.create(input)
  const found = await store.findById(m.id)
  assert.ok(found)
  assert.equal(typeof found.impetusPerSecond, 'bigint')
  assert.equal(found.impetusPerSecond, 337n)
})

test('create round-trips zero impetusPerSecond', async () => {
  const input = makeInput({ impetusPerSecond: 0n })
  const m = await store.create(input)
  const found = await store.findById(m.id)
  assert.ok(found)
  assert.equal(found.impetusPerSecond, 0n)
  assert.equal(typeof found.impetusPerSecond, 'bigint')
})

// ── findById ──────────────────────────────────────────────────────────────────

test('findById returns null for unknown id', async () => {
  const result = await store.findById('no-such-id')
  assert.equal(result, null)
})

test('findById returns stored materia', async () => {
  const input = makeInput({ externusId: 'pod-abc123' })
  const created = await store.create(input)
  const found = await store.findById(created.id)
  assert.ok(found)
  assert.equal(found.id, created.id)
  assert.equal(found.externusId, 'pod-abc123')
})

// ── update ────────────────────────────────────────────────────────────────────

test('update patches status', async () => {
  const m = await store.create(makeInput())
  const updated = await store.update(m.id, { status: 'active' })
  assert.equal(updated.status, 'active')
})

test('update patches sshHost and sshPort', async () => {
  const m = await store.create(makeInput())
  const updated = await store.update(m.id, { sshHost: '192.168.1.100', sshPort: 22222 })
  assert.equal(updated.sshHost, '192.168.1.100')
  assert.equal(updated.sshPort, 22222)
})

test('update patches imageRef', async () => {
  const m = await store.create(makeInput())
  const updated = await store.update(m.id, { imageRef: 'stationthis/flux-comfyui:v2' })
  assert.equal(updated.imageRef, 'stationthis/flux-comfyui:v2')
})

test('update throws for unknown id', async () => {
  await assert.rejects(
    () => store.update('ghost-id', { status: 'terminated' }),
    /not found/i
  )
})

// ── findWarm ──────────────────────────────────────────────────────────────────

test('findWarm returns an idle materia with matching imageRef', async () => {
  const input = makeInput({ status: 'idle', imageRef: 'stationthis/flux-comfyui:v1' })
  const created = await store.create(input)
  const found = await store.findWarm({ imageRef: 'stationthis/flux-comfyui:v1' })
  assert.ok(found)
  assert.equal(found.id, created.id)
  assert.equal(found.status, 'idle')
})

test('findWarm returns null when no idle materia exists', async () => {
  const result = await store.findWarm({ imageRef: 'stationthis/flux-comfyui:v1' })
  assert.equal(result, null)
})

test('findWarm returns null when materia is active (not idle)', async () => {
  const input = makeInput({ status: 'active', imageRef: 'stationthis/flux-comfyui:v1' })
  await store.create(input)
  const result = await store.findWarm({ imageRef: 'stationthis/flux-comfyui:v1' })
  assert.equal(result, null)
})

test('findWarm returns null when imageRef does not match', async () => {
  const input = makeInput({ status: 'idle', imageRef: 'stationthis/flux-comfyui:v1' })
  await store.create(input)
  const result = await store.findWarm({ imageRef: 'stationthis/flux-comfyui:v2' })
  assert.equal(result, null)
})
