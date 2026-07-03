import { test } from 'node:test'
import assert from 'node:assert/strict'
import { AgentJwtVerifier, parseJwksOverride } from '../../../../src/allocutio/api/AgentJwtVerifier.js'
import { ApiError } from '../../../../src/allocutio/api/errors.js'
import { MemoryIssuer } from '../../../../src/crystal/MemoryIssuer.js'
import type { IssuerStore } from '../../../../src/types/issuer.js'
import { makeKey, camelClaims, signES256, fakeJwksFetch, ISS, JWKS_URL } from './_jwksTestKit.js'

async function registry(): Promise<IssuerStore> {
  const issuers = new MemoryIssuer()
  await issuers.upsert({ issuerId: ISS, name: 'CAMEL', jwksUrl: JWKS_URL })
  return issuers
}

test('valid ES256 assertion from a registered issuer verifies', async () => {
  const kit = makeKey()
  const issuers = await registry()
  const { fetchFn, calls } = fakeJwksFetch({ keys: () => [kit.jwk] })
  const v = new AgentJwtVerifier({ issuers, fetchFn })

  const result = await v.verify(signES256(kit, camelClaims()))
  assert.ok(result)
  assert.equal(result!.payload.sub, 'agent:1:0xADAPTER:camel42')
  assert.equal(result!.payload.agentId, 'camel42')
  assert.equal(result!.issuer.issuerId, ISS)
  assert.equal(calls(), 1)
})

test('unregistered issuer → null (falls through to the next acceptor)', async () => {
  const kit = makeKey()
  const issuers = await registry()
  const { fetchFn, calls } = fakeJwksFetch({ keys: () => [kit.jwk] })
  const v = new AgentJwtVerifier({ issuers, fetchFn })

  const result = await v.verify(signES256(kit, camelClaims({ iss: 'https://evil.example' })))
  assert.equal(result, null)
  assert.equal(calls(), 0, 'no JWKS fetch for an unknown issuer')
})

test('suspended issuer → null', async () => {
  const kit = makeKey()
  const issuers = new MemoryIssuer()
  await issuers.upsert({ issuerId: ISS, name: 'CAMEL', jwksUrl: JWKS_URL, status: 'suspended' })
  const { fetchFn } = fakeJwksFetch({ keys: () => [kit.jwk] })
  const v = new AgentJwtVerifier({ issuers, fetchFn })
  assert.equal(await v.verify(signES256(kit, camelClaims())), null)
})

test('AUTH-SHADOW PROBE: garbage signature on a registered issuer → 401, not null/403', async () => {
  const kit = makeKey()
  const issuers = await registry()
  const { fetchFn } = fakeJwksFetch({ keys: () => [kit.jwk] })
  const v = new AgentJwtVerifier({ issuers, fetchFn })

  // A syntactically-valid ES256 JWT whose signature is tampered.
  const good = signES256(kit, camelClaims())
  const parts = good.split('.')
  const tampered = `${parts[0]}.${parts[1]}.${'A'.repeat(parts[2].length)}`

  await assert.rejects(
    () => v.verify(tampered),
    (err: unknown) => {
      assert.ok(err instanceof ApiError)
      assert.equal(err.httpStatus, 401)
      assert.equal(err.code, 'auth.invalid')
      assert.match(err.message, /INVALID_ASSERTION/)
      return true
    },
  )
})

test('expired assertion → 401', async () => {
  const kit = makeKey()
  const issuers = await registry()
  const { fetchFn } = fakeJwksFetch({ keys: () => [kit.jwk] })
  const v = new AgentJwtVerifier({ issuers, fetchFn })
  const token = signES256(kit, camelClaims({ exp: Math.floor(Date.now() / 1000) - 10 }))
  await assert.rejects(() => v.verify(token), (e: unknown) => e instanceof ApiError && e.httpStatus === 401)
})

test('wrong audience → 401', async () => {
  const kit = makeKey()
  const issuers = await registry()
  const { fetchFn } = fakeJwksFetch({ keys: () => [kit.jwk] })
  const v = new AgentJwtVerifier({ issuers, fetchFn })
  const token = signES256(kit, camelClaims({ aud: 'someone-else.art' }))
  await assert.rejects(() => v.verify(token), (e: unknown) => e instanceof ApiError && e.httpStatus === 401)
})

test('non-ES256 alg on a registered issuer → 401 (no HS256 confusion)', async () => {
  const issuers = await registry()
  const { fetchFn } = fakeJwksFetch({ keys: () => [] })
  const v = new AgentJwtVerifier({ issuers, fetchFn })
  // HS256 token that nonetheless claims the registered iss.
  const hs = (await import('jsonwebtoken')).default.sign(camelClaims(), 'shared-secret')
  await assert.rejects(() => v.verify(hs), (e: unknown) => e instanceof ApiError && e.httpStatus === 401)
})

test('unknown kid triggers exactly one refetch (key rotation), then succeeds', async () => {
  const oldKit = makeKey('key-old')
  const newKit = makeKey('key-1')
  const issuers = await registry()
  // First fetch serves the stale keyset; after a miss the verifier refetches and gets the new key.
  let rotated = false
  const { fetchFn, calls } = fakeJwksFetch({ keys: () => (rotated ? [newKit.jwk] : [oldKit.jwk]) })
  const v = new AgentJwtVerifier({ issuers, fetchFn })

  const token = signES256(newKit, camelClaims())
  // Prime the cache with the stale keyset (a first verify that would miss), then rotate.
  await assert.rejects(() => v.verify(token))   // stale keyset, kid miss even after refetch
  rotated = true
  const result = await v.verify(token)
  assert.ok(result, 'succeeds once the fresh JWKS carries the rotated key')
  assert.ok(calls() >= 3)
})

test('JWKS endpoint unreachable → 503 (retryable), not 401', async () => {
  const issuers = await registry()
  const { fetchFn } = fakeJwksFetch({ keys: () => [], fail: () => ({ throwErr: 'ECONNREFUSED' }) })
  const v = new AgentJwtVerifier({ issuers, fetchFn })
  const kit = makeKey()
  await assert.rejects(
    () => v.verify(signES256(kit, camelClaims())),
    (e: unknown) => e instanceof ApiError && e.httpStatus === 503 && e.opts.retryable === true,
  )
})

test('JWKS 500 response → 503', async () => {
  const issuers = await registry()
  const { fetchFn } = fakeJwksFetch({ keys: () => [], fail: () => ({ status: 500 }) })
  const v = new AgentJwtVerifier({ issuers, fetchFn })
  const kit = makeKey()
  await assert.rejects(() => v.verify(signES256(kit, camelClaims())), (e: unknown) => e instanceof ApiError && e.httpStatus === 503)
})

test('JWKS is cached across verifies (one fetch for two tokens)', async () => {
  const kit = makeKey()
  const issuers = await registry()
  const { fetchFn, calls } = fakeJwksFetch({ keys: () => [kit.jwk], cacheControl: 'public, max-age=3600' })
  const v = new AgentJwtVerifier({ issuers, fetchFn })
  await v.verify(signES256(kit, camelClaims()))
  await v.verify(signES256(kit, camelClaims({ sub: 'agent:1:0xADAPTER:camel99', agentId: 'camel99' })))
  assert.equal(calls(), 1, 'second verify hit the cache')
})

test('AGENT_JWKS_OVERRIDE redirects the fetch host but keeps iss', async () => {
  const kit = makeKey()
  const issuers = await registry()
  const { fetchFn, urls } = fakeJwksFetch({ keys: () => [kit.jwk] })
  const v = new AgentJwtVerifier({
    issuers,
    fetchFn,
    jwksOverride: { 'camelcabal.fun': 'https://camelcabal.monygroupcorporation.workers.dev' },
  })
  const result = await v.verify(signES256(kit, camelClaims()))
  assert.ok(result)
  assert.equal(urls()[0], 'https://camelcabal.monygroupcorporation.workers.dev/.well-known/jwks.json')
})

test('non-https jwksUrl (no override) → 503 SSRF refusal', async () => {
  const kit = makeKey()
  const issuers = new MemoryIssuer()
  await issuers.upsert({ issuerId: ISS, name: 'CAMEL', jwksUrl: 'http://camelcabal.fun/.well-known/jwks.json' })
  const { fetchFn, calls } = fakeJwksFetch({ keys: () => [kit.jwk] })
  const v = new AgentJwtVerifier({ issuers, fetchFn })
  await assert.rejects(() => v.verify(signES256(kit, camelClaims())), (e: unknown) => e instanceof ApiError && e.httpStatus === 503)
  assert.equal(calls(), 0, 'refused before any fetch')
})

test('parseJwksOverride tolerates junk and non-string values', () => {
  assert.deepEqual(parseJwksOverride(undefined), {})
  assert.deepEqual(parseJwksOverride('not json'), {})
  assert.deepEqual(parseJwksOverride('[1,2]'), {})
  assert.deepEqual(parseJwksOverride('{"a":"b","c":3}'), { a: 'b' })
})
