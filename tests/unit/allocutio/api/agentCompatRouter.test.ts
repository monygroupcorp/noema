// End-to-end (express) test of the baked `/api/v1/...` CAMEL compat surface:
// the auth-shadow probe through the ACTUAL route (garbage sig → 401 not 403),
// the full provision → manifest → revoke lifecycle, and idempotency.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import express from 'express'
import request from 'supertest'
import { createAgentCompatRouter } from '../../../../src/allocutio/api/agentCompatRouter.js'
import { AgentJwtVerifier } from '../../../../src/allocutio/api/AgentJwtVerifier.js'
import { AgentProvisioner, type TreasuryConfig } from '../../../../src/crystal/AgentProvisioner.js'
import { MemoryIssuer } from '../../../../src/crystal/MemoryIssuer.js'
import { MemoryLegatus } from '../../../../src/crystal/MemoryLegatus.js'
import { MemorySignorum } from '../../../../src/ledger/MemorySignorum.js'
import { MemoryModorum } from '../../../../src/execution/MemoryModorum.js'
import { CAMEL_TEMPLATE_MODUS } from '../../../../src/crystal/seeds/camel.js'
import { _clearCache } from '../../../../src/crystal/agentCardFetcher.js'
import { makeKey, camelClaims, signES256, fakeJwksFetch, ISS, JWKS_URL } from './_jwksTestKit.js'

/** A `globalThis.fetch`-shaped stub for the agent-card fetch (`GET .../agents/:tokenId/card`).
 *  Defaults to a bare 404 (no card) so every test that doesn't care about the NFT-image
 *  feature stays hermetic — no real network call ever leaves the process. */
function stubCardFetch(card: unknown | null): typeof fetch {
  return (async () => ({
    ok: card !== null,
    status: card !== null ? 200 : 404,
    json: async () => card,
  })) as unknown as typeof fetch
}

const TREASURY: TreasuryConfig = {
  treasuryId: 'camelcabal-1',
  animaId: 'camelcabal-1',
  issuerId: ISS,
  templateModusId: CAMEL_TEMPLATE_MODUS.id,
  nftImageInputKey: 'input_second_image',
  starterGrant: 0n,
  status: 'active',
}

async function app(opts: { card?: unknown | null } = {}) {
  _clearCache()
  globalThis.fetch = stubCardFetch(opts.card ?? null)

  const kit = makeKey()
  const issuers = new MemoryIssuer()
  await issuers.upsert({ issuerId: ISS, name: 'CAMEL', jwksUrl: JWKS_URL })
  const { fetchFn } = fakeJwksFetch({ keys: () => [kit.jwk] })
  const verifier = new AgentJwtVerifier({ issuers, fetchFn })

  const legati = new MemoryLegatus()
  const signorum = new MemorySignorum()
  const modorum = new MemoryModorum()
  await modorum.register(CAMEL_TEMPLATE_MODUS)
  const provisioner = new AgentProvisioner({
    legati, signorum, modorum, treasury: (id) => (id === TREASURY.treasuryId ? TREASURY : null),
  })

  // Stable federated anima resolver (same soul per (iss,sub)).
  const animaByKey = new Map<string, string>()
  let n = 0
  const resolveAgentAnima = async (iss: string, sub: string): Promise<string> => {
    const k = `${iss}::${sub}`
    if (!animaByKey.has(k)) animaByKey.set(k, `anima-${++n}`)
    return animaByKey.get(k)!
  }

  const server = express()
  server.use('/api/v1', express.json(), createAgentCompatRouter({
    verifier, provisioner, legati, resolveAgentAnima,
    treasury: (id) => (id === TREASURY.treasuryId ? TREASURY : null),
    balanceOf: (animaId) => signorum.balance({ animaId }),
    publicBase: 'https://noema.art',
  }))
  return { server, kit, legati, signorum, modorum }
}

test('AUTH-SHADOW PROBE (route): garbage-signature ES256 Bearer → 401 INVALID_ASSERTION, not 403', async () => {
  const { server, kit } = await app()
  const good = signES256(kit, camelClaims())
  const parts = good.split('.')
  const tampered = `${parts[0]}.${parts[1]}.${'A'.repeat(parts[2].length)}`
  const res = await request(server)
    .post('/api/v1/treasury/camelcabal-1/agents')
    .set('authorization', `Bearer ${tampered}`)
    .send({})
  assert.equal(res.status, 401)
  assert.notEqual(res.status, 403)
  assert.equal(res.body.error.code, 'INVALID_ASSERTION')
})

test('missing Bearer → 401 UNAUTHORIZED', async () => {
  const { server } = await app()
  const res = await request(server).post('/api/v1/treasury/camelcabal-1/agents').send({})
  assert.equal(res.status, 401)
  assert.equal(res.body.error.code, 'UNAUTHORIZED')
})

test('unknown treasury → 404 before any token leak', async () => {
  const { server, kit } = await app()
  const res = await request(server)
    .post('/api/v1/treasury/ghost/agents')
    .set('authorization', `Bearer ${signES256(kit, camelClaims())}`)
    .send({})
  assert.equal(res.status, 404)
  assert.equal(res.body.error.code, 'TREASURY_NOT_FOUND')
})

test('valid provision → 202 with agentAccountId + manifest/revoke URIs + USDC balance', async () => {
  const { server, kit } = await app()
  const res = await request(server)
    .post('/api/v1/treasury/camelcabal-1/agents')
    .set('authorization', `Bearer ${signES256(kit, camelClaims())}`)
    .send({})
  assert.equal(res.status, 202)
  assert.ok(res.body.agentAccountId)
  assert.equal(res.body.manifestURI, `https://noema.art/api/v1/agents/${res.body.agentAccountId}/manifest`)
  assert.equal(res.body.revokeURI, `https://noema.art/api/v1/sessions/${res.body.agentAccountId}/revoke`)
  assert.equal(res.body.balance.currency, 'USDC')
})

test('idempotent re-POST same agentId → 200 same agentAccountId', async () => {
  const { server, kit } = await app()
  const token = () => signES256(kit, camelClaims())
  const first = await request(server).post('/api/v1/treasury/camelcabal-1/agents').set('authorization', `Bearer ${token()}`).send({})
  const second = await request(server).post('/api/v1/treasury/camelcabal-1/agents').set('authorization', `Bearer ${token()}`).send({})
  assert.equal(first.status, 202)
  assert.equal(second.status, 200)
  assert.equal(second.body.agentAccountId, first.body.agentAccountId)
})

test('active manifest surfaces status + USDC billing; wrong revoke token → 403', async () => {
  const { server, kit } = await app()
  const prov = await request(server).post('/api/v1/treasury/camelcabal-1/agents').set('authorization', `Bearer ${signES256(kit, camelClaims())}`).send({})
  const id = prov.body.agentAccountId

  const manifest = await request(server).get(`/api/v1/agents/${id}/manifest`)
  assert.equal(manifest.status, 200)
  assert.equal(manifest.body.status, 'active')
  assert.equal(manifest.body.billing.currency, 'USDC')

  const badRevoke = await request(server).post(`/api/v1/sessions/${id}/revoke`).send({})
  assert.equal(badRevoke.status, 403)
})

test('a record carrying no revokeToken is not revocable through this route → 403', async () => {
  const { server, kit, legati } = await app()
  const prov = await request(server).post('/api/v1/treasury/camelcabal-1/agents').set('authorization', `Bearer ${signES256(kit, camelClaims())}`).send({})
  const id = prov.body.agentAccountId

  // Every crystal-created Legatus has a revokeToken; simulate one that does not (the shape a
  // record from another creation path could take). The gate must refuse, not admit.
  const stored = await legati.findById(id)
  assert.ok(stored)
  delete (stored as { revokeToken?: string }).revokeToken

  const noToken = await request(server).post(`/api/v1/sessions/${id}/revoke`).send({})
  assert.equal(noToken.status, 403)

  const anyToken = await request(server).post(`/api/v1/sessions/${id}/revoke`).query({ token: 'anything' }).send({})
  assert.equal(anyToken.status, 403)

  const after = await legati.findById(id)
  assert.equal(after!.status, 'active')
})

test('unknown manifest → 404', async () => {
  const { server } = await app()
  const res = await request(server).get('/api/v1/agents/ghost/manifest')
  assert.equal(res.status, 404)
})

test('revoke happy path (correct token) then idempotent second revoke', async () => {
  const { server, kit, legati } = await app()
  const prov = await request(server).post('/api/v1/treasury/camelcabal-1/agents').set('authorization', `Bearer ${signES256(kit, camelClaims())}`).send({})
  const id = prov.body.agentAccountId
  const stored = await legati.findById(id)
  assert.ok(stored)

  const revoke = await request(server).post(`/api/v1/sessions/${id}/revoke`).query({ token: stored!.revokeToken }).send({})
  assert.equal(revoke.status, 200)
  assert.equal(revoke.body.status, 'revoked')

  // Manifest now surfaces revoked; re-provision is terminal 409.
  const manifest = await request(server).get(`/api/v1/agents/${id}/manifest`)
  assert.equal(manifest.body.status, 'revoked')
  const reprov = await request(server).post('/api/v1/treasury/camelcabal-1/agents').set('authorization', `Bearer ${signES256(kit, camelClaims())}`).send({})
  assert.equal(reprov.status, 409)

  // Second revoke is idempotent.
  const again = await request(server).post(`/api/v1/sessions/${id}/revoke`).query({ token: stored!.revokeToken }).send({})
  assert.equal(again.status, 200)
})

test('provision with tokenId + a resolvable agent card → bakes the real NFT image/name into the workspace', async () => {
  const { server, kit, legati, modorum } = await app({
    card: { profile: { name: 'Camel #42', description: 'A camel.', image: 'https://cards.example/camel42.png' } },
  })
  const res = await request(server)
    .post('/api/v1/treasury/camelcabal-1/agents')
    .set('authorization', `Bearer ${signES256(kit, camelClaims())}`)
    .send({})
  assert.equal(res.status, 202)

  const legatus = await legati.findById(res.body.agentAccountId)
  assert.ok(legatus)
  const ws = await modorum.find(legatus!.workspaceModusId!)
  assert.ok(ws)
  assert.equal(ws!.aditus.input_second_image.default, 'https://cards.example/camel42.png')
  assert.equal(ws!.nomen, 'Camel #42')
})

test('provision with tokenId + a missing/failed agent card → provisions cleanly with no image (unchanged)', async () => {
  const { server, kit, legati, modorum } = await app({ card: null })
  const res = await request(server)
    .post('/api/v1/treasury/camelcabal-1/agents')
    .set('authorization', `Bearer ${signES256(kit, camelClaims())}`)
    .send({})
  assert.equal(res.status, 202)

  const legatus = await legati.findById(res.body.agentAccountId)
  assert.ok(legatus)
  const ws = await modorum.find(legatus!.workspaceModusId!)
  assert.ok(ws)
  assert.equal(ws!.aditus.input_second_image.default, '')
})
