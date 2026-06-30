import { test } from 'node:test'
import assert from 'node:assert/strict'
import express from 'express'
import request from 'supertest'
import { createCeremoniaRouter } from '../../../src/api/arcanum/ceremoniaRouter.js'
import { MemoryCeremoniaStore } from '../../../src/arcanum/CeremoniaStore.js'

function makeApp(store = new MemoryCeremoniaStore()) {
  const app = express()
  app.use('/v1/ceremony', express.json(), createCeremoniaRouter(store))
  return { app, store }
}

test('GET /v1/ceremony returns the announced fallback before the coordinator runs', async () => {
  const { app } = makeApp()
  const res = await request(app).get('/v1/ceremony')
  assert.equal(res.status, 200)
  assert.equal(res.body.phase, 'announced')
  assert.equal(res.body.rootHash, null)
  assert.deepEqual(res.body.chain, [])
})

test('GET /v1/ceremony reflects an opened, contributed, finalized chain', async () => {
  const { app, store } = makeApp()
  await store.open('0xroot', 5)
  await store.appendContribution({ index: 1, name: 'alice', outputHash: '0xaaa' })
  await store.appendContribution({ index: 2, name: 'bob', outputHash: '0xbbb' })
  await store.finalize('0xfinal')

  const res = await request(app).get('/v1/ceremony')
  assert.equal(res.status, 200)
  assert.equal(res.body.phase, 'finalized')
  assert.equal(res.body.rootHash, '0xroot')
  assert.equal(res.body.finalHash, '0xfinal')
  assert.equal(res.body.openSlots, null) // cleared on finalize
  assert.equal(res.body.chain.length, 2)
  assert.equal(res.body.chain[0].name, 'alice')
  assert.equal(res.body.chain[1].outputHash, '0xbbb')
})

test('POST /v1/ceremony/slots records a contributor and dedupes by contact', async () => {
  const { app, store } = makeApp()
  const ok = await request(app).post('/v1/ceremony/slots').send({ contact: 'alice@example.com' })
  assert.equal(ok.status, 201)
  assert.equal(ok.body.ok, true)
  // same contact again — still fine, but no duplicate
  await request(app).post('/v1/ceremony/slots').send({ contact: 'alice@example.com' })
  await request(app).post('/v1/ceremony/slots').send({ contact: 'bob@telegram' })
  assert.equal(store.slotCount(), 2)
})

test('POST /v1/ceremony/slots rejects a missing or blank contact', async () => {
  const { app } = makeApp()
  assert.equal((await request(app).post('/v1/ceremony/slots').send({})).status, 400)
  assert.equal((await request(app).post('/v1/ceremony/slots').send({ contact: '   ' })).status, 400)
})

test('POST /v1/ceremony/slots rejects an over-long contact', async () => {
  const { app } = makeApp()
  const res = await request(app).post('/v1/ceremony/slots').send({ contact: 'x'.repeat(300) })
  assert.equal(res.status, 400)
})
