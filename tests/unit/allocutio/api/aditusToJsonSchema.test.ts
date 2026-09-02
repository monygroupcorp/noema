import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  aditusToJsonSchema,
  describeFlow,
} from '../../../../src/allocutio/api/aditusToJsonSchema.js'
import type { Forma } from '../../../../src/types/modus.js'

test('aditusToJsonSchema maps types, required, default, and uri format', () => {
  const aditus: Forma = {
    prompt: { type: 'text', required: true, description: 'the prompt', label: 'Prompt' },
    steps: { type: 'int', default: 20 },
    guidance: { type: 'float' },
    init: { type: 'image' },
  }

  const schema = aditusToJsonSchema(aditus)

  assert.equal(schema.type, 'object')

  // types
  assert.equal(schema.properties.prompt.type, 'string')
  assert.equal(schema.properties.steps.type, 'integer')
  assert.equal(schema.properties.guidance.type, 'number')
  assert.equal(schema.properties.init.type, 'string')

  // uri format on image
  assert.equal(schema.properties.init.format, 'uri')

  // required only collects required keys
  assert.deepEqual(schema.required, ['prompt'])

  // default surfaced
  assert.equal(schema.properties.steps.default, 20)

  // description / label → description / title
  assert.equal(schema.properties.prompt.description, 'the prompt')
  assert.equal(schema.properties.prompt.title, 'Prompt')

  // no default key when undefined
  assert.equal('default' in schema.properties.guidance, false)
})

test('aditusToJsonSchema carries optiones through unmodified when present', () => {
  const schema = aditusToJsonSchema({
    model: {
      type: 'text',
      default: 'a',
      optiones: [{ value: 'a', label: 'A' }, { value: 'b', label: 'B' }],
    },
    plain: { type: 'text' },
  })
  assert.deepEqual(schema.properties.model.optiones, [{ value: 'a', label: 'A' }, { value: 'b', label: 'B' }])
  assert.equal('optiones' in schema.properties.plain, false)
})

test('aditusToJsonSchema omits required array when nothing is required', () => {
  const schema = aditusToJsonSchema({ x: { type: 'float' } })
  assert.equal('required' in schema, false)
})

test('aditusToJsonSchema hides internal __-prefixed routing keys from the public surface', () => {
  const schema = aditusToJsonSchema({
    prompt: { type: 'text', required: true },
    __capability: { type: 'text', required: false, default: 'chat' },
  })
  assert.equal('__capability' in schema.properties, false)
  assert.equal('prompt' in schema.properties, true)
  // A hidden key must never leak into `required` either.
  assert.deepEqual(schema.required, ['prompt'])
})

test('describeFlow projects input/output and passes through meta', () => {
  const modus = {
    id: 'flow-1',
    nomen: 'Test Flow',
    versio: '1.0.0',
    aditus: {
      prompt: { type: 'text', required: true },
    } as Forma,
    exitus: {
      image: { type: 'image' },
    } as Forma,
    categoria: 'image-gen',
    fundamentumId: 'fund-9',
    secret: 'should-not-surface',
  }

  const desc = describeFlow(modus)

  assert.equal(desc.id, 'flow-1')
  assert.equal(desc.nomen, 'Test Flow')
  assert.equal(desc.versio, '1.0.0')

  assert.equal(desc.input.type, 'object')
  assert.deepEqual(desc.input.required, ['prompt'])

  assert.ok(desc.output)
  assert.equal(desc.output?.properties.image.format, 'uri')

  // passthrough meta
  assert.equal(desc.categoria, 'image-gen')
  assert.equal(desc.fundamentumId, 'fund-9')

  // non-allowlisted keys do not leak
  assert.equal('secret' in desc, false)
})

test('describeFlow omits output when exitus is absent', () => {
  const modus = {
    id: 'flow-2',
    nomen: 'No Output',
    versio: '2.0.0',
    aditus: { x: { type: 'int' } } as Forma,
  }
  const desc = describeFlow(modus)
  assert.equal(desc.output, undefined)
})

// ── noema-396: a declared numeric constraint is PUBLISHED, not just enforced ──
//
// The point of declaring the rule is that a caller reads it before spending ~28 minutes of pod
// time discovering it, so `GET /v1/flows/:id` has to carry it. `minimum`/`maximum` are exact
// standard keywords; `step` is the offset case draft-2020-12 cannot express, and the rendered
// sentence in `description` is for the callers (agents especially) that read prose.

test('a declared constraint reaches the published schema as keywords AND as prose', () => {
  const schema = aditusToJsonSchema({
    frames: { type: 'int', default: 209, min: 5, step: 17, description: 'Clip length in frames.' },
  })
  const frames = schema.properties.frames
  assert.equal(frames.minimum, 5)
  assert.equal(frames.step, 17)
  assert.equal(frames.default, 209)
  assert.equal(frames.description, 'Clip length in frames. Must be 5 or more, in steps of 17 from 5 (5, 22, 39, …).')
})

test('multipleOf is emitted only when the step really is a multiple rule', () => {
  // H3's is not: legal lengths are 17k+5, not 17k. Emitting `multipleOf: 17` would make a
  // standards-compliant client reject every legal clip length — worse than emitting nothing.
  const offset = aditusToJsonSchema({ frames: { type: 'int', min: 5, step: 17 } })
  assert.equal('multipleOf' in offset.properties.frames, false)

  // A step from a min that IS a multiple of it, and a step with no min at all, both are.
  assert.equal(aditusToJsonSchema({ n: { type: 'int', min: 8, step: 4 } }).properties.n.multipleOf, 4)
  assert.equal(aditusToJsonSchema({ n: { type: 'int', step: 4 } }).properties.n.multipleOf, 4)
})

test('a bounded port publishes both bounds', () => {
  const n = aditusToJsonSchema({ n: { type: 'float', min: 0, max: 1 } }).properties.n
  assert.equal(n.minimum, 0)
  assert.equal(n.maximum, 1)
  assert.equal(n.description, 'Must be between 0 and 1.')
})

test('an unconstrained port publishes exactly what it always did', () => {
  const schema = aditusToJsonSchema({
    prompt: { type: 'text', required: true, description: 'the prompt', label: 'Prompt' },
    steps: { type: 'int', default: 20 },
  })
  assert.deepEqual(schema.properties.prompt, { type: 'string', description: 'the prompt', title: 'Prompt' })
  assert.deepEqual(schema.properties.steps, { type: 'integer', default: 20 })
})
