import { test, before, after, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { MongoClient, Collection } from 'mongodb'
import { MongoPersona } from '../../../src/crystal/MongoPersona.js'

const URI = process.env.MONGO_PASS ?? process.env.MONGODB_URI ?? 'mongodb://localhost:27017'
const DB = 'noemaplane_test'
const COL = 'personae_unit'

let client: MongoClient
let col: Collection
let store: MongoPersona

before(async () => {
  client = new MongoClient(URI)
  await client.connect()
  col = client.db(DB).collection(COL)
  await col.createIndex({ id: 1 }, { unique: true })
  await col.createIndex({ genus: 1, externusId: 1 }, { unique: true })
  store = new MongoPersona(col)
})

afterEach(async () => {
  await col.deleteMany({})
})

after(async () => {
  await client.db(DB).dropCollection(COL).catch(() => {})
  await client.close()
})

// ── findOrCreate ──────────────────────────────────────────────────────────────

test('findOrCreate creates new persona with id, natum, visum', async () => {
  const p = await store.findOrCreate('telegram', 'tg-111', { animaId: 'anima-a' })
  assert.ok(p.id)
  assert.ok(p.natum instanceof Date)
  assert.ok(p.visum instanceof Date)
})

test('findOrCreate sets genus, externusId, animaId, status active', async () => {
  const p = await store.findOrCreate('telegram', 'tg-111', { animaId: 'anima-a' })
  assert.equal(p.genus, 'telegram')
  assert.equal(p.externusId, 'tg-111')
  assert.equal(p.animaId, 'anima-a')
  assert.equal(p.status, 'active')
})

test('findOrCreate sets nomen from defaults', async () => {
  const p = await store.findOrCreate('discord', 'dc-222', { animaId: 'anima-b', nomen: 'Alice' })
  assert.equal(p.nomen, 'Alice')
})

test('findOrCreate returns same persona on second call', async () => {
  const first = await store.findOrCreate('telegram', 'tg-111', { animaId: 'anima-a' })
  const second = await store.findOrCreate('telegram', 'tg-111', { animaId: 'anima-a' })
  assert.equal(first.id, second.id)
})

test('findOrCreate updates visum on second call', async () => {
  const first = await store.findOrCreate('telegram', 'tg-111', { animaId: 'anima-a' })
  await new Promise(r => setTimeout(r, 5))
  const second = await store.findOrCreate('telegram', 'tg-111', { animaId: 'anima-a' })
  assert.ok(second.visum > first.visum)
})

test('findOrCreate same externusId on different genus creates separate personae', async () => {
  const tg = await store.findOrCreate('telegram', 'user-123', { animaId: 'anima-a' })
  const dc = await store.findOrCreate('discord', 'user-123', { animaId: 'anima-a' })
  assert.notEqual(tg.id, dc.id)
  assert.equal(tg.genus, 'telegram')
  assert.equal(dc.genus, 'discord')
})

test('findOrCreate is idempotent — repeated calls do not create duplicates', async () => {
  await store.findOrCreate('web', 'did:privy:abc', { animaId: 'anima-c' })
  await store.findOrCreate('web', 'did:privy:abc', { animaId: 'anima-c' })
  await store.findOrCreate('web', 'did:privy:abc', { animaId: 'anima-c' })
  const personae = await store.findByAnimaId('anima-c')
  assert.equal(personae.length, 1)
})

// ── findByAnimaId ─────────────────────────────────────────────────────────────

test('findByAnimaId returns empty array for unknown animaId', async () => {
  const personae = await store.findByAnimaId('ghost')
  assert.deepEqual(personae, [])
})

test('findByAnimaId returns all personae for an anima', async () => {
  await store.findOrCreate('telegram', 'tg-1', { animaId: 'anima-multi' })
  await store.findOrCreate('discord', 'dc-1', { animaId: 'anima-multi' })
  const personae = await store.findByAnimaId('anima-multi')
  assert.equal(personae.length, 2)
})

test('findByAnimaId does not return other animaId personae', async () => {
  await store.findOrCreate('telegram', 'tg-a', { animaId: 'anima-a' })
  await store.findOrCreate('telegram', 'tg-b', { animaId: 'anima-b' })
  const personae = await store.findByAnimaId('anima-a')
  assert.equal(personae.length, 1)
  assert.equal(personae[0].animaId, 'anima-a')
})

// ── findByExternus ────────────────────────────────────────────────────────────

test('findByExternus returns null for unknown', async () => {
  const p = await store.findByExternus('telegram', 'nobody')
  assert.equal(p, null)
})

test('findByExternus returns existing persona', async () => {
  const created = await store.findOrCreate('telegram', 'tg-999', { animaId: 'anima-z' })
  const found = await store.findByExternus('telegram', 'tg-999')
  assert.ok(found)
  assert.equal(found.id, created.id)
})

test('findByExternus does not match wrong genus', async () => {
  await store.findOrCreate('telegram', 'shared-id', { animaId: 'anima-z' })
  const found = await store.findByExternus('discord', 'shared-id')
  assert.equal(found, null)
})
