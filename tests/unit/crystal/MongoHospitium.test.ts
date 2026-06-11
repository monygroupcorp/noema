import { test, before, after, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { MongoClient, Collection } from 'mongodb'
import { MongoHospitium } from '../../../src/crystal/MongoHospitium.js'
import type { Hospitium } from '../../../src/types/hospitium.js'

const URI = process.env.MONGO_PASS ?? process.env.MONGODB_URI ?? 'mongodb://localhost:27017'
const DB = 'noemaplane_test'
const COL = 'hospitia_unit'

let client: MongoClient
let col: Collection
let store: MongoHospitium

before(async () => {
  client = new MongoClient(URI)
  await client.connect()
  col = client.db(DB).collection(COL)
  store = new MongoHospitium(col)
})

afterEach(async () => { await col.deleteMany({}) })
after(async () => {
  await client.db(DB).dropCollection(COL).catch(() => {})
  await client.close()
})

const HOST: Hospitium['hostKey'] = { animaId: 'anima-host' }

// ── studio host record: opened by modoId, pod attached later (ADR-0006) ───────
test('findByModoId finds an in-flight (pod-less) studio host record', async () => {
  const created = await store.create({ modoId: 'modo-1', hostKey: HOST, inceptum: new Date() })
  const found = await store.findByModoId('modo-1')
  assert.ok(found)
  assert.equal(found.id, created.id)
  assert.deepEqual(found.hostKey, HOST)
  assert.equal(found.materiaId, undefined, 'no pod bound yet')
  assert.equal(await store.findByModoId('nope'), null)
})

test('bindMateria attaches the parked pod to the studio record (keyed by modoId)', async () => {
  await store.create({ modoId: 'modo-2', hostKey: HOST, inceptum: new Date() })
  const bound = await store.bindMateria('modo-2', 'mat-77')
  assert.equal(bound.materiaId, 'mat-77')
  // Now findable by BOTH keys.
  assert.equal((await store.findByModoId('modo-2'))?.materiaId, 'mat-77')
  assert.equal((await store.findByMateriaId('mat-77'))?.modoId, 'modo-2')
})

test('bindMateria throws for an unknown studio', async () => {
  await assert.rejects(() => store.bindMateria('ghost', 'mat-x'))
})

test('a bound studio record updates by materiaId (Census/claudere path) as before', async () => {
  await store.create({ modoId: 'modo-3', hostKey: HOST, inceptum: new Date() })
  await store.bindMateria('modo-3', 'mat-3')
  const now = new Date()
  const updated = await store.update('mat-3', { terminatum: now, costAccrued: 42n })
  assert.equal(updated.costAccrued, 42n)
  assert.ok(updated.terminatum)
  // terminated → no longer active.
  assert.equal((await store.findActive()).length, 0)
})
