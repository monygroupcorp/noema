import { test, before, after, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { MongoClient, Collection } from 'mongodb'
import { MongoMandatum } from '../../../src/crystal/MongoMandatum.js'
import type { Mandatum } from '../../../src/types/mandatum.js'

const URI = process.env.MONGO_PASS ?? process.env.MONGODB_URI ?? 'mongodb://localhost:27017'
const DB = 'noemaplane_test'
const COL = 'mandatores_unit'

let client: MongoClient
let col: Collection
let store: MongoMandatum

function makeInput(overrides: Partial<Omit<Mandatum, 'id' | 'natum' | 'mutatum' | 'acta' | 'ignitions'>> = {}) {
  return {
    modusId: 'modus-flux',
    aditus: { prompt: 'daily portrait' },
    by: { animaId: 'anima-abc' } as { animaId: string },
    triggerGenus: 'schedula' as const,
    schedula: { cron: '0 9 * * *' },
    status: 'active' as const,
    ...overrides,
  }
}

before(async () => {
  client = new MongoClient(URI)
  await client.connect()
  col = client.db(DB).collection(COL)
  await col.createIndex({ id: 1 }, { unique: true })
  store = new MongoMandatum(col)
})

afterEach(async () => { await col.deleteMany({}) })
after(async () => {
  await client.db(DB).dropCollection(COL).catch(() => {})
  await client.close()
})

test('create returns mandatum with id, natum, mutatum, acta=[], ignitions=0', async () => {
  const m = await store.create(makeInput())
  assert.ok(m.id)
  assert.ok(m.natum instanceof Date)
  assert.ok(m.mutatum instanceof Date)
  assert.deepEqual(m.acta, [])
  assert.equal(m.ignitions, 0)
})

test('create stores modusId, aditus, by, triggerGenus', async () => {
  const m = await store.create(makeInput())
  assert.equal(m.modusId, 'modus-flux')
  assert.equal(m.triggerGenus, 'schedula')
  assert.deepEqual(m.by, { animaId: 'anima-abc' })
})

test('find returns null for unknown id', async () => {
  assert.equal(await store.find('nope'), null)
})

test('find returns created mandatum', async () => {
  const created = await store.create(makeInput())
  const found = await store.find(created.id)
  assert.equal(found?.id, created.id)
})

test('list returns all when no filter', async () => {
  await store.create(makeInput())
  await store.create(makeInput({ status: 'dormiens' }))
  const all = await store.list()
  assert.equal(all.length, 2)
})

test('list filters by status', async () => {
  await store.create(makeInput({ status: 'active' }))
  await store.create(makeInput({ status: 'revocatum' }))
  const active = await store.list({ status: 'active' })
  assert.equal(active.length, 1)
  assert.equal(active[0].status, 'active')
})

test('update changes status and stamps mutatum', async () => {
  const m = await store.create(makeInput())
  await new Promise(r => setTimeout(r, 5))
  const updated = await store.update(m.id, { status: 'dormiens' })
  assert.equal(updated.status, 'dormiens')
  assert.ok(updated.mutatum > updated.natum)
})

test('update increments ignitions and sets ignitum', async () => {
  const m = await store.create(makeInput())
  const now = new Date()
  const updated = await store.update(m.id, { ignitions: 1, ignitum: now, acta: ['actum-1'] })
  assert.equal(updated.ignitions, 1)
  assert.ok(updated.ignitum instanceof Date)
  assert.deepEqual(updated.acta, ['actum-1'])
})

test('due returns active schedula mandata with _nextFire at or before given time', async () => {
  const past = new Date(Date.now() - 60_000)
  const future = new Date(Date.now() + 60_000)
  const a = await store.create(makeInput())
  await store.setNextFire(a.id, past)
  const b = await store.create(makeInput())
  await store.setNextFire(b.id, future)
  const due = await store.due(new Date())
  assert.equal(due.length, 1)
  assert.equal(due[0].id, a.id)
})

test('due excludes non-active mandata', async () => {
  const past = new Date(Date.now() - 60_000)
  const m = await store.create(makeInput({ status: 'dormiens' }))
  await store.setNextFire(m.id, past)
  const due = await store.due(new Date())
  assert.equal(due.length, 0)
})
