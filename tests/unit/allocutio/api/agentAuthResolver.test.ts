// Integration: the federated JWKS acceptor wired through IdentityResolver — the
// path a real Bearer assertion travels. Proves the auth-shadow probe (garbage
// signature → 401, never 403), the federated happy path (→ a 'federated' persona),
// and that legacy web (HS256) tokens still resolve via the fall-through.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import jwt from 'jsonwebtoken'
import { IdentityResolver } from '../../../../src/allocutio/api/IdentityResolver.js'
import { makeCredentialAcceptors, type AcceptorDeps } from '../../../../src/allocutio/api/apiAcceptors.js'
import { ApiError } from '../../../../src/allocutio/api/errors.js'
import { MemoryIssuer } from '../../../../src/crystal/MemoryIssuer.js'
import { makeKey, camelClaims, signES256, fakeJwksFetch, ISS, JWKS_URL } from './_jwksTestKit.js'

const WEB_SECRET = 'web-secret'

function fakes() {
  const personaByKey = new Map<string, { activeAnimaId: string }>()
  let n = 0
  const created: Array<{ id: string; nomen?: string }> = []
  const personae: AcceptorDeps['personae'] = {
    async findByExternus(genus, ext) {
      return (personaByKey.get(`${genus}\0${ext}`) ?? null) as never
    },
    async findOrCreate(genus, ext, defaults) {
      const p = { activeAnimaId: defaults!.animaId }
      personaByKey.set(`${genus}\0${ext}`, p)
      return p as never
    },
  }
  const animae: AcceptorDeps['animae'] = {
    async create(input) {
      const id = `anima-${++n}`
      created.push({ id, ...(input as { nomen?: string }) })
      return { id, ...input } as never
    },
  }
  return { personae, animae, created, personaKeys: () => [...personaByKey.keys()] }
}

async function wire(over: Partial<AcceptorDeps> = {}) {
  const kit = makeKey()
  const issuers = new MemoryIssuer()
  await issuers.upsert({ issuerId: ISS, name: 'CAMEL', jwksUrl: JWKS_URL })
  const { fetchFn } = fakeJwksFetch({ keys: () => [kit.jwk] })
  const f = fakes()
  const acceptors = makeCredentialAcceptors({
    personae: f.personae,
    animae: f.animae,
    jwtSecret: WEB_SECRET,
    issuers,
    jwksFetch: fetchFn,
    ...over,
  })
  return { kit, resolver: new IdentityResolver(acceptors), ...f }
}

test('federated ES256 Bearer → { animaId } via a new federated persona', async () => {
  const { kit, resolver, created, personaKeys } = await wire()
  const key = await resolver.resolve({ authorization: `Bearer ${signES256(kit, camelClaims())}` })
  assert.deepEqual(key, { animaId: 'anima-1' })
  assert.equal(created.length, 1)
  // externusId is issuer-namespaced `<iss>::<sub>` under the 'federated' genus.
  assert.deepEqual(personaKeys(), [`federated\0${ISS}::agent:1:0xADAPTER:camel42`])
})

test('same agent re-auth reuses the anima (idempotent on first sight)', async () => {
  const { kit, resolver, created } = await wire()
  const token = () => signES256(kit, camelClaims())
  await resolver.resolve({ authorization: `Bearer ${token()}` })
  await resolver.resolve({ authorization: `Bearer ${token()}` })
  assert.equal(created.length, 1, 'no second anima')
})

test('AUTH-SHADOW PROBE end-to-end: garbage-signature ES256 Bearer → 401, not 403', async () => {
  const { kit, resolver } = await wire()
  const good = signES256(kit, camelClaims())
  const parts = good.split('.')
  const tampered = `${parts[0]}.${parts[1]}.${'A'.repeat(parts[2].length)}`
  await assert.rejects(
    () => resolver.resolve({ authorization: `Bearer ${tampered}` }),
    (err: unknown) => {
      assert.ok(err instanceof ApiError)
      assert.equal(err.httpStatus, 401)
      assert.notEqual(err.httpStatus, 403)
      return true
    },
  )
})

test('legacy web HS256 Bearer still resolves via the fall-through', async () => {
  const { resolver, created } = await wire()
  const web = jwt.sign({ userId: 'u-web' }, WEB_SECRET)
  const key = await resolver.resolve({ authorization: `Bearer ${web}` })
  assert.deepEqual(key, { animaId: 'anima-1' })
  assert.equal(created.length, 1)
})

test('ES256 Bearer from an UNREGISTERED issuer falls through to the web path → invalid token', async () => {
  const { kit, resolver } = await wire()
  const token = signES256(kit, camelClaims({ iss: 'https://not-registered.example' }))
  // Not federated (unknown iss) → tried as an HS256 web token → fails → 401 invalid token.
  await assert.rejects(
    () => resolver.resolve({ authorization: `Bearer ${token}` }),
    (err: unknown) => err instanceof ApiError && err.code === 'auth.invalid' && err.message === 'invalid token',
  )
})
