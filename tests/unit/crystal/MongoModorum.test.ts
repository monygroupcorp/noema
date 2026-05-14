import { test, before, after, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { MongoClient, Collection } from 'mongodb'
import { MongoModorum } from '../../../src/crystal/MongoModorum.js'
import type { Modus } from '../../../src/types/modus.js'

const URI = process.env.MONGO_PASS ?? process.env.MONGODB_URI ?? 'mongodb://localhost:27017'
const DB = 'noemaplane_test'
const COL = 'modi_unit'

let client: MongoClient
let col: Collection
let modorum: MongoModorum

function makeModus(overrides: Partial<Modus> = {}): Modus {
  return {
    id: 'test.modus',
    nomen: 'Test Modus',
    genus: 'atomicus',
    versio: '1.0.0',
    contentHash: 'abc123',
    aditus: { prompt: { type: 'text', required: true } },
    exitus: { image: { type: 'image' } },
    ministerium: 'runpod',
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
  await col.createIndex({ id: 1, versio: 1 }, { unique: true })
  modorum = new MongoModorum(col)
})

afterEach(async () => {
  await col.deleteMany({})
})

after(async () => {
  await client.db(DB).dropCollection(COL).catch(() => {})
  await client.close()
})

// ── register + find ───────────────────────────────────────────────────────────

test('register stores modus readable by find', async () => {
  const m = makeModus()
  await modorum.register(m)
  const found = await modorum.find(m.id)
  assert.ok(found)
  assert.equal(found.id, m.id)
  assert.equal(found.nomen, m.nomen)
})

test('find returns null for unknown id', async () => {
  const result = await modorum.find('no-such-modus')
  assert.equal(result, null)
})

test('find with versio returns that specific version', async () => {
  await modorum.register(makeModus({ versio: '1.0.0', nomen: 'v1' }))
  await modorum.register(makeModus({ versio: '2.0.0', nomen: 'v2', contentHash: 'xyz' }))
  const found = await modorum.find('test.modus', '1.0.0')
  assert.ok(found)
  assert.equal(found.nomen, 'v1')
})

test('find without versio returns latest by natum', async () => {
  await modorum.register(makeModus({
    versio: '1.0.0',
    nomen: 'v1',
    natum: new Date('2025-01-01'),
    contentHash: 'hash1',
  }))
  await modorum.register(makeModus({
    versio: '2.0.0',
    nomen: 'v2',
    natum: new Date('2025-06-01'),
    contentHash: 'hash2',
  }))
  const found = await modorum.find('test.modus')
  assert.ok(found)
  assert.equal(found.nomen, 'v2')
})

test('find returns null for unknown versio', async () => {
  await modorum.register(makeModus())
  const result = await modorum.find('test.modus', '99.0.0')
  assert.equal(result, null)
})

test('register is idempotent — same id+versio does not throw', async () => {
  const m = makeModus()
  await modorum.register(m)
  await assert.doesNotReject(() => modorum.register(m))
})

test('register preserves bigint impetusFixum through round-trip', async () => {
  await modorum.register(makeModus({ impetusFixum: 1800n }))
  const found = await modorum.find('test.modus')
  assert.ok(found)
  assert.equal(typeof found.impetusFixum, 'bigint')
  assert.equal(found.impetusFixum, 1800n)
})

test('register preserves undefined impetusFixum', async () => {
  await modorum.register(makeModus())
  const found = await modorum.find('test.modus')
  assert.ok(found)
  assert.equal(found.impetusFixum, undefined)
})

test('register preserves extra fields (Essentia extensions)', async () => {
  const m = makeModus({
    categoria: 'image',
    intellaId: 'intella.flux-schnell',
    runpodSpec: {
      imageId: 'runpod/pytorch',
      imageVersion: '2.4.0',
      workflowTemplate: 'flux-schnell',
      workflowTemplateVersion: '1',
    },
  } as any)
  await modorum.register(m)
  const found = await modorum.find('test.modus') as any
  assert.ok(found)
  assert.equal(found.categoria, 'image')
  assert.equal(found.intellaId, 'intella.flux-schnell')
  assert.deepEqual(found.runpodSpec, m.runpodSpec)
})

// ── list ──────────────────────────────────────────────────────────────────────

test('list returns all registered modi', async () => {
  await modorum.register(makeModus({ id: 'a.tool', contentHash: 'h1' }))
  await modorum.register(makeModus({ id: 'b.tool', contentHash: 'h2' }))
  const all = await modorum.list()
  assert.equal(all.length, 2)
})

test('list filters by canonica', async () => {
  await modorum.register(makeModus({ id: 'canon.tool', canonica: true, contentHash: 'h1' }))
  await modorum.register(makeModus({ id: 'community.tool', canonica: false, contentHash: 'h2' }))
  const canonical = await modorum.list({ canonica: true })
  assert.equal(canonical.length, 1)
  assert.equal(canonical[0].id, 'canon.tool')
})

test('list filters by genus', async () => {
  await modorum.register(makeModus({ id: 'atomic.tool', genus: 'atomicus', contentHash: 'h1' }))
  await modorum.register(makeModus({ id: 'composed.tool', genus: 'compositus', contentHash: 'h2' }))
  const atomici = await modorum.list({ genus: 'atomicus' })
  assert.equal(atomici.length, 1)
  assert.equal(atomici[0].id, 'atomic.tool')
})

test('list filters by auctor', async () => {
  await modorum.register(makeModus({ id: 'owned.tool', auctor: 'anima-123', contentHash: 'h1' }))
  await modorum.register(makeModus({ id: 'other.tool', auctor: 'anima-456', contentHash: 'h2' }))
  const mine = await modorum.list({ auctor: 'anima-123' })
  assert.equal(mine.length, 1)
  assert.equal(mine[0].id, 'owned.tool')
})

test('list with no filter and empty collection returns empty array', async () => {
  const result = await modorum.list()
  assert.deepEqual(result, [])
})

// ── update ────────────────────────────────────────────────────────────────────

test('update sets computeStrategy on a modus', async () => {
  await modorum.register(makeModus())
  const updated = await modorum.update('test.modus', { computeStrategy: 'performance' })
  assert.equal(updated.computeStrategy, 'performance')
})

test('update sets gpuClass on a modus', async () => {
  await modorum.register(makeModus())
  const updated = await modorum.update('test.modus', { gpuClass: 'ultra' })
  assert.equal(updated.gpuClass, 'ultra')
})

test('update sets podPolicy on a modus', async () => {
  await modorum.register(makeModus())
  const updated = await modorum.update('test.modus', { podPolicy: 'private' })
  assert.equal(updated.podPolicy, 'private')
})

test('update persists all three preferences together', async () => {
  await modorum.register(makeModus())
  const updated = await modorum.update('test.modus', {
    computeStrategy: 'economy',
    gpuClass: 'standard',
    podPolicy: 'economy',
  })
  assert.equal(updated.computeStrategy, 'economy')
  assert.equal(updated.gpuClass, 'standard')
  assert.equal(updated.podPolicy, 'economy')
})

test('update throws for unknown modus id', async () => {
  await assert.rejects(
    () => modorum.update('ghost.modus', { computeStrategy: 'standard' }),
    /not found/i,
  )
})

test('update does not change contentHash', async () => {
  await modorum.register(makeModus({ contentHash: 'hash-locked' }))
  const updated = await modorum.update('test.modus', { computeStrategy: 'performance' })
  assert.equal(updated.contentHash, 'hash-locked')
})
