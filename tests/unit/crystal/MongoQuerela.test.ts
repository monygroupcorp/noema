import { test, before, after, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { MongoClient, Collection } from 'mongodb'
import { MongoQuerela } from '../../../src/crystal/MongoQuerela.js'
import { ownerKeyOf } from '../../../src/crystal/ownerKey.js'
import type { Querela } from '../../../src/types/Querela.js'

const URI = process.env.MONGO_PASS ?? process.env.MONGODB_URI ?? 'mongodb://localhost:27017'
const DB = 'noemaplane_test'
const COL = 'querelae_unit'

let client: MongoClient
let col: Collection
let store: MongoQuerela

function makeInput(overrides: Partial<Omit<Querela, 'id' | 'natum' | 'mutatum'>> = {}) {
  return {
    ownerKey: 'anima:anima-abc',
    kind: 'bug' as const,
    status: 'new' as const,
    description: 'the button does nothing',
    contentHash: 'hash-1',
    ...overrides,
  }
}

before(async () => {
  client = new MongoClient(URI)
  await client.connect()
  col = client.db(DB).collection(COL)
  await col.deleteMany({})
  await col.createIndex({ id: 1 }, { unique: true })
  store = new MongoQuerela(col)
})

afterEach(async () => { await col.deleteMany({}) })
after(async () => {
  await client.db(DB).dropCollection(COL).catch(() => {})
  await client.close()
})

test('create returns querela with id, natum, mutatum', async () => {
  const q = await store.create(makeInput())
  assert.ok(q.id)
  assert.ok(q.natum instanceof Date)
  assert.ok(q.mutatum instanceof Date)
})

test('create stores each kind', async () => {
  const bug = await store.create(makeInput({ kind: 'bug', capturedState: { route: '/studio', runId: 'run-1' } }))
  assert.equal(bug.kind, 'bug')
  assert.equal(bug.capturedState?.route, '/studio')

  const feature = await store.create(makeInput({ kind: 'feature', feature: 'export to PDF', contentHash: 'hash-2' }))
  assert.equal(feature.kind, 'feature')
  assert.equal(feature.feature, 'export to PDF')

  const feedback = await store.create(makeInput({ kind: 'feedback', description: 'love this!', contentHash: 'hash-3' }))
  assert.equal(feedback.kind, 'feedback')
})

test('find returns null for unknown id', async () => {
  assert.equal(await store.find('nope'), null)
})

test('find returns created querela', async () => {
  const created = await store.create(makeInput())
  const found = await store.find(created.id)
  assert.equal(found?.id, created.id)
  assert.equal(found?.ownerKey, 'anima:anima-abc')
})

test('findByOwner returns all querelae for owner, across identity kinds', async () => {
  const animaOwner = ownerKeyOf({ animaId: 'anima-abc' })
  const commitmentOwner = ownerKeyOf({ commitment: 'commit-xyz' })
  const bursaOwner = ownerKeyOf({ bursaToken: 'bursa-tok' })
  await store.create(makeInput({ ownerKey: animaOwner, contentHash: 'h1' }))
  await store.create(makeInput({ ownerKey: animaOwner, contentHash: 'h2' }))
  await store.create(makeInput({ ownerKey: commitmentOwner, contentHash: 'h3' }))
  await store.create(makeInput({ ownerKey: bursaOwner, contentHash: 'h4' }))

  assert.equal((await store.findByOwner(animaOwner)).length, 2)
  assert.equal((await store.findByOwner(commitmentOwner)).length, 1)
  assert.equal((await store.findByOwner(bursaOwner)).length, 1)
})

test('findByOwner filters by status when provided', async () => {
  const owner = ownerKeyOf({ animaId: 'anima-abc' })
  await store.create(makeInput({ ownerKey: owner, status: 'new', contentHash: 'h1' }))
  const closed = await store.create(makeInput({ ownerKey: owner, status: 'new', contentHash: 'h2' }))
  await store.update(closed.id, { status: 'closed' })

  const newOnes = await store.findByOwner(owner, 'new')
  assert.equal(newOnes.length, 1)
  const closedOnes = await store.findByOwner(owner, 'closed')
  assert.equal(closedOnes.length, 1)
})

test('update sets status and bumps mutatum', async () => {
  const created = await store.create(makeInput())
  const before = created.mutatum
  await new Promise(r => setTimeout(r, 5))
  const updated = await store.update(created.id, { status: 'closed' })
  assert.equal(updated.status, 'closed')
  assert.ok(updated.mutatum.getTime() >= before.getTime())
})

test('findByOwnerAndHash returns matching record', async () => {
  const owner = ownerKeyOf({ animaId: 'anima-abc' })
  const created = await store.create(makeInput({ ownerKey: owner, contentHash: 'dedup-hash' }))
  const found = await store.findByOwnerAndHash(owner, 'dedup-hash')
  assert.equal(found?.id, created.id)
})

test('findByOwnerAndHash returns null when no match', async () => {
  const owner = ownerKeyOf({ animaId: 'anima-abc' })
  assert.equal(await store.findByOwnerAndHash(owner, 'no-such-hash'), null)
})
