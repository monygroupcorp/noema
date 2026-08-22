import { test } from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { Compiler } from '../../../src/crystal/Compiler.js'
import { WorkflowTemplateRegistry } from '../../../src/crystal/WorkflowTemplateRegistry.js'
import { ESSENTIA_WAN22_T2V, ESSENTIA_WAN22_I2V } from '../../../src/crystal/seeds/essentiae.js'
import { CANONICAL_FUNDAMENTA } from '../../../src/crystal/seeds/fundamenta.js'
import { MemoryFundamentorum } from '../../../src/crystal/MemoryFundamentorum.js'
import type { Intellarum, Intella } from '../../../src/types/intelligendi.js'
import { asComfyUI } from './Compiler.helpers.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const REAL_WORKFLOWS = path.join(__dirname, '../../../src/crystal/workflows')

const FUNDS = new MemoryFundamentorum(CANONICAL_FUNDAMENTA)

/** DB-free Intellarum resolving the six Wan2.2 weights the two fundaments declare. */
function makeWanIntellarum(): Intellarum {
  const records: Record<string, Intella> = {
    'intella.wan22-t2v-high': mkModel('intella.wan22-t2v-high', 'unet/wan2.2_t2v_high_noise_14B_fp8_scaled.safetensors'),
    'intella.wan22-t2v-low':  mkModel('intella.wan22-t2v-low', 'unet/wan2.2_t2v_low_noise_14B_fp8_scaled.safetensors'),
    'intella.wan22-i2v-high': mkModel('intella.wan22-i2v-high', 'unet/wan2.2_i2v_high_noise_14B_fp8_scaled.safetensors'),
    'intella.wan22-i2v-low':  mkModel('intella.wan22-i2v-low', 'unet/wan2.2_i2v_low_noise_14B_fp8_scaled.safetensors'),
    'intella.umt5-xxl':       mkModel('intella.umt5-xxl', 'clip/umt5_xxl_fp8_e4m3fn_scaled.safetensors'),
    'intella.wan21-vae':      mkModel('intella.wan21-vae', 'vae/wan_2.1_vae.safetensors'),
  }
  return {
    async find(id: string) { return records[id] ?? null },
    async list() { return Object.values(records) },
    async canonical() { return Object.values(records) },
    async findByTrigger() { return [] },
    async triggerMap() { return new Map() },
  }
}

function mkModel(id: string, dest: string): Intella {
  return {
    id, nomen: id, genus: 'model', architectura: 'dit', parametri: 0,
    sources: [{ provenance: 'huggingface', uri: `https://example.com/${id}.safetensors` }],
    dest, sizeGb: 1, versio: '1.0.0', canonica: true, natum: new Date(),
  } as Intella
}

function makeCompiler() {
  return new Compiler(new WorkflowTemplateRegistry(REAL_WORKFLOWS), () => 42, makeWanIntellarum(), FUNDS)
}

test('compile(ESSENTIA_WAN22_T2V) slots the prompt and returns the t2v MoE weight pair + shared encoder/vae', async () => {
  const compiler = makeCompiler()
  const { spec } = await compiler.compile(ESSENTIA_WAN22_T2V, { prompt: 'a cat surfing' })

  const positive = asComfyUI(spec).workflow.inputTemplate['6'] as { class_type: string; inputs: Record<string, unknown> }
  assert.equal(positive.class_type, 'CLIPTextEncode')
  assert.equal(positive.inputs.text, 'a cat surfing')

  const modelIds = spec.models.map(m => m.id).sort()
  assert.deepEqual(modelIds, [
    'intella.umt5-xxl',
    'intella.wan21-vae',
    'intella.wan22-t2v-high',
    'intella.wan22-t2v-low',
  ].sort())
})

test('compile(ESSENTIA_WAN22_I2V) slots the prompt + image and returns the i2v MoE weight pair + shared encoder/vae', async () => {
  const compiler = makeCompiler()
  const { spec } = await compiler.compile(ESSENTIA_WAN22_I2V, { prompt: 'a cat surfing', image: 'https://r2.example/start.png' })

  const positive = asComfyUI(spec).workflow.inputTemplate['6'] as { class_type: string; inputs: Record<string, unknown> }
  assert.equal(positive.class_type, 'CLIPTextEncode')
  assert.equal(positive.inputs.text, 'a cat surfing')

  assert.ok(asComfyUI(spec).mediaInputs, 'spec carries mediaInputs for the start-frame image')
  const loadImage = asComfyUI(spec).workflow.inputTemplate['62'] as { class_type: string; inputs: Record<string, unknown> }
  assert.equal(loadImage.class_type, 'LoadImage')
  assert.equal(loadImage.inputs.image, asComfyUI(spec).mediaInputs![0].destFilename)

  const modelIds = spec.models.map(m => m.id).sort()
  assert.deepEqual(modelIds, [
    'intella.umt5-xxl',
    'intella.wan21-vae',
    'intella.wan22-i2v-high',
    'intella.wan22-i2v-low',
  ].sort())
})
