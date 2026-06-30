import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import express from 'express'
import request from 'supertest'
import { createCeremoniaRouter } from '../../../src/api/arcanum/ceremoniaRouter.js'
import { MemoryCeremoniaStore } from '../../../src/arcanum/CeremoniaStore.js'
import type { ZkeyCustody } from '../../../src/arcanum/CeremoniaCustody.js'

const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex')

class MemoryCustody implements ZkeyCustody {
  private m = new Map<string, Buffer>()
  async get(h: string) { return this.m.get(h) ?? null }
  async put(h: string, b: Buffer) { this.m.set(h, b) }
}

// No ptau → verifyContinuation degrades to a structural accept, so the router logic
// (ordering, locking, hashing) is exercised without running snarkjs in the test.
function makeApp(store = new MemoryCeremoniaStore(), custody = new MemoryCustody()) {
  const app = express()
  app.use('/v1/ceremony', express.json(), createCeremoniaRouter(store, {
    custody,
    verifier: { r1csPath: '/nonexistent.r1cs', ptauPath: undefined },
  }))
  return { app, store, custody }
}

/** Open a ceremony with a seeded root zkey in custody; returns the root hash. */
async function open(store: MemoryCeremoniaStore, custody: MemoryCustody) {
  const root = Buffer.from('ROOT-ZKEY')
  const rootHash = sha(root)
  await custody.put(rootHash, root)
  await store.open(rootHash, 5)
  return rootHash
}

test('GET /v1/ceremony exposes the announced fallback + computed headHash', async () => {
  const { app } = makeApp()
  const res = await request(app).get('/v1/ceremony')
  assert.equal(res.status, 200)
  assert.equal(res.body.phase, 'announced')
  assert.equal(res.body.headHash, null)
})

test('GET /current.zkey is 409 until open, then streams the head with x-zkey-hash', async () => {
  const { app, store, custody } = makeApp()
  assert.equal((await request(app).get('/v1/ceremony/current.zkey')).status, 409)
  const rootHash = await open(store, custody)
  const res = await request(app).get('/v1/ceremony/current.zkey').buffer()
  assert.equal(res.status, 200)
  assert.equal(res.headers['x-zkey-hash'], rootHash)
})

test('a valid contribution appends to the live chain and advances the head', async () => {
  const { app, store, custody } = makeApp()
  const rootHash = await open(store, custody)

  const contrib = Buffer.from('CONTRIB-1')
  const res = await request(app)
    .post('/v1/ceremony/contributions')
    .set('x-based-on', rootHash)
    .set('x-contributor-name', 'alice')
    .set('Content-Type', 'application/octet-stream')
    .send(contrib)

  assert.equal(res.status, 201)
  assert.equal(res.body.chain.length, 1)
  assert.equal(res.body.chain[0].name, 'alice')
  assert.equal(res.body.headHash, sha(contrib))
  // the new head is downloadable
  assert.deepEqual(await custody.get(sha(contrib)), contrib)
})

test('a stale x-based-on is rejected 409 (must build on the current head)', async () => {
  const { app, store, custody } = makeApp()
  const rootHash = await open(store, custody)
  // first contribution moves the head
  await request(app).post('/v1/ceremony/contributions')
    .set('x-based-on', rootHash).set('Content-Type', 'application/octet-stream').send(Buffer.from('C1'))
  // second still references the root → stale
  const res = await request(app).post('/v1/ceremony/contributions')
    .set('x-based-on', rootHash).set('Content-Type', 'application/octet-stream').send(Buffer.from('C2'))
  assert.equal(res.status, 409)
})

test('an identical (no-op) upload is rejected 400', async () => {
  const { app, store, custody } = makeApp()
  const rootHash = await open(store, custody)
  const root = await custody.get(rootHash)
  const res = await request(app).post('/v1/ceremony/contributions')
    .set('x-based-on', rootHash).set('Content-Type', 'application/octet-stream').send(root!)
  assert.equal(res.status, 400)
})

test('missing x-based-on is rejected 400', async () => {
  const { app, store, custody } = makeApp()
  await open(store, custody)
  const res = await request(app).post('/v1/ceremony/contributions')
    .set('Content-Type', 'application/octet-stream').send(Buffer.from('X'))
  assert.equal(res.status, 400)
})

test('contributions are refused before the ceremony is open', async () => {
  const { app } = makeApp()
  const res = await request(app).post('/v1/ceremony/contributions')
    .set('x-based-on', 'a'.repeat(64)).set('Content-Type', 'application/octet-stream').send(Buffer.from('X'))
  assert.equal(res.status, 409)
})

test('appendContribution optimistic lock: second writer on the same head loses', async () => {
  const store = new MemoryCeremoniaStore()
  const custody = new MemoryCustody()
  const rootHash = await open(store, custody)
  const ok1 = await store.appendContribution({ index: 1, name: 'a', outputHash: 'h1' }, rootHash)
  const ok2 = await store.appendContribution({ index: 2, name: 'b', outputHash: 'h2' }, rootHash) // stale head
  assert.equal(ok1, true)
  assert.equal(ok2, false)
})

test('POST /slots still records contributor interest, deduped by contact', async () => {
  const { app, store } = makeApp()
  assert.equal((await request(app).post('/v1/ceremony/slots').send({ contact: 'alice@x' })).status, 201)
  await request(app).post('/v1/ceremony/slots').send({ contact: 'alice@x' })
  await request(app).post('/v1/ceremony/slots').send({ contact: 'bob@y' })
  assert.equal(store.slotCount(), 2)
})

test('POST /slots rejects blank or over-long contact', async () => {
  const { app } = makeApp()
  assert.equal((await request(app).post('/v1/ceremony/slots').send({ contact: '  ' })).status, 400)
  assert.equal((await request(app).post('/v1/ceremony/slots').send({ contact: 'x'.repeat(300) })).status, 400)
})
