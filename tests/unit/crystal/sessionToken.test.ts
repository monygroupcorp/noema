// sessionToken — mint/verify the session JWT + email link-token hashing. Hermetic.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import jwt from 'jsonwebtoken'
import {
  mintSession,
  readSession,
  makeLinkToken,
  hashLinkToken,
  SESSION_TYP,
} from '../../../src/crystal/sessionToken.js'

const SECRET = 'test-session-secret'
const ANIMA_ID = 'anima:test-1'

test('mintSession -> readSession round-trip returns the minted animaId', () => {
  const session = mintSession(ANIMA_ID, SECRET)
  assert.equal(session.tokenType, 'Bearer')
  assert.equal(session.expiresIn, 7 * 24 * 60 * 60)
  assert.equal(readSession(session.token, SECRET), ANIMA_ID)
})

test('readSession returns null on wrong secret', () => {
  const session = mintSession(ANIMA_ID, SECRET)
  assert.equal(readSession(session.token, 'other-secret'), null)
})

test('readSession returns null when typ is not "session"', () => {
  const token = jwt.sign({ sub: ANIMA_ID, typ: 'other' }, SECRET, { expiresIn: 60 })
  assert.equal(readSession(token, SECRET), null)
})

test('readSession returns null when typ is missing entirely', () => {
  const token = jwt.sign({ sub: ANIMA_ID }, SECRET, { expiresIn: 60 })
  assert.equal(readSession(token, SECRET), null)
})

test('readSession returns null on an expired token', () => {
  const session = mintSession(ANIMA_ID, SECRET, -1)
  assert.equal(readSession(session.token, SECRET), null)
})

test('readSession returns null on a malformed token', () => {
  assert.equal(readSession('not-a-jwt', SECRET), null)
})

test('readSession returns null when sub is not a string', () => {
  const token = jwt.sign({ sub: 12345, typ: SESSION_TYP }, SECRET, { expiresIn: 60 })
  assert.equal(readSession(token, SECRET), null)
})

test('makeLinkToken: hash is deterministic and matches hashLinkToken(plaintext)', () => {
  const { plaintext, hash } = makeLinkToken()
  assert.equal(hash, hashLinkToken(plaintext))
  assert.equal(hashLinkToken(plaintext), hashLinkToken(plaintext))
})

test('makeLinkToken: two calls produce distinct plaintexts and hashes', () => {
  const a = makeLinkToken()
  const b = makeLinkToken()
  assert.notEqual(a.plaintext, b.plaintext)
  assert.notEqual(a.hash, b.hash)
})

test('hashLinkToken: different inputs hash to different outputs, format is sha256 hex', () => {
  const h1 = hashLinkToken('token-a')
  const h2 = hashLinkToken('token-b')
  assert.notEqual(h1, h2)
  assert.match(h1, /^[0-9a-f]{64}$/)
})
