import { test } from 'node:test'
import assert from 'node:assert/strict'
import { inferFamilia, familiaOf } from '../../../src/crystal/inferFamilia.js'

test('inferFamilia prefers a recognized family tag', () => {
  assert.equal(inferFamilia({ tags: [{ tag: 'Flux' }] }), 'flux', 'tags are matched case-insensitively')
  assert.equal(inferFamilia({ tags: ['sdxl'] }), 'sdxl', 'bare-string tags work too')
})

test('inferFamilia falls back to name/dest/architectura', () => {
  assert.equal(inferFamilia({ nomen: 'FLUX VAE' }), 'flux')
  assert.equal(inferFamilia({ dest: 'loras/ponyXL-style.safetensors' }), 'pony')
  assert.equal(inferFamilia({ architectura: 'gguf', nomen: 'SmolLM2 135M' }), 'smollm')
})

test('inferFamilia returns undefined when nothing is recognizable', () => {
  assert.equal(inferFamilia({ nomen: 'Generic Thing', dest: 'models/x.safetensors' }), undefined)
  assert.equal(inferFamilia({}), undefined)
})

test('familiaOf prefers the first-class familia over inference', () => {
  assert.equal(familiaOf({ familia: 'sdxl', tags: [{ tag: 'flux' }] } as never), 'sdxl', 'explicit field wins')
  assert.equal(familiaOf({ nomen: 'FLUX VAE' } as never), 'flux', 'falls back to inference for a straggler')
  assert.equal(familiaOf({ nomen: 'Generic' } as never), undefined)
})
