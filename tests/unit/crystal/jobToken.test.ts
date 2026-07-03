// jobToken (C0) — mint/verify a self-verifying per-job pod credential. Hermetic.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mintJobToken, verifyJobToken } from '../../../src/crystal/jobToken.js'

const SECRET = 'test-job-token-secret'
const T0 = Date.parse('2026-07-02T00:00:00Z')
const claims = (over = {}) => ({ actumId: 'actum-1', ownerKey: 'anima:owner-1', exp: T0 + 60_000, ...over })

test('round-trip: a freshly-minted token verifies to its claims before expiry', () => {
  const tok = mintJobToken(SECRET, claims())
  const out = verifyJobToken(SECRET, tok, T0)
  assert.deepEqual(out, claims())
})

test('expired token verifies to null (exp <= now)', () => {
  const tok = mintJobToken(SECRET, claims({ exp: T0 }))
  assert.equal(verifyJobToken(SECRET, tok, T0), null, 'exp == now is expired')
  assert.equal(verifyJobToken(SECRET, tok, T0 + 1), null)
})

test('wrong secret is rejected', () => {
  const tok = mintJobToken(SECRET, claims())
  assert.equal(verifyJobToken('other-secret', tok, T0), null)
})

test('tampered payload (forged ownerKey) is rejected — signature covers the claims', () => {
  const tok = mintJobToken(SECRET, claims())
  const [, sig] = tok.split('.')
  // Re-encode a claims blob that escalates ownerKey but keep the original signature.
  const forgedPayload = Buffer.from(JSON.stringify(claims({ ownerKey: 'anima:victim' })), 'utf8')
    .toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
  assert.equal(verifyJobToken(SECRET, `${forgedPayload}.${sig}`, T0), null)
})

test('malformed tokens verify to null (no dot / empty halves / garbage)', () => {
  for (const bad of ['', 'nodot', '.onlysig', 'onlypayload.', 'a.b', '..', 'x.y.z']) {
    assert.equal(verifyJobToken(SECRET, bad, T0), null, `"${bad}" should be null`)
  }
})

test('claims missing a required field verify to null even if signed', () => {
  // Sign a payload that is valid JSON but not a full JobTokenClaims.
  const payload = Buffer.from(JSON.stringify({ actumId: 'a', ownerKey: 'anima:o' }), 'utf8')
    .toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
  const tok = mintJobToken(SECRET, claims())          // just to prove verify works generally
  assert.ok(verifyJobToken(SECRET, tok, T0))
  // Hand-sign the incomplete payload with the real secret via a second mint round-trip is
  // not possible (mint takes typed claims), so assert the structural guard through the public
  // API by round-tripping a token whose exp is absent → treated as malformed.
  const noExp = mintJobToken(SECRET, { actumId: 'a', ownerKey: 'anima:o', exp: undefined as unknown as number })
  assert.equal(verifyJobToken(SECRET, noExp, T0), null)
  assert.ok(payload.length > 0)
})

test('a Bursa purse ownerKey round-trips (identity-source agnostic)', () => {
  const tok = mintJobToken(SECRET, claims({ ownerKey: 'bursa:2f2ce3c0' }))
  assert.equal(verifyJobToken(SECRET, tok, T0)?.ownerKey, 'bursa:2f2ce3c0')
})
