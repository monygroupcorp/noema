import { test, before, after, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { MongoClient, Collection } from 'mongodb'
import { MongoTabula } from '../../../src/crystal/MongoTabula.js'

const URI = process.env.MONGO_PASS ?? process.env.MONGODB_URI ?? 'mongodb://localhost:27017'
const DB = 'noemaplane_test'
const COL = 'tabulae_unit'

let client: MongoClient, col: Collection, store: MongoTabula

before(async () => {
  client = new MongoClient(URI)
  await client.connect()
  col = client.db(DB).collection(COL)
  await col.createIndex({ id: 1 }, { unique: true })
  store = new MongoTabula(col)
})
afterEach(async () => { await col.deleteMany({}) })
after(async () => {
  await client.db(DB).dropCollection(COL).catch(() => {})
  await client.close()
})

const base = {
  nomen: 'My Canvas',
  auctor: 'anima-a',
  status: 'draft' as const,
  visibilitas: 'privata' as const,
}

test('create returns tabula with id, natum, mutatum, nodi=[], vincula=[]', async () => {
  const t = await store.create(base)
  assert.ok(t.id)
  assert.ok(t.natum instanceof Date)
  assert.ok(t.mutatum instanceof Date)
  assert.deepEqual(t.nodi, [])
  assert.deepEqual(t.vincula, [])
})

test('find returns null for unknown', async () => {
  assert.equal(await store.find('nope'), null)
})

test('find returns the tabula', async () => {
  const t = await store.create(base)
  const found = await store.find(t.id)
  assert.equal(found?.nomen, 'My Canvas')
})

test('list filters by auctor', async () => {
  await store.create({ ...base, auctor: 'anima-a' })
  await store.create({ ...base, auctor: 'anima-b' })
  const mine = await store.list({ auctor: 'anima-a' })
  assert.equal(mine.length, 1)
})

test('list filters by status', async () => {
  const t = await store.create(base)
  await store.update(t.id, { status: 'published' })
  await store.create(base)
  const pub = await store.list({ status: 'published' })
  assert.equal(pub.length, 1)
})

test('update changes nomen and stamps mutatum', async () => {
  const t = await store.create(base)
  await new Promise(r => setTimeout(r, 5))
  const updated = await store.update(t.id, { nomen: 'Renamed' })
  assert.equal(updated.nomen, 'Renamed')
  assert.ok(updated.mutatum > updated.natum)
})

test('update sets nodi and vincula', async () => {
  const t = await store.create(base)
  const nodi = [{ id: 'n1', modusId: 'modus-x', x: 0, y: 0, aditus: {} }]
  const updated = await store.update(t.id, { nodi })
  assert.equal(updated.nodi.length, 1)
})

test('fork creates new draft with fonteId pointing to original', async () => {
  const original = await store.create(base)
  const forked = await store.fork(original.id, 'anima-b')
  assert.notEqual(forked.id, original.id)
  assert.equal(forked.fonteId, original.id)
  assert.equal(forked.auctor, 'anima-b')
  assert.equal(forked.status, 'draft')
})

test('listDerived returns tabulae with matching templateId', async () => {
  const master = await store.create(base)
  await store.create({ ...base, auctor: 'anima-b', templateId: master.id })
  await store.create({ ...base, auctor: 'anima-c', templateId: master.id })
  await store.create({ ...base, auctor: 'anima-d' }) // no templateId
  const derived = await store.listDerived(master.id)
  assert.equal(derived.length, 2)
  assert.ok(derived.every(t => t.templateId === master.id))
})

test('listDerived returns empty when no derived tabulae', async () => {
  const master = await store.create(base)
  const derived = await store.listDerived(master.id)
  assert.deepEqual(derived, [])
})
