import { test } from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { Compiler } from '../../../src/crystal/Compiler.js'
import { WorkflowTemplateRegistry } from '../../../src/crystal/WorkflowTemplateRegistry.js'
import { ESSENTIA_LTX_T2V, ESSENTIA_LTX_I2V } from '../../../src/crystal/seeds/essentiae.js'
import { CANONICAL_FUNDAMENTA } from '../../../src/crystal/seeds/fundamenta.js'
import { MemoryFundamentorum } from '../../../src/crystal/MemoryFundamentorum.js'
import { asComfyUI } from './Compiler.helpers.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const REAL_WORKFLOWS = path.join(__dirname, '../../../src/crystal/workflows')

// The substrate registry the Compiler resolves a flow's referenced Fundamentum from —
// the LTX checkpoint + Gemma text encoder live on FUNDAMENTUM_LTX_COMFYUI (ADR-0005).
const FUNDS = new MemoryFundamentorum(CANONICAL_FUNDAMENTA)

function makeCompiler(fixedSeed = 42) {
  const registry = new WorkflowTemplateRegistry(REAL_WORKFLOWS)
  return new Compiler(registry, () => fixedSeed, undefined, FUNDS)
}

test('compile(ESSENTIA_LTX_T2V) slots the prompt into the positive CLIPTextEncode', async () => {
  const compiler = makeCompiler()
  const { spec } = await compiler.compile(ESSENTIA_LTX_T2V, { prompt: 'a slow pan over a misty forest' })
  const positive = asComfyUI(spec).workflow.inputTemplate['3'] as { class_type: string; inputs: Record<string, unknown> }
  assert.equal(positive.class_type, 'CLIPTextEncode')
  assert.equal(positive.inputs.text, 'a slow pan over a misty forest')
})

test('compile(ESSENTIA_LTX_T2V) includes the LTX checkpoint + Gemma text encoder in spec.models', async () => {
  const compiler = makeCompiler()
  const { spec } = await compiler.compile(ESSENTIA_LTX_T2V, { prompt: 'a cat' })
  const checkpoint = spec.models.find(m => m.role === 'checkpoint')
  const textEncoder = spec.models.find(m => m.role === 'text_encoder')
  assert.ok(checkpoint, 'expected the LTX checkpoint in spec.models')
  assert.equal(checkpoint!.id, 'intella.ltx-2.3-distilled')
  assert.equal(checkpoint!.dest, 'checkpoints/ltx-2.3-22b-distilled.safetensors')
  assert.ok(textEncoder, 'expected the Gemma-3-12B text encoder in spec.models')
  assert.equal(textEncoder!.id, 'intella.gemma-3-12b')
  assert.equal(textEncoder!.dest, 'text_encoders/gemma_3_12B_it.safetensors')
})

test('compile(ESSENTIA_LTX_T2V) forwards the ComfyUI-LTXVideo customNodes pack', async () => {
  const compiler = makeCompiler()
  const { spec } = await compiler.compile(ESSENTIA_LTX_T2V, { prompt: 'a cat' })
  assert.ok(Array.isArray(asComfyUI(spec).customNodes), 'customNodes is carried onto the spec')
  assert.equal(asComfyUI(spec).customNodes!.length, 1)
  assert.equal(asComfyUI(spec).customNodes![0].url, 'https://github.com/Lightricks/ComfyUI-LTXVideo')
  assert.equal(asComfyUI(spec).customNodes![0].name, 'ComfyUI-LTXVideo')
})

test('compile(ESSENTIA_LTX_I2V) slots the prompt + image and carries the LTX weights/customNodes', async () => {
  const compiler = makeCompiler()
  const { spec } = await compiler.compile(ESSENTIA_LTX_I2V, {
    prompt: 'the figure turns to face the camera',
    image: 'https://r2.example/source.png?sig=abc',
  })

  const positive = asComfyUI(spec).workflow.inputTemplate['3'] as { class_type: string; inputs: Record<string, unknown> }
  assert.equal(positive.class_type, 'CLIPTextEncode')
  assert.equal(positive.inputs.text, 'the figure turns to face the camera')

  // The image aditus rides the media-input primitive: LoadImage's slot carries the
  // destFilename (not the URL) — same pattern as Compiler.mediaInputs.test.ts.
  assert.ok(asComfyUI(spec).mediaInputs, 'spec carries mediaInputs for the source image')
  assert.equal(asComfyUI(spec).mediaInputs!.length, 1)
  const loadImage = asComfyUI(spec).workflow.inputTemplate['15'] as { class_type: string; inputs: Record<string, unknown> }
  assert.equal(loadImage.class_type, 'LoadImage')
  assert.equal(loadImage.inputs.image, asComfyUI(spec).mediaInputs![0].destFilename)

  const checkpoint = spec.models.find(m => m.role === 'checkpoint')
  assert.equal(checkpoint!.id, 'intella.ltx-2.3-distilled')
  assert.equal(asComfyUI(spec).customNodes![0].url, 'https://github.com/Lightricks/ComfyUI-LTXVideo')
})
