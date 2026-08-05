import { test } from 'node:test'
import assert from 'node:assert/strict'
import { hashModus } from '../../../src/crystal/hashModus.js'
import type { Modus } from '../../../src/types/modus.js'

function makeModus(overrides: Partial<Modus> = {}): Modus {
  return {
    id: 'test.modus',
    nomen: 'Test',
    genus: 'atomicus',
    versio: '1.0.0',
    contentHash: '',
    aditus: { prompt: { type: 'text', required: true } },
    exitus: { image: { type: 'image' } },
    ministerium: 'runpod',
    canonica: true,
    natum: new Date('2025-01-01'),
    mutatum: new Date('2025-01-01'),
    ...overrides,
  }
}

test('hashModus returns a 64-char hex string', () => {
  const h = hashModus(makeModus())
  assert.match(h, /^[0-9a-f]{64}$/)
})

test('same definition produces same hash', () => {
  const m = makeModus()
  assert.equal(hashModus(m), hashModus(m))
})

test('different nomen produces different hash', () => {
  const a = hashModus(makeModus({ nomen: 'Alpha' }))
  const b = hashModus(makeModus({ nomen: 'Beta' }))
  assert.notEqual(a, b)
})

test('different versio produces different hash', () => {
  const a = hashModus(makeModus({ versio: '1.0.0' }))
  const b = hashModus(makeModus({ versio: '2.0.0' }))
  assert.notEqual(a, b)
})

test('different aditus produces different hash', () => {
  const a = hashModus(makeModus({ aditus: { prompt: { type: 'text' } } }))
  const b = hashModus(makeModus({ aditus: { image: { type: 'image' } } }))
  assert.notEqual(a, b)
})

test('different exitus produces different hash', () => {
  const a = hashModus(makeModus({ exitus: { image: { type: 'image' } } }))
  const b = hashModus(makeModus({ exitus: { video: { type: 'video' } } }))
  assert.notEqual(a, b)
})

test('natum and mutatum do not affect hash — they are metadata not content', () => {
  const a = hashModus(makeModus({ natum: new Date('2020-01-01'), mutatum: new Date('2020-01-01') }))
  const b = hashModus(makeModus({ natum: new Date('2099-12-31'), mutatum: new Date('2099-12-31') }))
  assert.equal(a, b)
})

test('contentHash field does not affect hash — it is self-referential', () => {
  const a = hashModus(makeModus({ contentHash: '' }))
  const b = hashModus(makeModus({ contentHash: 'some-previous-hash' }))
  assert.equal(a, b)
})

test('id does not affect hash — same content registered under different ids hashes differently via nomen/versio', () => {
  // Two modi with same content but different ids are DIFFERENT —
  // id is part of the identity and must be included in content hash
  const a = hashModus(makeModus({ id: 'tool.alpha' }))
  const b = hashModus(makeModus({ id: 'tool.beta' }))
  assert.notEqual(a, b)
})

test('impetusFixum bigint is included in hash', () => {
  const a = hashModus(makeModus({ impetusFixum: 100n }))
  const b = hashModus(makeModus({ impetusFixum: 200n }))
  assert.notEqual(a, b)
})

test('absent vs present impetusFixum produces different hash', () => {
  const a = hashModus(makeModus({}))
  const b = hashModus(makeModus({ impetusFixum: 0n }))
  assert.notEqual(a, b)
})
