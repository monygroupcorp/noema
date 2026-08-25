import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { Forma } from '../../../src/types/modus.js'
import { validateAditus } from '../../../src/execution/validateAditus.js'
import {
  MODUS_AITOOLKIT_TRAINING,
  MODUS_DATASET_CAPTION,
  MODUS_DATASET_DECOMPOSE,
  MODUS_OPENROUTER_CHAT,
} from '../../../src/crystal/seeds/modi.js'

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

// ---------------------------------------------------------------------------
// 11. Against the real modus declarations — the semantics the entry route leans on
// ---------------------------------------------------------------------------
//
// `ExecuteFlow` calls `validateAditus(modus.aditus, …)` at each submit, so these two
// properties are what make a modus' declaration binding on an entering run. Driven by
// the real seed formae rather than a local fixture: the route's behaviour and the
// shipped declarations are asserted together. The route-level proof lives in
// `tests/unit/flow/ExecuteFlow.test.ts`.

test('validateAditus: an undeclared key is stripped, not refused (caption forma)', () => {
  const out = validateAditus(MODUS_DATASET_CAPTION.aditus, {
    dataset: 'dataset-alpha',
    captionSet: 'captionset-alpha',   // near-miss casing
  })
  assert.equal('captionSet' in out, false, 'undeclared key does not survive')
  assert.equal('captionset' in out, false, 'and is not re-homed onto the declared port')
  assert.equal(out.dataset, 'dataset-alpha')
})

test('validateAditus: the caption extend port survives when it is declared and supplied', () => {
  const out = validateAditus(MODUS_DATASET_CAPTION.aditus, {
    dataset: 'dataset-alpha',
    captionset: 'captionset-alpha',
  })
  assert.equal(out.captionset, 'captionset-alpha')
})

test('validateAditus: the decompose whole-set opt-in is carried in its parsed form', () => {
  const out = validateAditus(MODUS_DATASET_DECOMPOSE.aditus, {
    dataset: 'dataset-alpha',
    captionset: 'captionset-alpha',
    redo: true,
    rebuild: true,   // undeclared
  })
  assert.equal(out.redo, 'true', "declared 'text' → the string `isRedo` reads as on")
  assert.equal('rebuild' in out, false)
})

test('validateAditus: an absent optional port with no default is omitted, not defaulted', () => {
  // The "mint a fresh captionset" path: absent means absent, so a run never inherits
  // some other pass's set.
  const out = validateAditus(MODUS_DATASET_CAPTION.aditus, { dataset: 'dataset-alpha' })
  assert.deepEqual(Object.keys(out), ['dataset'])
})

// ---------------------------------------------------------------------------
// 'bool' — the type a default-on opt-out needs to survive validation
// ---------------------------------------------------------------------------

test("validateAditus: a 'bool' port carries a real boolean through unchanged", () => {
  const s = schema({ flag: { type: 'bool', required: false } })
  assert.equal(validateAditus(s, { flag: false }).flag, false)
  assert.equal(validateAditus(s, { flag: true }).flag, true)
})

test("validateAditus: a 'bool' port maps the form strings 'true'/'false' onto booleans", () => {
  const s = schema({ flag: { type: 'bool', required: false } })
  for (const raw of ['false', 'FALSE', ' false ']) {
    assert.equal(validateAditus(s, { flag: raw }).flag, false, `"${raw}" should read as off`)
  }
  for (const raw of ['true', 'TRUE', ' true ']) {
    assert.equal(validateAditus(s, { flag: raw }).flag, true, `"${raw}" should read as on`)
  }
})

test("validateAditus: a 'bool' port rejects a value it cannot read rather than guessing", () => {
  const s = schema({ flag: { type: 'bool', required: false } })
  assert.throws(() => validateAditus(s, { flag: 'maybe' }), /must be a boolean/)
  assert.throws(() => validateAditus(s, { flag: '' }), /must be a boolean/)
})

test("validateAditus: 'bool' is what keeps a `!== false` opt-out expressible, and 'text' is not", () => {
  // The reason the type exists, pinned as an inequality rather than a comment. A cursor reads a
  // default-on port as `value !== false`; coerced by the 'text' arm, `false` becomes the string
  // 'false', which is `!== false` and so reads as ON — the opt-out validates and is inverted.
  const asText = validateAditus(schema({ flag: { type: 'text' } }), { flag: false }).flag
  const asBool = validateAditus(schema({ flag: { type: 'bool' } }), { flag: false }).flag
  assert.equal(asText !== false, true, "'text' turns an opt-out into an opt-in")
  assert.equal(asBool !== false, false, "'bool' preserves the opt-out")
})

// ---------------------------------------------------------------------------
// The seeded ports this repairs, exercised through the real modi
// ---------------------------------------------------------------------------

test('validateAditus: the training caption opt-out survives as a boolean false', () => {
  const out = validateAditus(MODUS_AITOOLKIT_TRAINING.aditus, {
    dataset: 'corpus-alpha',
    triggerWord: 'trigword',
    baseModel: 'base-preset',
    steps: 100,
    autocaption: false,
  })
  // Exactly what `RemoteAitoolkitTrainingCursor` reads.
  assert.equal(out.autocaption, false)
  assert.equal(out.autocaption !== false, false, 'the opt-out must still read as off at the cursor')
})

test('validateAditus: an absent training caption opt-out leaves the port off the aditus (default on)', () => {
  const out = validateAditus(MODUS_AITOOLKIT_TRAINING.aditus, {
    dataset: 'corpus-alpha',
    triggerWord: 'trigword',
    baseModel: 'base-preset',
    steps: 100,
  })
  // Optional with no default → omitted, and `undefined !== false` is the default-on reading.
  assert.equal('autocaption' in out, false)
})

test('validateAditus: a chat modus carries its conversation history through as an array', () => {
  const messages = [
    { role: 'user', content: 'first' },
    { role: 'assistant', content: 'second' },
    { role: 'user', content: 'third' },
  ]
  const out = validateAditus(MODUS_OPENROUTER_CHAT.aditus, { prompt: 'third', messages })
  // `ApiCursor.runChat` gates on `Array.isArray`, so the Array must survive intact.
  assert.deepEqual(out.messages, messages)
  assert.equal(Array.isArray(out.messages), true)
})

test('validateAditus: the caption modus carries the run knobs its cursor reads', () => {
  const out = validateAditus(MODUS_DATASET_CAPTION.aditus, {
    dataset: 'dataset-alpha',
    gpuId: 1,
    jobId: 'job-alpha',
  })
  assert.equal(out.gpuId, '1')
  assert.equal(out.jobId, 'job-alpha')
})
