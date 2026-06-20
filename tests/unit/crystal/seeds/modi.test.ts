import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  CANONICAL_MODI,
  MODUS_CHATGPT,
  MODUS_DALLE_III,
  MODUS_JOYCAPTION,
  MODUS_LAYER_COMPOSITE,
} from '../../../../src/crystal/seeds/modi.js'

test('CANONICAL_MODI contains four entries', () => {
  assert.equal(CANONICAL_MODI.length, 4)
})

test('layer-composite modus is host-side (ministerium composite, sync, no fixed cost)', () => {
  assert.equal(MODUS_LAYER_COMPOSITE.ministerium, 'composite')
  assert.equal(MODUS_LAYER_COMPOSITE.deliveryMode, 'sync')
  assert.equal(MODUS_LAYER_COMPOSITE.impetusFixum, undefined)
  assert.equal(MODUS_LAYER_COMPOSITE.aditus.layers?.type, 'text')
  assert.equal(MODUS_LAYER_COMPOSITE.exitus.image?.type, 'image')
})

test('chatgpt modus has ministerium openai and deliveryMode sync', () => {
  assert.equal(MODUS_CHATGPT.ministerium, 'openai')
  assert.equal(MODUS_CHATGPT.deliveryMode, 'sync')
})

test('dalle modus has ministerium openai and impetusFixum 50n', () => {
  assert.equal(MODUS_DALLE_III.ministerium, 'openai')
  assert.equal(MODUS_DALLE_III.impetusFixum, 50n)
})

test('joycaption modus has ministerium huggingface and __spaceUrl in aditus', () => {
  assert.equal(MODUS_JOYCAPTION.ministerium, 'huggingface')
  assert.ok('__spaceUrl' in MODUS_JOYCAPTION.aditus)
})

test('all modi have canonica true', () => {
  for (const m of CANONICAL_MODI) {
    assert.equal(m.canonica, true, `${m.id} should have canonica true`)
  }
})

test('all modi have non-empty id, nomen, versio', () => {
  for (const m of CANONICAL_MODI) {
    assert.ok(m.id.length > 0, `${m.id} id should be non-empty`)
    assert.ok(m.nomen.length > 0, `${m.id} nomen should be non-empty`)
    assert.ok(m.versio.length > 0, `${m.id} versio should be non-empty`)
  }
})
