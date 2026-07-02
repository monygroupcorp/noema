import { test } from 'node:test'
import assert from 'node:assert/strict'
import express from 'express'
import request from 'supertest'
import { createSponsioRouter } from '../../../../src/allocutio/api/sponsioRouter.js'
import { MemorySponsio } from '../../../../src/crystal/MemorySponsio.js'
import type { AuctorKey } from '../../../../src/flow/types.js'
import type { Credentials } from '../../../../src/allocutio/api/IdentityResolver.js'

// Identity stub: `x-api-key: me` → {animaId:'sponsor-me'}; `x-commitment` → anon; else throws.
const identity = {
  async resolve(creds: Credentials): Promise<AuctorKey> {
    if (creds.apiKey === 'me') return { animaId: 'sponsor-me' }
    if (creds.commitment) return { commitment: creds.commitment }
    throw new Error('no creds')
  },
}

function app() {
  const sponsiones = new MemorySponsio()
  const server = express()
  server.use('/v1/sponsorships', express.json(), createSponsioRouter({ sponsiones, identity }))
  return { server, sponsiones }
}

test('create requires auth (401 without creds)', async () => {
  const { server } = app()
  const res = await request(server).post('/v1/sponsorships').send({ beneficiaryAnimaId: 'x', grant: 100, cadence: 'weekly' })
  assert.equal(res.status, 401)
})

test('anonymous (commitment) callers are forbidden — sponsorship needs an identified pool', async () => {
  const { server } = app()
  const res = await request(server).post('/v1/sponsorships').set('x-commitment', 'cmt-1').send({ beneficiaryAnimaId: 'x', grant: 100, cadence: 'weekly' })
  assert.equal(res.status, 403)
})

test('create → 200 with the pledge; sponsor is the caller', async () => {
  const { server } = app()
  const res = await request(server).post('/v1/sponsorships').set('x-api-key', 'me')
    .send({ beneficiaryAnimaId: 'friend', grant: 250, cadence: 'monthly', balanceCap: 1000, capTotal: 5000 })
  assert.equal(res.status, 200)
  const s = res.body.sponsorship
  assert.equal(s.sponsor.animaId, 'sponsor-me')
  assert.equal(s.beneficiarius.animaId, 'friend')
  assert.equal(s.subsidia.grant, '250')          // bigint → string on the wire
  assert.equal(s.subsidia.cadence, 'monthly')
  assert.equal(s.subsidia.balanceCap, '1000')
  assert.equal(s.capTotal, '5000')
  assert.equal(s.drippedTotal, '0')
  assert.equal(s.status, 'active')
})

test('validation: self-sponsor, bad grant, bad cadence all 400', async () => {
  const { server } = app()
  const bad = (body: object) => request(server).post('/v1/sponsorships').set('x-api-key', 'me').send(body)
  assert.equal((await bad({ beneficiaryAnimaId: 'sponsor-me', grant: 100, cadence: 'weekly' })).status, 400) // self
  assert.equal((await bad({ beneficiaryAnimaId: 'f', grant: 0, cadence: 'weekly' })).status, 400)             // grant 0
  assert.equal((await bad({ beneficiaryAnimaId: 'f', grant: -5, cadence: 'weekly' })).status, 400)            // negative
  assert.equal((await bad({ beneficiaryAnimaId: 'f', grant: 100, cadence: 'daily' })).status, 400)            // bad cadence
})

test('list returns only the caller’s pledges', async () => {
  const { server, sponsiones } = app()
  await request(server).post('/v1/sponsorships').set('x-api-key', 'me').send({ beneficiaryAnimaId: 'a', grant: 100, cadence: 'weekly' })
  await sponsiones.create({ sponsor: { animaId: 'someone-else' }, beneficiarius: { animaId: 'b' }, subsidia: { grant: 1n, cadence: 'weekly' } } as never)
  const res = await request(server).get('/v1/sponsorships').set('x-api-key', 'me')
  assert.equal(res.status, 200)
  assert.equal(res.body.sponsorships.length, 1)
  assert.equal(res.body.sponsorships[0].beneficiarius.animaId, 'a')
})

test('pause/resume are owner-gated', async () => {
  const { server, sponsiones } = app()
  const mine = await sponsiones.create({ sponsor: { animaId: 'sponsor-me' }, beneficiarius: { animaId: 'a' }, subsidia: { grant: 1n, cadence: 'weekly' } } as never)
  const theirs = await sponsiones.create({ sponsor: { animaId: 'other' }, beneficiarius: { animaId: 'b' }, subsidia: { grant: 1n, cadence: 'weekly' } } as never)

  const paused = await request(server).post(`/v1/sponsorships/${mine.id}/pause`).set('x-api-key', 'me').send({})
  assert.equal(paused.status, 200)
  assert.equal(paused.body.sponsorship.status, 'paused')

  const notMine = await request(server).post(`/v1/sponsorships/${theirs.id}/pause`).set('x-api-key', 'me').send({})
  assert.equal(notMine.status, 404, 'cannot pause someone else’s pledge')

  const resumed = await request(server).post(`/v1/sponsorships/${mine.id}/resume`).set('x-api-key', 'me').send({})
  assert.equal(resumed.body.sponsorship.status, 'active')
})
