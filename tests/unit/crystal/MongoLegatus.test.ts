import { test, before, after, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { MongoClient, Collection } from 'mongodb'
import { MongoLegatus } from '../../../src/crystal/MongoLegatus.js'

// Real-Mongo coverage for the agent-sidecar registry (ADR-0011 §5). The provisioning
// saga's idempotency relies on the UNIQUE `agentId` index throwing E11000 on a
// concurrent duplicate — only real Mongo enforces that.

const URI = process.env.MONGO_PASS ?? process.env.MONGODB_URI ?? 'mongodb://localhost:27017'
const DB = 'noemaplane_test'
const COL = 'legati_unit'

let client: MongoClient
let col: Collection
let store: MongoLegatus

before(async () => {
  client = new MongoClient(URI)
  await client.connect()
  col = client.db(DB).collection(COL)
  await col.deleteMany({})
  await col.createIndex({ agentId: 1 }, { unique: true })
  await col.createIndex({ id: 1 }, { unique: true })
  store = new MongoLegatus(col)
})

afterEach(async () => { await col.deleteMany({}) })
after(async () => {
  await client.db(DB).dropCollection(COL).catch(() => {})
  await client.close()
})

function input(agentId = 'camel42') {
  return {
    agentId,
    tokenId: '42',
    ownerAddress: '0x' + 'a'.repeat(40),
    chainId: 1,
    adapter: '0x' + 'b'.repeat(40),
    animaId: 'anima-agent',
    treasuryId: 'camelcabal-1',
    issuerId: 'https://camelcabal.fun',
    scope: ['generate'],
    workspaceModusId: 'agent-ws-camel42',
    revokeToken: 'rvk_abc',
  }
}

test('create then findByAgentId / findById round-trip', async () => {
  const created = await store.create(input())
  assert.equal(created.status, 'active')
  assert.ok(created.id)
  const byAgent = await store.findByAgentId('camel42')
  assert.equal(byAgent?.id, created.id)
  const byId = await store.findById(created.id)
  assert.equal(byId?.agentId, 'camel42')
  assert.equal(byId?.scope[0], 'generate')
})

test('duplicate agentId throws E11000 (the idempotency guard)', async () => {
  await store.create(input('camel-dup'))
  await assert.rejects(
    () => store.create(input('camel-dup')),
    (err: unknown) => (err as { code?: number }).code === 11000,
  )
})

test('setStatus + setWorkspace mutate in place', async () => {
  const created = await store.create(input('camel-mut'))
  await store.setStatus(created.id, 'revoked')
  assert.equal((await store.findById(created.id))?.status, 'revoked')
  await store.setWorkspace(created.id, 'ws-new')
  assert.equal((await store.findById(created.id))?.workspaceModusId, 'ws-new')
})

test('findByAgentId / findById return null when absent', async () => {
  assert.equal(await store.findByAgentId('nope'), null)
  assert.equal(await store.findById('nope'), null)
})
