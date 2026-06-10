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

test('aditusToJsonSchema omits required array when nothing is required', () => {
  const schema = aditusToJsonSchema({ x: { type: 'float' } })
  assert.equal('required' in schema, false)
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
