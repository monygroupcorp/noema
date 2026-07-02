import { test, before, after, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { MongoClient, Collection } from 'mongodb'
import { MongoIssuer } from '../../../src/crystal/MongoIssuer.js'

// Real-Mongo coverage for the trusted-issuer registry (ADR-0011 §4). The Phase 3
// seed (`Issuer{ issuerId:'https://camelcabal.fun', … }`) and the JWKS acceptor's
// hot `findByIssuerId` both depend on the active-only filter + upsert idempotency.

const URI = process.env.MONGO_PASS ?? process.env.MONGODB_URI ?? 'mongodb://localhost:27017'
const DB = 'noemaplane_test'
const COL = 'trusted_issuers_unit'
const ISS = 'https://camelcabal.fun'
const JWKS = 'https://camelcabal.fun/.well-known/jwks.json'

let client: MongoClient
let col: Collection
let store: MongoIssuer

before(async () => {
  client = new MongoClient(URI)
  await client.connect()
  col = client.db(DB).collection(COL)
  await col.deleteMany({})
  await col.createIndex({ issuerId: 1 }, { unique: true })
  store = new MongoIssuer(col)
})

afterEach(async () => { await col.deleteMany({}) })
after(async () => {
  await client.db(DB).dropCollection(COL).catch(() => {})
  await client.close()
})

test('upsert then findByIssuerId returns the active issuer', async () => {
  await store.upsert({ issuerId: ISS, name: 'CAMEL', jwksUrl: JWKS })
  const found = await store.findByIssuerId(ISS)
  assert.ok(found)
  assert.equal(found!.name, 'CAMEL')
  assert.equal(found!.jwksUrl, JWKS)
  assert.equal(found!.status, 'active')
})

test('findByIssuerId returns null for an unknown issuer', async () => {
  assert.equal(await store.findByIssuerId('https://nope.example'), null)
})

test('suspended issuer is hidden from the hot path but stays listable', async () => {
  await store.upsert({ issuerId: ISS, name: 'CAMEL', jwksUrl: JWKS })
  await store.setStatus(ISS, 'suspended')
  assert.equal(await store.findByIssuerId(ISS), null, 'not honored while suspended')
  const all = await store.list()
  assert.equal(all.length, 1)
  assert.equal(all[0].status, 'suspended')
})

test('upsert is idempotent on issuerId (updates in place, preserves natum)', async () => {
  const first = await store.upsert({ issuerId: ISS, name: 'CAMEL', jwksUrl: JWKS })
  const second = await store.upsert({ issuerId: ISS, name: 'CAMEL v2', jwksUrl: 'https://camelcabal.fun/jwks2.json' })
  assert.equal((await col.countDocuments({ issuerId: ISS })), 1, 'no duplicate row')
  assert.equal(second.name, 'CAMEL v2')
  assert.equal(second.jwksUrl, 'https://camelcabal.fun/jwks2.json')
  assert.deepEqual(second.natum, first.natum, 'natum preserved across upsert')
})

test('reactivating a suspended issuer via upsert restores the hot path', async () => {
  await store.upsert({ issuerId: ISS, name: 'CAMEL', jwksUrl: JWKS })
  await store.setStatus(ISS, 'suspended')
  await store.upsert({ issuerId: ISS, name: 'CAMEL', jwksUrl: JWKS, status: 'active' })
  assert.ok(await store.findByIssuerId(ISS))
})
