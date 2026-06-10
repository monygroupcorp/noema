import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  IdentityResolver,
  credentialsFromHeaders,
  type CredentialAcceptors,
} from '../../../../src/allocutio/api/IdentityResolver.js'
import { ApiError } from '../../../../src/allocutio/api/errors.js'

test('commitment resolves to { commitment } with no acceptor configured', async () => {
  const resolver = new IdentityResolver({})
  const key = await resolver.resolve({ commitment: 'cmt-abc' })
  assert.deepEqual(key, { commitment: 'cmt-abc' })
})

test('commitment takes priority over other credentials', async () => {
  const resolver = new IdentityResolver({
    validateApiKey: async () => 'anima-x',
  })
  const key = await resolver.resolve({ commitment: 'cmt-1', apiKey: 'key-1' })
  assert.deepEqual(key, { commitment: 'cmt-1' })
})

test('valid apiKey resolves to { animaId }', async () => {
  const acceptors: CredentialAcceptors = {
    validateApiKey: async (key) => (key === 'good-key' ? 'anima-1' : null),
  }
  const resolver = new IdentityResolver(acceptors)
  const key = await resolver.resolve({ apiKey: 'good-key' })
  assert.deepEqual(key, { animaId: 'anima-1' })
})

test('invalid apiKey (acceptor returns null) throws auth.invalid', async () => {
  const resolver = new IdentityResolver({ validateApiKey: async () => null })
  await assert.rejects(
    () => resolver.resolve({ apiKey: 'bad-key' }),
    (err: unknown) => {
      assert.ok(err instanceof ApiError)
      assert.equal(err.code, 'auth.invalid')
      assert.equal(err.message, 'invalid API key')
      return true
    },
  )
})

test('Bearer JWT with verifyJwt returning animaId resolves to { animaId }', async () => {
  const acceptors: CredentialAcceptors = {
    verifyJwt: async (token) => (token === 'tok-2' ? 'anima-2' : null),
  }
  const resolver = new IdentityResolver(acceptors)
  const key = await resolver.resolve({ authorization: 'Bearer tok-2' })
  assert.deepEqual(key, { animaId: 'anima-2' })
})

test('Bearer JWT that fails verification throws auth.invalid (invalid token)', async () => {
  const resolver = new IdentityResolver({ verifyJwt: async () => null })
  await assert.rejects(
    () => resolver.resolve({ authorization: 'Bearer nope' }),
    (err: unknown) => {
      assert.ok(err instanceof ApiError)
      assert.equal(err.code, 'auth.invalid')
      assert.equal(err.message, 'invalid token')
      return true
    },
  )
})

test('web3 happy path resolves to { animaId }', async () => {
  const acceptors: CredentialAcceptors = {
    verifyWeb3: async (w) => (w.address === '0xabc' ? 'anima-3' : null),
  }
  const resolver = new IdentityResolver(acceptors)
  const key = await resolver.resolve({
    web3: { address: '0xabc', signature: '0xsig', nonce: 'n1' },
  })
  assert.deepEqual(key, { animaId: 'anima-3' })
})

test('web3 verification failure throws auth.invalid (web3 verification failed)', async () => {
  const resolver = new IdentityResolver({ verifyWeb3: async () => null })
  await assert.rejects(
    () => resolver.resolve({ web3: { address: '0x0', signature: 's', nonce: 'n' } }),
    (err: unknown) => {
      assert.ok(err instanceof ApiError)
      assert.equal(err.code, 'auth.invalid')
      assert.equal(err.message, 'web3 verification failed')
      return true
    },
  )
})

test('empty credentials throws auth.missing', async () => {
  const resolver = new IdentityResolver({})
  await assert.rejects(
    () => resolver.resolve({}),
    (err: unknown) => {
      assert.ok(err instanceof ApiError)
      assert.equal(err.code, 'auth.missing')
      return true
    },
  )
})

test('provided credential with no configured acceptor throws auth.invalid', async () => {
  // apiKey present but validateApiKey not configured
  const resolver = new IdentityResolver({})
  await assert.rejects(
    () => resolver.resolve({ apiKey: 'key' }),
    (err: unknown) => {
      assert.ok(err instanceof ApiError)
      assert.equal(err.code, 'auth.invalid')
      assert.equal(err.message, 'apiKey auth not configured')
      return true
    },
  )
})

test('credentialsFromHeaders maps authorization, x-api-key, and body.commitment', () => {
  const creds = credentialsFromHeaders(
    {
      authorization: 'Bearer jwt-here',
      'x-api-key': 'my-api-key',
    },
    { commitment: 'cmt-from-body' },
  )
  assert.equal(creds.authorization, 'Bearer jwt-here')
  assert.equal(creds.apiKey, 'my-api-key')
  assert.equal(creds.commitment, 'cmt-from-body')
  assert.equal(creds.web3, undefined)
})

test('credentialsFromHeaders maps body.web3 and tolerates missing fields', () => {
  const web3 = { address: '0xabc', signature: '0xsig', nonce: 'n1' }
  const creds = credentialsFromHeaders({}, { web3 })
  assert.deepEqual(creds.web3, web3)
  assert.equal(creds.authorization, undefined)
  assert.equal(creds.apiKey, undefined)
})
