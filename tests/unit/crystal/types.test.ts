import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { Porta } from '../../../src/types/modus.js'
import type { Tractus, TraitValor } from '../../../src/types/collectio.js'

// ── Porta ─────────────────────────────────────────────────────────────────────

test('Porta with all fields round-trips through JSON without loss', () => {
  const porta: Porta = {
    type: 'image',
    required: true,
    default: 'none',
    label: 'Background Image',
    description: 'The background image for the scene',
  }
  const roundTripped = JSON.parse(JSON.stringify(porta)) as Porta
  assert.equal(roundTripped.type, 'image')
  assert.equal(roundTripped.required, true)
  assert.equal(roundTripped.default, 'none')
  assert.equal(roundTripped.label, 'Background Image')
  assert.equal(roundTripped.description, 'The background image for the scene')
})

test('Porta without label is still valid (label is optional)', () => {
  const porta: Porta = { type: 'text' }
  assert.equal(porta.label, undefined)
  assert.equal(porta.type, 'text')
})

// ── TraitValor ────────────────────────────────────────────────────────────────

test('TraitValor with all fields round-trips through JSON without loss', () => {
  const valor: TraitValor = {
    value: 'desert_bg.png',
    label: 'Desert',
    rarity: 0.3,
    promptFragment: 'a vast desert landscape',
    excludes: ['Cactus', 'Sand Dune'],
  }
  const roundTripped = JSON.parse(JSON.stringify(valor)) as TraitValor
  assert.equal(roundTripped.value, 'desert_bg.png')
  assert.equal(roundTripped.label, 'Desert')
  assert.equal(roundTripped.rarity, 0.3)
  assert.equal(roundTripped.promptFragment, 'a vast desert landscape')
  assert.deepEqual(roundTripped.excludes, ['Cactus', 'Sand Dune'])
})

test('TraitValor with only value is valid (all other fields optional)', () => {
  const valor: TraitValor = { value: 42 }
  assert.equal(valor.value, 42)
  assert.equal(valor.label, undefined)
  assert.equal(valor.rarity, undefined)
  assert.equal(valor.promptFragment, undefined)
  assert.equal(valor.excludes, undefined)
})

// ── Tractus ───────────────────────────────────────────────────────────────────

test('Tractus with label and multiple TraitValor entries is structurally valid', () => {
  const tractus: Tractus = {
    porta: 'background',
    label: 'Background',
    valores: [
      { value: 'desert.png', label: 'Desert', rarity: 0.3 },
      { value: 'forest.png', label: 'Forest', rarity: 0.5 },
      { value: 'city.png', label: 'City', rarity: 0.2 },
    ],
  }
  assert.equal(tractus.porta, 'background')
  assert.equal(tractus.label, 'Background')
  assert.equal(tractus.valores.length, 3)
  assert.equal((tractus.valores[0] as TraitValor).label, 'Desert')
})

test('Tractus without label is valid (label is optional)', () => {
  const tractus: Tractus = {
    porta: 'seed',
    valores: [{ value: 1 }, { value: 2 }],
  }
  assert.equal(tractus.label, undefined)
  assert.equal(tractus.porta, 'seed')
  assert.equal(tractus.valores.length, 2)
})

test('TraitValor round-trips through JSON preserving all optional fields', () => {
  const tractus: Tractus = {
    porta: 'outfit',
    label: 'Outfit',
    valores: [
      { value: 'knight', label: 'Knight', rarity: 0.4, promptFragment: 'wearing knight armor', excludes: ['Wizard'] },
      { value: 'wizard', label: 'Wizard', rarity: 0.6 },
    ],
  }
  const roundTripped = JSON.parse(JSON.stringify(tractus)) as Tractus
  assert.equal(roundTripped.label, 'Outfit')
  assert.equal((roundTripped.valores[0] as TraitValor).excludes?.[0], 'Wizard')
  assert.equal((roundTripped.valores[1] as TraitValor).rarity, 0.6)
})
