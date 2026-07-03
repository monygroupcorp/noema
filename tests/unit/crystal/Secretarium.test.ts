// Secretarium (MemorySecretarium) + ownerKeyOf — hermetic, no Mongo.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { makeSecretBox } from '../../../src/crystal/secretBox.js'
import { MemorySecretarium } from '../../../src/crystal/MemorySecretarium.js'
import { ownerKeyOf } from '../../../src/crystal/ownerKey.js'

const boxOf = () => makeSecretBox([randomBytes(32)])

test('ownerKeyOf: animaId readable; bearer discriminants hashed & stable', () => {
  assert.equal(ownerKeyOf({ animaId: 'anima-1' }), 'anima:anima-1')

  const b = ownerKeyOf({ bursaToken: 'tok-xyz' })
  assert.ok(b.startsWith('bursa:'))
  assert.ok(!b.includes('tok-xyz'), 'raw bearer token must not appear in the key')
  assert.equal(b, ownerKeyOf({ bursaToken: 'tok-xyz' }), 'same token → same key')
  assert.notEqual(b, ownerKeyOf({ bursaToken: 'tok-other' }))

  const c = ownerKeyOf({ commitment: 'cmt-1' })
  assert.ok(c.startsWith('commitment:') && !c.includes('cmt-1'))
})

test('put/has/remove and resolve round-trip under a stable ownerKey', async () => {
  const s = new MemorySecretarium(boxOf())
  const owner = ownerKeyOf({ animaId: 'a1' })

  assert.equal(await s.has(owner, 'civitai'), false)
  await s.put(owner, 'civitai', 'my-civitai-token', 90)
  assert.equal(await s.has(owner, 'civitai'), true)
  assert.equal(await s.resolve(owner, 'civitai'), 'my-civitai-token')

  await s.remove(owner, 'civitai')
  assert.equal(await s.has(owner, 'civitai'), false)
  assert.equal(await s.resolve(owner, 'civitai'), null)
})

test('providers and owners are isolated', async () => {
  const s = new MemorySecretarium(boxOf())
  const a = ownerKeyOf({ animaId: 'a' })
  const b = ownerKeyOf({ bursaToken: 'b' })
  await s.put(a, 'civitai', 'A-civitai', 90)
  await s.put(a, 'huggingface', 'A-hf', 90)
  await s.put(b, 'civitai', 'B-civitai', 90)

  assert.equal(await s.resolve(a, 'civitai'), 'A-civitai')
  assert.equal(await s.resolve(a, 'huggingface'), 'A-hf')
  assert.equal(await s.resolve(b, 'civitai'), 'B-civitai')
  assert.equal(await s.has(b, 'huggingface'), false)
})

test('re-put replaces the secret and resets usage', async () => {
  let t = Date.parse('2026-07-02T00:00:00Z')
  const now = () => new Date(t)
  const s = new MemorySecretarium(boxOf(), now)
  const owner = ownerKeyOf({ animaId: 'a1' })

  await s.put(owner, 'civitai', 'old', 90)
  await s.resolve(owner, 'civitai') // marks used
  await s.put(owner, 'civitai', 'new', 90)
  assert.equal(await s.resolve(owner, 'civitai'), 'new')
})

test('idle-expiry: a resolve past expiresAt returns null; a real use pushes it forward', async () => {
  let t = Date.parse('2026-07-02T00:00:00Z')
  const now = () => new Date(t)
  const s = new MemorySecretarium(boxOf(), now)
  const owner = ownerKeyOf({ animaId: 'a1' })

  await s.put(owner, 'civitai', 'tok', 10) // expires in 10 days

  // Day 9: still valid, and the use pushes expiry to day 19.
  t = Date.parse('2026-07-11T00:00:00Z')
  assert.equal(await s.resolve(owner, 'civitai'), 'tok')

  // Day 18: still valid because the day-9 use extended it.
  t = Date.parse('2026-07-20T00:00:00Z')
  assert.equal(await s.resolve(owner, 'civitai'), 'tok')

  // Day 30: no use since day 18 → expired.
  t = Date.parse('2026-08-01T00:00:00Z')
  assert.equal(await s.resolve(owner, 'civitai'), null)
})
