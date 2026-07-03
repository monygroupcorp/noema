// Hermetic (express) test of the delegation router (§7).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import express from 'express'
import request from 'supertest'
import { createDelegationRouter } from '../../../../src/allocutio/api/delegationRouter.js'
import { MemoryDelegatio } from '../../../../src/crystal/MemoryDelegatio.js'
import { DelegationService } from '../../../../src/crystal/DelegationService.js'
import type { Legatus } from '../../../../src/types/legatus.js'

const legatus = { agentId: 'camel42', animaId: 'anima-1', ownerAddress: '0xowner', status: 'active' } as Legatus

function app(opts: { owner?: boolean } = {}) {
  const service = new DelegationService({ delegationes: new MemoryDelegatio(), jwtSecret: 'sec', ttlSeconds: 3600 })
  const a = express()
  a.use('/widget', express.json(), createDelegationRouter({
    delegations: service,
    legati: { findByAgentId: async (id) => (id === 'camel42' ? legatus : null) },
    authorizeOwner: async () => opts.owner ?? true,
    publicBase: 'https://noema.art',
  }))
  return { app: a, service }
}

test('owner mints a link → token + absolute joinUrl; list shows it', async () => {
  const { app: a } = app({ owner: true })
  const res = await request(a).post('/widget/camel42/delegations').send({ label: 'discord', spendCapPoints: 5000 })
  assert.equal(res.status, 200)
  assert.ok(res.body.token)
  assert.match(res.body.joinUrl, /^https:\/\/noema\.art\/join\/camel42\//)
  assert.equal(res.body.delegation.spendCapPoints, '5000')     // bigint → string on the wire
  const list = await request(a).get('/widget/camel42/delegations')
  assert.equal(list.body.delegations.length, 1)
  assert.equal(list.body.delegations[0].label, 'discord')
})

test('non-owner is refused create/list/revoke with 403', async () => {
  const { app: a } = app({ owner: false })
  assert.equal((await request(a).post('/widget/camel42/delegations').send({})).status, 403)
  assert.equal((await request(a).get('/widget/camel42/delegations')).status, 403)
  assert.equal((await request(a).delete('/widget/camel42/delegations/x')).status, 403)
})

test('public redeem: valid code → a session; bad code → 404', async () => {
  const { app: a } = app({ owner: true })
  const created = await request(a).post('/widget/camel42/delegations').send({ spendCapPoints: 1000 })
  const token = created.body.token
  const ok = await request(a).post('/widget/camel42/auth/redeem').send({ token })
  assert.equal(ok.status, 200)
  assert.ok(ok.body.session)
  assert.equal(ok.body.remainingPoints, '1000')
  const bad = await request(a).post('/widget/camel42/auth/redeem').send({ token: 'nope' })
  assert.equal(bad.status, 404)
})

test('revoke then redeem → 403 REVOKED', async () => {
  const { app: a } = app({ owner: true })
  const created = await request(a).post('/widget/camel42/delegations').send({})
  const id = created.body.delegation.id
  const token = created.body.token
  assert.equal((await request(a).delete(`/widget/camel42/delegations/${id}`)).status, 200)
  const red = await request(a).post('/widget/camel42/auth/redeem').send({ token })
  assert.equal(red.status, 403)
  assert.equal(red.body.error.code, 'REVOKED')
})
