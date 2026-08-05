import { test } from 'node:test'
import assert from 'node:assert/strict'
import { hashPassword, verifyPassword } from '../../../src/crystal/passwordHash.js'

test('hashPassword → verifyPassword round-trip', async () => {
  const env = await hashPassword('correct horse battery staple')
  assert.match(env, /^scrypt\$\d+\$\d+\$\d+\$/)
  assert.equal(await verifyPassword('correct horse battery staple', env), true)
  assert.equal(await verifyPassword('wrong password', env), false)
})

test('each hash uses a fresh salt (envelopes differ for the same password)', async () => {
  const a = await hashPassword('samepass123')
  const b = await hashPassword('samepass123')
  assert.notEqual(a, b)
  assert.equal(await verifyPassword('samepass123', a), true)
  assert.equal(await verifyPassword('samepass123', b), true)
})

test('malformed / foreign envelopes verify to false, never throw', async () => {
  assert.equal(await verifyPassword('x', ''), false)
  assert.equal(await verifyPassword('x', 'not-an-envelope'), false)
  assert.equal(await verifyPassword('x', 'bcrypt$1$2$3$salt$hash'), false)
  assert.equal(await verifyPassword('x', 'scrypt$16384$8$1$$'), false)
})
