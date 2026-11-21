import { test } from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { Compiler } from '../../../src/crystal/Compiler.js'
import { WorkflowTemplateRegistry } from '../../../src/crystal/WorkflowTemplateRegistry.js'
import { ESSENTIA_MOSS_IMAGE, ESSENTIA_MOSS_IMAGE_EDIT } from '../../../src/crystal/seeds/essentiae.js'
import { CANONICAL_FUNDAMENTA } from '../../../src/crystal/seeds/fundamenta.js'
import { CANONICAL_INTELLAE } from '../../../src/crystal/seeds/intellae.js'
import { MemoryFundamentorum } from '../../../src/crystal/MemoryFundamentorum.js'
import type { Intellarum, Intella } from '../../../src/types/intelligendi.js'
import { asComfyUI } from './Compiler.helpers.js'

// Hermetic acceptance for the MOSS-Image pair ('moss-image' / 'moss-image-edit'): compiles the
// REAL seeds against the REAL templates — no live GPU, no CANONICAL_ESSENTIAE/FUNDAMENTA drift.

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const REAL_WORKFLOWS = path.join(__dirname, '../../../src/crystal/workflows')
const FUNDS = new MemoryFundamentorum(CANONICAL_FUNDAMENTA)

function makeIntellarum(): Intellarum {
  const byId = new Map<string, Intella>(CANONICAL_INTELLAE.map(i => [i.id, i]))
  return {
    async find(id: string) { return byId.get(id) ?? null },
    async list() { return CANONICAL_INTELLAE },
    async canonical() { return CANONICAL_INTELLAE },
    async findByTrigger() { return [] },
    async triggerMap() { return new Map() },
  }
}

function makeCompiler() {
  return new Compiler(new WorkflowTemplateRegistry(REAL_WORKFLOWS), () => 42, makeIntellarum(), FUNDS)
}

function node(spec: unknown, id: string) {
  return asComfyUI(spec as never).workflow.inputTemplate[id] as { class_type: string; inputs: Record<string, unknown> }
}

test('compile(moss-image) resolves the shared stack and slots prompt/negative/guidance', async () => {
  const { spec } = await makeCompiler().compile(ESSENTIA_MOSS_IMAGE, { prompt: 'a fox', guidance: 3, steps: 30 })
  assert.deepEqual(spec.models.map(m => m.id).sort(), [
    'intella.moss-image-sft',
    'intella.moss-image-vae',
    'intella.qwen3-9b-moss-image',
  ].sort())
  assert.equal(node(spec, '4').inputs.text, 'a fox')
  assert.equal(node(spec, '5').inputs.text, 'nsfw, worst quality, bad anatomy, watermark, jpeg artifact')
  assert.equal(node(spec, '7').inputs.cfg, 3)
  assert.equal(node(spec, '7').inputs.steps, 30)
})

test('compile(moss-image-edit) resolves the base stack PLUS the edit LoRA, and wires the reference image', async () => {
  const { spec } = await makeCompiler().compile(ESSENTIA_MOSS_IMAGE_EDIT, {
    prompt: 'make the sky purple', image: 'https://r2.example/cat.png',
  })
  assert.deepEqual(spec.models.map(m => m.id).sort(), [
    'intella.moss-image-edit-lora',
    'intella.moss-image-sft',
    'intella.moss-image-vae',
    'intella.qwen3-9b-moss-image',
  ].sort())

  const lora = node(spec, '10')
  assert.equal(lora.class_type, 'LoraLoaderModelOnly')
  assert.deepEqual(lora.inputs.model, ['1', 0], 'the edit LoRA rides the base unet')

  const positive = node(spec, '12')
  assert.equal(positive.class_type, 'TextEncodeMOSSImageEdit')
  assert.equal(positive.inputs.prompt, 'make the sky purple')
  assert.equal(positive.inputs.edit_format, 'Moss-Image-Edit')

  const sampler = node(spec, '7')
  assert.deepEqual(sampler.inputs.model, ['10', 0], 'the sampler consumes the LoRA-patched model, not the raw unet')

  // The output latent is sized from the reference image (GetImageSize), not a fixed 1024x1024.
  const latent = node(spec, '6')
  assert.deepEqual(latent.inputs.width, ['99', 0])
  assert.deepEqual(latent.inputs.height, ['99', 1])

  const media = asComfyUI(spec).mediaInputs
  assert.ok(media && media.length === 1, 'the reference image is staged as a media input')
  assert.equal(node(spec, '76').inputs.image, media![0].destFilename)
})
