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

test('findOrCreate sets genus, externusId, activeAnimaId, animaIds, status active', async () => {
  const p = await store.findOrCreate('telegram', 'tg-111', { animaId: 'anima-a' })
  assert.equal(p.genus, 'telegram')
  assert.equal(p.externusId, 'tg-111')
  assert.equal(p.activeAnimaId, 'anima-a')
  assert.deepEqual(p.animaIds, ['anima-a'])
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
  assert.equal(personae[0].activeAnimaId, 'anima-a')
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

// ── linkAnima ─────────────────────────────────────────────────────────────────

test('linkAnima appends animaId to animaIds without changing activeAnimaId', async () => {
  const created = await store.findOrCreate('telegram', 'tg-link', { animaId: 'anima-orig' })
  const updated = await store.linkAnima(created.id, 'anima-new')
  assert.deepEqual(updated.animaIds, ['anima-orig', 'anima-new'])
  assert.equal(updated.activeAnimaId, 'anima-orig')
})

test('linkAnima is idempotent — linking same animaId twice keeps only one entry', async () => {
  const created = await store.findOrCreate('telegram', 'tg-idem', { animaId: 'anima-orig' })
  await store.linkAnima(created.id, 'anima-dup')
  const updated = await store.linkAnima(created.id, 'anima-dup')
  assert.equal(updated.animaIds.filter((a: string) => a === 'anima-dup').length, 1)
})

test('linkAnima throws for unknown personaId', async () => {
  await assert.rejects(
    () => store.linkAnima('no-such-id', 'anima-x'),
    /Persona not found/
  )
})

// ── switchAnima ───────────────────────────────────────────────────────────────

test('switchAnima updates activeAnimaId to a linked animaId', async () => {
  const created = await store.findOrCreate('telegram', 'tg-switch', { animaId: 'anima-orig' })
  await store.linkAnima(created.id, 'anima-second')
  const updated = await store.switchAnima(created.id, 'anima-second')
  assert.equal(updated.activeAnimaId, 'anima-second')
  assert.deepEqual(updated.animaIds, ['anima-orig', 'anima-second'])
})

test('switchAnima throws when animaId is not in animaIds', async () => {
  const created = await store.findOrCreate('telegram', 'tg-sw-bad', { animaId: 'anima-orig' })
  await assert.rejects(
    () => store.switchAnima(created.id, 'anima-unlinked'),
    /Persona not found or animaId not linked/
  )
})

test('switchAnima throws for unknown personaId', async () => {
  await assert.rejects(
    () => store.switchAnima('no-such-id', 'anima-x'),
    /Persona not found or animaId not linked/
  )
})
