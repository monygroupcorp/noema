import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { Forma } from '../../../src/types/modus.js'
import { validateAditus } from '../../../src/execution/validateAditus.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function schema(ports: Forma): Forma {
  return ports
}

// ---------------------------------------------------------------------------
// 1. Strips unknown keys
// ---------------------------------------------------------------------------

test('validateAditus: strips unknown keys', () => {
  const s = schema({ prompt: { type: 'text', required: true } })
  const result = validateAditus(s, { prompt: 'hello', extra: 'unwanted' })
  assert.deepEqual(result, { prompt: 'hello' })
})

// ---------------------------------------------------------------------------
// 2. Throws on missing required fields
// ---------------------------------------------------------------------------

test('validateAditus: throws on missing required field', () => {
  const s = schema({ prompt: { type: 'text', required: true } })
  assert.throws(
    () => validateAditus(s, {}),
    { message: 'aditus: required field "prompt" is missing' }
  )
})

// ---------------------------------------------------------------------------
// 3. Applies defaults
// ---------------------------------------------------------------------------

test('validateAditus: applies default when key is absent', () => {
  const s = schema({ steps: { type: 'int', required: false, default: 20 } })
  const result = validateAditus(s, {})
  assert.deepEqual(result, { steps: 20 })
})

// ---------------------------------------------------------------------------
// 4. Type coercion — 'text'
// ---------------------------------------------------------------------------

test('validateAditus: coerces text to string', () => {
  const s = schema({ count: { type: 'text', required: true } })
  const result = validateAditus(s, { count: 42 })
  assert.deepEqual(result, { count: '42' })
})

test('validateAditus: throws for text field when value is null and required', () => {
  const s = schema({ prompt: { type: 'text', required: true } })
  assert.throws(
    () => validateAditus(s, { prompt: null }),
    { message: 'aditus: required field "prompt" is missing' }
  )
})

test('validateAditus: throws for text field when value is undefined and required', () => {
  const s = schema({ prompt: { type: 'text', required: true } })
  assert.throws(
    () => validateAditus(s, { prompt: undefined }),
    { message: 'aditus: required field "prompt" is missing' }
  )
})

// ---------------------------------------------------------------------------
// 5. Type coercion — 'int'
// ---------------------------------------------------------------------------

test('validateAditus: coerces int via Math.round(Number(value))', () => {
  const s = schema({ seed: { type: 'int', required: true } })
  const result = validateAditus(s, { seed: '7' })
  assert.deepEqual(result, { seed: 7 })
})

test('validateAditus: rounds int values', () => {
  const s = schema({ seed: { type: 'int', required: true } })
  const result = validateAditus(s, { seed: 3.7 })
  assert.deepEqual(result, { seed: 4 })
})

test('validateAditus: throws for int when value is NaN', () => {
  const s = schema({ seed: { type: 'int', required: true } })
  assert.throws(
    () => validateAditus(s, { seed: 'abc' }),
    { message: 'aditus: field "seed" must be an integer, got "abc"' }
  )
})

test('validateAditus: throws for int when value is empty string', () => {
  const s = schema({ seed: { type: 'int', required: true } })
  assert.throws(
    () => validateAditus(s, { seed: '' }),
    { message: 'aditus: field "seed" must be an integer, got ""' }
  )
})

test('validateAditus: throws for int when value is whitespace-only string', () => {
  const s = schema({ seed: { type: 'int', required: true } })
  assert.throws(
    () => validateAditus(s, { seed: '   ' }),
    { message: 'aditus: field "seed" must be an integer, got "   "' }
  )
})

test('validateAditus: throws for int when value is Infinity', () => {
  const s = schema({ seed: { type: 'int', required: true } })
  assert.throws(
    () => validateAditus(s, { seed: Infinity }),
    /must be an integer/
  )
})

// ---------------------------------------------------------------------------
// 6. Type coercion — 'float'
// ---------------------------------------------------------------------------

test('validateAditus: coerces float via Number(value)', () => {
  const s = schema({ strength: { type: 'float', required: true } })
  const result = validateAditus(s, { strength: '0.75' })
  assert.deepEqual(result, { strength: 0.75 })
})

test('validateAditus: throws for float when value is NaN', () => {
  const s = schema({ strength: { type: 'float', required: true } })
  assert.throws(
    () => validateAditus(s, { strength: 'bad' }),
    { message: 'aditus: field "strength" must be a float, got "bad"' }
  )
})

test('validateAditus: throws for float when value is empty string', () => {
  const s = schema({ strength: { type: 'float', required: true } })
  assert.throws(
    () => validateAditus(s, { strength: '' }),
    { message: 'aditus: field "strength" must be a float, got ""' }
  )
})

test('validateAditus: throws for float when value is whitespace-only string', () => {
  const s = schema({ strength: { type: 'float', required: true } })
  assert.throws(
    () => validateAditus(s, { strength: '   ' }),
    { message: 'aditus: field "strength" must be a float, got "   "' }
  )
})

// ---------------------------------------------------------------------------
// 7. Type coercion — media types (image | video | audio | document)
// ---------------------------------------------------------------------------

test('validateAditus: coerces image URL via String()', () => {
  const s = schema({ imageUrl: { type: 'image', required: true } })
  const result = validateAditus(s, { imageUrl: 'https://example.com/img.png' })
  assert.deepEqual(result, { imageUrl: 'https://example.com/img.png' })
})

test('validateAditus: throws for image when result is empty string', () => {
  const s = schema({ imageUrl: { type: 'image', required: true } })
  assert.throws(
    () => validateAditus(s, { imageUrl: '' }),
    { message: 'aditus: field "imageUrl" must be a non-empty URL string' }
  )
})

test('validateAditus: throws for video when result is empty string', () => {
  const s = schema({ videoUrl: { type: 'video', required: true } })
  assert.throws(
    () => validateAditus(s, { videoUrl: '' }),
    { message: 'aditus: field "videoUrl" must be a non-empty URL string' }
  )
})

test('validateAditus: throws for audio when result is empty string', () => {
  const s = schema({ audioUrl: { type: 'audio', required: true } })
  assert.throws(
    () => validateAditus(s, { audioUrl: '' }),
    { message: 'aditus: field "audioUrl" must be a non-empty URL string' }
  )
})

test('validateAditus: throws for document when result is empty string', () => {
  const s = schema({ doc: { type: 'document', required: true } })
  assert.throws(
    () => validateAditus(s, { doc: '' }),
    { message: 'aditus: field "doc" must be a non-empty URL string' }
  )
})

// ---------------------------------------------------------------------------
// 8. Unknown type — pass through as-is
// ---------------------------------------------------------------------------

test('validateAditus: passes through unknown types as-is', () => {
  const s = schema({ data: { type: 'json', required: true } })
  const obj = { nested: [1, 2, 3] }
  const result = validateAditus(s, { data: obj })
  assert.deepEqual(result, { data: obj })
})

// ---------------------------------------------------------------------------
// 9. Optional fields absent — omit entirely
// ---------------------------------------------------------------------------

test('validateAditus: omits optional absent fields with no default', () => {
  const s = schema({
    prompt: { type: 'text', required: true },
    seed: { type: 'int', required: false },
  })
  const result = validateAditus(s, { prompt: 'hello' })
  assert.deepEqual(result, { prompt: 'hello' })
  assert.equal('seed' in result, false)
})

// ---------------------------------------------------------------------------
// 10. messages array special case — pass through as-is for text fields
// ---------------------------------------------------------------------------

test('validateAditus: passes through messages array as-is for text fields', () => {
  const s = schema({ messages: { type: 'text', required: true } })
  const msgs = [
    { role: 'user', content: 'hello' },
    { role: 'assistant', content: 'hi there' },
  ]
  const result = validateAditus(s, { messages: msgs })
  assert.deepEqual(result, { messages: msgs })
})

test('validateAditus: still coerces non-array text values to string', () => {
  const s = schema({ messages: { type: 'text', required: true } })
  const result = validateAditus(s, { messages: 42 })
  assert.deepEqual(result, { messages: '42' })
})
