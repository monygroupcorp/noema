import { test, before, after, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { MongoClient, Collection } from 'mongodb'
import { MongoDeploymentum } from '../../../src/crystal/MongoDeploymentum.js'
import type { Deploymentum } from '../../../src/types/deploymentum.js'

const URI = process.env.MONGO_PASS ?? process.env.MONGODB_URI ?? 'mongodb://localhost:27017'
const DB = 'noemaplane_test'
const COL = 'deploymentum_unit'

let client: MongoClient
let col: Collection
let store: MongoDeploymentum

function makeDeploymentum(overrides: Partial<Deploymentum> = {}): Deploymentum {
  return {
    hash: `sha256:${Math.random().toString(36).slice(2).padEnd(64, '0')}`,
    spec: { image: { ociRef: 'runpod/pytorch:2.4' }, models: [], workflow: {}, seed: 42 },
    natum: new Date(),
    ...overrides,
  }
}

before(async () => {
  client = new MongoClient(URI)
  await client.connect()
  col = client.db(DB).collection(COL)
  store = new MongoDeploymentum(col)
})

after(async () => {
  await client.close()
})

afterEach(async () => {
  await col.deleteMany({})
})

// ── find() ────────────────────────────────────────────────────────────────────

test('find() returns null for unknown hash', async () => {
  const result = await store.find('sha256:does-not-exist')
  assert.equal(result, null)
})

test('find() returns stored deployment by hash', async () => {
  const d = makeDeploymentum({ hash: 'sha256:aabbccdd' })
  await col.insertOne({ ...d })
  const result = await store.find('sha256:aabbccdd')
  assert.ok(result)
  assert.equal(result.hash, 'sha256:aabbccdd')
})

test('find() strips MongoDB _id from result', async () => {
  const d = makeDeploymentum({ hash: 'sha256:strip-test' })
  await col.insertOne({ ...d })
  const result = await store.find('sha256:strip-test')
  assert.ok(result)
  assert.equal('_id' in result, false)
})

test('find() returns spec with correct fields', async () => {
  const spec = { image: { ociRef: 'myimage:v1' }, models: [{ id: 'flux1' }], seed: 99 }
  const d = makeDeploymentum({ hash: 'sha256:spec-test', spec })
  await col.insertOne({ ...d })
  const result = await store.find('sha256:spec-test')
  assert.deepEqual(result?.spec, spec)
})

// ── upsert() ──────────────────────────────────────────────────────────────────

test('upsert() inserts a new deployment', async () => {
  const d = makeDeploymentum({ hash: 'sha256:new-deploy' })
  await store.upsert(d)
  const result = await store.find('sha256:new-deploy')
  assert.ok(result)
  assert.equal(result.hash, 'sha256:new-deploy')
})

test('upsert() is idempotent — second call with same hash does not error', async () => {
  const d = makeDeploymentum({ hash: 'sha256:idem' })
  await store.upsert(d)
  await assert.doesNotReject(() => store.upsert(d))
  const count = await col.countDocuments({ hash: 'sha256:idem' })
  assert.equal(count, 1)
})

test('upsert() updates existing record when called again with same hash', async () => {
  const d = makeDeploymentum({ hash: 'sha256:update-test', spec: { version: 1 } })
  await store.upsert(d)
  await store.upsert({ ...d, spec: { version: 2 } })
  const result = await store.find('sha256:update-test')
  assert.deepEqual(result?.spec, { version: 2 })
})
