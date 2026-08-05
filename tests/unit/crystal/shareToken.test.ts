import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mintShareToken, SHARE_TOKEN_ALPHABET, SHARE_TOKEN_LENGTH } from '../../../src/crystal/shareToken.js'

test('mintShareToken returns a token of the documented length', () => {
  const t = mintShareToken()
  assert.equal(t.length, SHARE_TOKEN_LENGTH)
})

test('mintShareToken uses only the look-alike-free alphabet', () => {
  // Run a few times to dodge an accidentally-narrow alphabet at low N.
  for (let i = 0; i < 1000; i++) {
    const t = mintShareToken()
    for (const ch of t) assert.ok(SHARE_TOKEN_ALPHABET.includes(ch), `unexpected char ${JSON.stringify(ch)}`)
  }
})

test('mintShareToken is collision-free across a large sample', () => {
  // 80 bits of entropy → the birthday-collision floor is ~2^40 samples; 100k is dwarfed.
  const N = 100_000
  const seen = new Set<string>()
  for (let i = 0; i < N; i++) seen.add(mintShareToken())
  assert.equal(seen.size, N, 'all minted tokens must be unique')
})
