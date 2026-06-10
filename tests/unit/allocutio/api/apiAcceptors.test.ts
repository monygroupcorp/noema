import { test } from 'node:test'
import assert from 'node:assert/strict'
import jwt from 'jsonwebtoken'
import { makeCredentialAcceptors, type AcceptorDeps } from '../../../../src/allocutio/api/apiAcceptors.js'

const SECRET = 'test-secret'

function fakes() {
  const personaByKey = new Map<string, { activeAnimaId: string }>()
  let n = 0
  const created: string[] = []
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
      created.push(id)
      return { id, ...input } as never
    },
  }
  return { personae, animae, created }
}

test('verifyJwt: valid token mints an anima on first sight, reuses it after', async () => {
  const { personae, animae, created } = fakes()
  const acc = makeCredentialAcceptors({ personae, animae, jwtSecret: SECRET })
  const token = jwt.sign({ userId: 'u1' }, SECRET)

  const a1 = await acc.verifyJwt!(token)
  assert.equal(a1, 'anima-1')
  assert.deepEqual(created, ['anima-1'])

  const a2 = await acc.verifyJwt!(token)   // persona now exists → reuse, no new anima
  assert.equal(a2, 'anima-1')
  assert.deepEqual(created, ['anima-1'], 'no second anima minted')
})

test('verifyJwt: bad signature, wrong secret, or no id → null', async () => {
  const { personae, animae } = fakes()
  const acc = makeCredentialAcceptors({ personae, animae, jwtSecret: SECRET })
  assert.equal(await acc.verifyJwt!('garbage'), null)
  assert.equal(await acc.verifyJwt!(jwt.sign({ userId: 'u1' }, 'wrong')), null)
  assert.equal(await acc.verifyJwt!(jwt.sign({ foo: 'bar' }, SECRET)), null, 'no userId/sub → null')
})

test('verifyJwt accepts sub/_id/id as the external id', async () => {
  const { personae, animae } = fakes()
  const acc = makeCredentialAcceptors({ personae, animae, jwtSecret: SECRET })
  assert.equal(await acc.verifyJwt!(jwt.sign({ sub: 's1' }, SECRET)), 'anima-1')
})

test('validateApiKey: injected verifier → anima via an api persona', async () => {
  const { personae, animae } = fakes()
  const acc = makeCredentialAcceptors({
    personae, animae,
    verifyApiKeyToAccountId: async (k) => (k === 'good' ? 'acct1' : null),
  })
  assert.equal(await acc.validateApiKey!('good'), 'anima-1')
  assert.equal(await acc.validateApiKey!('good'), 'anima-1', 'same account → same anima')
  assert.equal(await acc.validateApiKey!('bad'), null)
})

test('verifyWeb3: injected verifier → anima via a web persona keyed by lowercased address', async () => {
  const { personae, animae } = fakes()
  const acc = makeCredentialAcceptors({
    personae, animae,
    verifyWeb3ToAddress: async (w) => (w.signature === 'sig' ? '0xABC' : null),
  })
  assert.equal(await acc.verifyWeb3!({ address: '0xABC', signature: 'sig', nonce: 'n' }), 'anima-1')
  assert.equal(await acc.verifyWeb3!({ address: '0xABC', signature: 'bad', nonce: 'n' }), null)
})

test('unconfigured acceptors are undefined', async () => {
  const { personae, animae } = fakes()
  const acc = makeCredentialAcceptors({ personae, animae })
  assert.equal(acc.verifyJwt, undefined)
  assert.equal(acc.validateApiKey, undefined)
  assert.equal(acc.verifyWeb3, undefined)
})
