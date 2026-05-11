import { test, before, after, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { MongoClient, Collection } from 'mongodb'
import { MongoModo } from '../../../src/crystal/MongoModo.js'
import type { Modo } from '../../../src/types/modo.js'

const URI = process.env.MONGO_PASS ?? process.env.MONGODB_URI ?? 'mongodb://localhost:27017'
const DB = 'noemaplane_test'
const COL = 'modos_unit'

let client: MongoClient
let col: Collection
let store: MongoModo

function makeInput(overrides: Partial<Omit<Modo, 'id' | 'inceptum'>> = {}): Omit<Modo, 'id' | 'inceptum'> {
  return {
    status: 'claiming',
    impetusAccrued: 0n,
    acta: [],
    idleWarmthSec: 300,
    ...overrides,
  }
}

before(async () => {
  client = new MongoClient(URI)
  await client.connect()
  col = client.db(DB).collection(COL)
  await col.createIndex({ id: 1 }, { unique: true })
  store = new MongoModo(col)
})

afterEach(async () => {
  await col.deleteMany({})
})

after(async () => {
  await client.db(DB).dropCollection(COL).catch(() => {})
  await client.close()
})

// ── create ────────────────────────────────────────────────────────────────────

test('create returns modo with id and inceptum', async () => {
  const m = await store.create(makeInput())
  assert.ok(m.id)
  assert.ok(m.inceptum instanceof Date)
})

test('create sets status, impetusAccrued, acta', async () => {
  const m = await store.create(makeInput())
  assert.equal(m.status, 'claiming')
  assert.equal(m.impetusAccrued, 0n)
  assert.deepEqual(m.acta, [])
})

test('create impetusAccrued round-trips as bigint', async () => {
  const m = await store.create(makeInput({ impetusAccrued: 999n }))
  const found = await store.findById(m.id)
  assert.equal(found!.impetusAccrued, 999n)
  assert.equal(typeof found!.impetusAccrued, 'bigint')
})

test('create stores idleWarmthSec', async () => {
  const m = await store.create(makeInput({ idleWarmthSec: 600 }))
  assert.equal(m.idleWarmthSec, 600)
})

// ── findById ──────────────────────────────────────────────────────────────────

test('findById returns null for unknown id', async () => {
  const m = await store.findById('nope')
  assert.equal(m, null)
})

test('findById returns the created modo', async () => {
  const created = await store.create(makeInput())
  const found = await store.findById(created.id)
  assert.ok(found)
  assert.equal(found.id, created.id)
})

// ── update ────────────────────────────────────────────────────────────────────

test('update changes status', async () => {
  const m = await store.create(makeInput())
  const updated = await store.update(m.id, { status: 'active' })
  assert.equal(updated.status, 'active')
})

test('update sets materiamId', async () => {
  const m = await store.create(makeInput())
  const updated = await store.update(m.id, { materiamId: 'pod-xyz' })
  assert.equal(updated.materiamId, 'pod-xyz')
})

test('update appends acta', async () => {
  const m = await store.create(makeInput())
  const updated = await store.update(m.id, { acta: ['actum-1', 'actum-2'] })
  assert.deepEqual(updated.acta, ['actum-1', 'actum-2'])
})

test('update increments impetusAccrued', async () => {
  const m = await store.create(makeInput({ impetusAccrued: 100n }))
  const updated = await store.update(m.id, { impetusAccrued: 250n })
  assert.equal(updated.impetusAccrued, 250n)
})

test('update sets terminatum', async () => {
  const m = await store.create(makeInput())
  const now = new Date()
  const updated = await store.update(m.id, { status: 'terminated', terminatum: now })
  assert.equal(updated.status, 'terminated')
  assert.ok(updated.terminatum instanceof Date)
})

test('update persists — findById returns updated modo', async () => {
  const m = await store.create(makeInput())
  await store.update(m.id, { status: 'warming' })
  const found = await store.findById(m.id)
  assert.equal(found?.status, 'warming')
})

// ── findActive ────────────────────────────────────────────────────────────────

test('findActive returns claiming modos', async () => {
  await store.create(makeInput({ status: 'claiming' }))
  const active = await store.findActive()
  assert.equal(active.length, 1)
})

test('findActive returns warming, active, and idle modos', async () => {
  const a = await store.create(makeInput())
  await store.update(a.id, { status: 'warming' })
  const b = await store.create(makeInput())
  await store.update(b.id, { status: 'active' })
  const c = await store.create(makeInput())
  await store.update(c.id, { status: 'idle' })
  const active = await store.findActive()
  assert.equal(active.length, 3)
})

test('findActive excludes terminated modos', async () => {
  const m = await store.create(makeInput())
  await store.update(m.id, { status: 'terminated', terminatum: new Date() })
  const active = await store.findActive()
  assert.equal(active.length, 0)
})

test('findActive excludes hibernating modos', async () => {
  const m = await store.create(makeInput())
  await store.update(m.id, { status: 'hibernating' })
  const active = await store.findActive()
  assert.equal(active.length, 0)
})
