// secretBox — AES-256-GCM envelope. Hermetic; exercises the real node:crypto path.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { makeSecretBox, secretBoxFromEnv } from '../../../src/crystal/secretBox.js'

const key = () => randomBytes(32)

test('seal → open round-trips the plaintext', () => {
  const box = makeSecretBox([key()])
  const sealed = box.seal('civitai-token-abc123')
  assert.equal(box.open(sealed), 'civitai-token-abc123')
})

test('the plaintext never appears in the envelope', () => {
  const box = makeSecretBox([key()])
  const sealed = box.seal('SUPERSECRET')
  const blob = JSON.stringify(sealed)
  assert.ok(!blob.includes('SUPERSECRET'))
  assert.ok(sealed.ciphertext && sealed.iv && sealed.authTag && sealed.keyId)
})

test('a fresh IV per seal → different ciphertext for the same plaintext', () => {
  const box = makeSecretBox([key()])
  const a = box.seal('same')
  const b = box.seal('same')
  assert.notEqual(a.ciphertext, b.ciphertext)
  assert.notEqual(a.iv, b.iv)
})

test('a tampered ciphertext fails the auth tag', () => {
  const box = makeSecretBox([key()])
  const sealed = box.seal('token')
  const flipped = Buffer.from(sealed.ciphertext, 'base64')
  flipped[0] ^= 0xff
  assert.throws(() => box.open({ ...sealed, ciphertext: flipped.toString('base64') }))
})

test('a key not in the ring cannot open the envelope', () => {
  const sealed = makeSecretBox([key()]).seal('token')
  const other = makeSecretBox([key()])
  assert.throws(() => other.open(sealed), /no key for keyId/)
})

test('rotation ring: seal with active, open with a retired key still in the ring', () => {
  const oldKey = key()
  const sealedOld = makeSecretBox([oldKey]).seal('legacy')
  // New ring: fresh active key prepended, old key retained.
  const rotated = makeSecretBox([key(), oldKey])
  assert.equal(rotated.open(sealedOld), 'legacy')
})

test('makeSecretBox rejects a wrong-length key and an empty ring', () => {
  assert.throws(() => makeSecretBox([]), /at least one key/)
  assert.throws(() => makeSecretBox([randomBytes(16)]), /32 bytes/)
})

test('secretBoxFromEnv: absent → null; hex/base64 keys parse; ring is comma-separated', () => {
  assert.equal(secretBoxFromEnv({} as NodeJS.ProcessEnv), null)
  assert.equal(secretBoxFromEnv({ SECRETA_MASTER_KEY: 'not-a-key' } as unknown as NodeJS.ProcessEnv), null)

  const hex = randomBytes(32).toString('hex')
  const b64 = randomBytes(32).toString('base64')
  const box = secretBoxFromEnv({ SECRETA_MASTER_KEY: `${hex},${b64}` } as unknown as NodeJS.ProcessEnv)
  assert.ok(box)
  assert.equal(box!.open(box!.seal('x')), 'x')
})
