// Auth contract + reclassify/clearance behaviour of the model admin router. Mirrors
// treasuryAdminRouter.test.ts's structure: the x-internal-secret gate is unconditional,
// so a refused request must never reach `setLicense`.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import express from 'express'
import request from 'supertest'
import { createModelAdminRouter, type ModelAdminDeps } from '../../../src/api/internal/modelAdminRouter.js'
import type { Intella } from '../../../src/types/intelligendi.js'

const SECRET = 'test-internal-secret'

const KLEIN_4B: Intella = {
  id: 'intella-klein-4b',
  nomen: 'brutalite',
  genus: 'lora',
  architectura: 'dit',
  parametri: 4_000_000_000,
  sources: [],
  canonica: false,
  natum: new Date(0),
  provenance: { repo: 'local', base: 'black-forest-labs/FLUX.2-klein-base-4B' },
} as unknown as Intella

/** Counts every store call so a refused request can be proven to have written nothing. */
function harness(secret?: string, models: Record<string, Intella> = { [KLEIN_4B.id]: KLEIN_4B }) {
  const calls: string[] = []
  const written: Array<{ id: string; patch: Record<string, unknown> }> = []
  const store = { ...models }
  const deps: ModelAdminDeps = {
    intellarum: {
      find: async (id: string) => { calls.push('find'); return store[id] ?? null },
      setLicense: async (id: string, patch: { license?: string; commercialUse?: 'yes' | 'no' | 'conditional' | 'unknown' }) => {
        calls.push('setLicense')
        if (!store[id]) return null
        written.push({ id, patch })
        store[id] = { ...store[id], ...patch }
        return store[id]
      },
    },
    ...(secret ? { secret } : {}),
  }
  const server = express()
  server.use('/internal/v1', express.json(), createModelAdminRouter(deps))
  return { server, calls, written }
}

const licenseRoute = (id: string) => `/internal/v1/admin/models/${id}/license`

test('configured secret + correct header → reclassify is admitted', async () => {
  const { server, calls } = harness(SECRET)
  const res = await request(server).post(licenseRoute(KLEIN_4B.id)).set('x-internal-secret', SECRET).send({ reclassify: true })
  assert.equal(res.status, 200)
  assert.ok(calls.includes('setLicense'))
})

test('wrong credential → 401 and no store write', async () => {
  const { server, calls } = harness(SECRET)
  const res = await request(server).post(licenseRoute(KLEIN_4B.id)).set('x-internal-secret', 'wrong').send({ reclassify: true })
  assert.equal(res.status, 401)
  assert.deepEqual(calls, [])
})

test('no credential → 401 and no store write', async () => {
  const { server, calls } = harness(SECRET)
  const res = await request(server).post(licenseRoute(KLEIN_4B.id)).send({ reclassify: true })
  assert.equal(res.status, 401)
  assert.deepEqual(calls, [])
})

test('secret NOT configured → 401 even with a credential supplied', async () => {
  const { server, calls } = harness(undefined)
  const res = await request(server).post(licenseRoute(KLEIN_4B.id)).set('x-internal-secret', 'anything').send({ reclassify: true })
  assert.equal(res.status, 401)
  assert.deepEqual(calls, [])
})

test('reclassify: a klein 4B base resolves to apache-2.0 / commercial yes', async () => {
  const { server, written } = harness(SECRET)
  const res = await request(server).post(licenseRoute(KLEIN_4B.id)).set('x-internal-secret', SECRET).send({ reclassify: true })
  assert.equal(res.status, 200)
  assert.equal(res.body.license, 'apache-2.0')
  assert.equal(res.body.commercialUse, 'yes')
  assert.equal(written[0]?.patch.license, 'apache-2.0')
  assert.equal(written[0]?.patch.commercialUse, 'yes')
})

test('explicit clearance sets exactly what was sent, no reclassify derivation', async () => {
  const { server, written } = harness(SECRET)
  const res = await request(server).post(licenseRoute(KLEIN_4B.id)).set('x-internal-secret', SECRET)
    .send({ license: 'held-commercial-license', commercialUse: 'yes' })
  assert.equal(res.status, 200)
  assert.equal(written[0]?.patch.license, 'held-commercial-license')
  assert.equal(written[0]?.patch.commercialUse, 'yes')
})

test('an unknown model is 404 and writes nothing', async () => {
  const { server, calls } = harness(SECRET)
  const res = await request(server).post(licenseRoute('does-not-exist')).set('x-internal-secret', SECRET).send({ reclassify: true })
  assert.equal(res.status, 404)
  assert.deepEqual(calls, ['find'])
})

test('neither license, commercialUse, nor reclassify → 400 and no write', async () => {
  const { server, calls } = harness(SECRET)
  const res = await request(server).post(licenseRoute(KLEIN_4B.id)).set('x-internal-secret', SECRET).send({})
  assert.equal(res.status, 400)
  assert.ok(!calls.includes('setLicense'))
})

test('an invalid commercialUse value is rejected with 400', async () => {
  const { server, calls } = harness(SECRET)
  const res = await request(server).post(licenseRoute(KLEIN_4B.id)).set('x-internal-secret', SECRET)
    .send({ commercialUse: 'definitely' })
  assert.equal(res.status, 400)
  assert.ok(!calls.includes('setLicense'))
})
