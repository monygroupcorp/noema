import { test } from 'node:test'
import assert from 'node:assert/strict'
import { TokenMap } from '../../../../src/allocutio/telegram/tokenMap.js'

test('encode returns 8-char hex string', () => {
  const map = new TokenMap()
  const token = map.encode('some-session-key')
  assert.equal(typeof token, 'string')
  assert.equal(token.length, 8)
  assert.match(token, /^[0-9a-f]{8}$/)
})

test('decode(encode(key)) returns original key', () => {
  const map = new TokenMap()
  const key = 'session:telegram:12345:execute'
  const token = map.encode(key)
  assert.equal(map.decode(token), key)
})

test('decode of unknown token returns null', () => {
  const map = new TokenMap()
  assert.equal(map.decode('deadbeef'), null)
})

test('revoke makes token return null', () => {
  const map = new TokenMap()
  const key = 'some-key'
  const token = map.encode(key)
  map.revoke(token)
  assert.equal(map.decode(token), null)
})

test('two calls to encode with same key return different tokens', () => {
  const map = new TokenMap()
  const key = 'repeated-session-key'
  const token1 = map.encode(key)
  const token2 = map.encode(key)
  // Different tokens (crypto.randomBytes makes this overwhelmingly likely)
  assert.notEqual(token1, token2)
  // Both decode to the same key
  assert.equal(map.decode(token1), key)
  assert.equal(map.decode(token2), key)
})
