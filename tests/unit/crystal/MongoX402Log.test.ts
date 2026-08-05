import { test, before, after, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { MongoClient, Collection } from 'mongodb'
import { MongoX402Log } from '../../../src/crystal/MongoX402Log.js'

// Real-Mongo coverage for the x402 payment log (ADR-0011 §5). The UNIQUE signatureHash
// index IS the replay guard — only real Mongo enforces it under a concurrent double-spend.

const URI = process.env.MONGO_PASS ?? process.env.MONGODB_URI ?? 'mongodb://localhost:27017'
const DB = 'noemaplane_test'
const COL = 'x402_payment_log_unit'

let client: MongoClient
let col: Collection
let store: MongoX402Log

before(async () => {
  client = new MongoClient(URI)
  await client.connect()
  col = client.db(DB).collection(COL)
  await col.deleteMany({})
  await col.createIndex({ signatureHash: 1 }, { unique: true })
  store = new MongoX402Log(col)
})

afterEach(async () => { await col.deleteMany({}) })
after(async () => {
  await client.db(DB).dropCollection(COL).catch(() => {})
  await client.close()
})

function entry(signatureHash = 'sig-1') {
  return {
    signatureHash, payer: '0xpayer', amount: '404400', network: 'eip155:8453',
    asset: '0xusdc', payTo: '0xreceiver', agentId: 'camel42', spellName: 'memeify',
    modusId: 'agent-ws-camel42', costUsd: 0.4044,
  }
}

test('recordVerified inserts VERIFIED; a duplicate signatureHash returns false (replay guard)', async () => {
  assert.equal(await store.recordVerified(entry('sig-dup')), true)
  assert.equal(await store.recordVerified(entry('sig-dup')), false, 'replay refused via the unique index')
  assert.equal((await store.find('sig-dup'))?.status, 'VERIFIED')
})

test('recordSettled transitions to SETTLED with tx + runId', async () => {
  await store.recordVerified(entry('sig-s'))
  await store.recordSettled('sig-s', '0xdeadbeef', 'run-9')
  const found = await store.find('sig-s')
  assert.equal(found?.status, 'SETTLED')
  assert.equal(found?.txHash, '0xdeadbeef')
  assert.equal(found?.runId, 'run-9')
  assert.ok(found?.settledAt)
})

test('recordFailed transitions to FAILED with a reason', async () => {
  await store.recordVerified(entry('sig-f'))
  await store.recordFailed('sig-f', 'oom')
  const found = await store.find('sig-f')
  assert.equal(found?.status, 'FAILED')
  assert.equal(found?.failureReason, 'oom')
})

test('find returns null for an unknown signature', async () => {
  assert.equal(await store.find('nope'), null)
})
