import { test, before, after, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { MongoClient, Collection } from 'mongodb'
import { MongoFundamentorum } from '../../../src/crystal/MongoFundamentorum.js'
import type { Fundamentum } from '../../../src/types/fundamentum.js'

const URI = process.env.MONGO_PASS ?? process.env.MONGODB_URI ?? 'mongodb://localhost:27017'
const DB = 'noemaplane_test'
const COL = 'fundamenta_unit'

let client: MongoClient
let col: Collection
let store: MongoFundamentorum

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

before(async () => {
  client = new MongoClient(URI)
  await client.connect()
  col = client.db(DB).collection(COL)
  store = new MongoFundamentorum(col)
})
after(async () => { await client.close() })
afterEach(async () => { await col.deleteMany({}) })

test('register then find round-trips; _id is stripped', async () => {
  await store.register(fund())
  const found = await store.find('flux-comfyui', '1.0.0')
  assert.ok(found)
  assert.equal(found.imageId, 'runpod/pytorch')
  assert.deepEqual(found.intellae, [{ id: 'intella.flux-schnell-fp8-scaled', role: 'unet' }])
  assert.equal('_id' in (found as unknown as Record<string, unknown>), false)
})

test('register upserts per (id, versio); two versions coexist; find without versio is latest', async () => {
  await store.register(fund({ versio: '1.0.0', natum: new Date('2025-01-01') }))
  await store.register(fund({ versio: '2.0.0', imageVersion: '2.5.0', natum: new Date('2025-06-01') }))
  assert.equal((await store.find('flux-comfyui', '1.0.0'))?.imageVersion, '2.4.0', 'pinned old version intact')
  assert.equal((await store.find('flux-comfyui', '2.0.0'))?.imageVersion, '2.5.0')
  assert.equal((await store.find('flux-comfyui'))?.versio, '2.0.0', 'no pin → latest by natum')
  assert.equal(await col.countDocuments({ id: 'flux-comfyui' }), 2)
})

test('re-registering the same (id, versio) replaces, does not duplicate', async () => {
  await store.register(fund({ versio: '1.0.0', vramGb: 24 }))
  await store.register(fund({ versio: '1.0.0', vramGb: 16 }))
  assert.equal(await col.countDocuments({ id: 'flux-comfyui', versio: '1.0.0' }), 1)
  assert.equal((await store.find('flux-comfyui', '1.0.0'))?.vramGb, 16)
})

test('list filters by canonica and owner', async () => {
  await store.register(fund({ id: 'flux-comfyui', canonica: true }))
  await store.register(fund({ id: 'my-fund', canonica: false, auctor: { animaId: 'anima-1' } }))
  assert.deepEqual((await store.list({ canonica: true })).map(f => f.id), ['flux-comfyui'])
  assert.deepEqual((await store.list({ auctor: { animaId: 'anima-1' } })).map(f => f.id), ['my-fund'])
})
