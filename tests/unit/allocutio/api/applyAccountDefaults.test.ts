import { test } from 'node:test'
import assert from 'node:assert/strict'
import { applyAccountDefaults } from '../../../../src/allocutio/api/CrystalApi.js'

// =============================================================================
// applyAccountDefaults — layers account defaults UNDER the cast-time aditus:
//   cast-time input > affines (per-modus) > generatio (cross-cutting) > modus defaults.
// Only DECLARED ports are ever filled; `style` augments (prepends) the prompt.
// =============================================================================

const ports = { prompt: {}, negative_prompt: {}, steps: {}, cfg: {} }

test('affines fill declared ports the caller left unset', () => {
  const out = applyAccountDefaults(ports, { prompt: 'a cat' }, { steps: 30, cfg: 4 }, undefined)
  assert.deepEqual(out, { prompt: 'a cat', steps: 30, cfg: 4 })
})

test('cast-time input wins over an affine', () => {
  const out = applyAccountDefaults(ports, { prompt: 'a cat', steps: 12 }, { steps: 30 }, undefined)
  assert.equal(out.steps, 12)
})

test('affines override generatio within the account tier', () => {
  const out = applyAccountDefaults(ports, {}, { negative_prompt: 'from affine' }, { negativePrompt: 'from generatio' })
  assert.equal(out.negative_prompt, 'from affine')
})

test('generatio fills a negative-prompt port when neither cast-time nor affine set it', () => {
  const out = applyAccountDefaults(ports, { prompt: 'a cat' }, undefined, { negativePrompt: 'blurry, text' })
  assert.equal(out.negative_prompt, 'blurry, text')
})

test('an undeclared affine/negative key is NEVER injected', () => {
  const noNeg = { prompt: {}, steps: {} }
  const out = applyAccountDefaults(noNeg, { prompt: 'a cat' }, { unknown_key: 'x' }, { negativePrompt: 'blurry' })
  assert.equal('unknown_key' in out, false, 'affine for an undeclared port is dropped')
  assert.equal('negative_prompt' in out, false, 'no negative port → no fill')
})

test('style prepends to the resolved prompt (augments, does not override)', () => {
  const out = applyAccountDefaults(ports, { prompt: 'a frost knight' }, undefined, { style: 'cinematic, cold' })
  assert.equal(out.prompt, 'cinematic, cold, a frost knight')
})

test('style is a no-op when there is no prompt', () => {
  const out = applyAccountDefaults(ports, { steps: 10 }, undefined, { style: 'cinematic' })
  assert.equal('prompt' in out, false)
})

test('no affines + no generatio → aditus is returned unchanged in shape', () => {
  const out = applyAccountDefaults(ports, { prompt: 'a cat', steps: 5 }, undefined, {})
  assert.deepEqual(out, { prompt: 'a cat', steps: 5 })
})
