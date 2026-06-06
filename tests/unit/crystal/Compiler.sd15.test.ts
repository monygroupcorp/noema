import { test } from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { Compiler } from '../../../src/crystal/Compiler.js'
import { WorkflowTemplateRegistry } from '../../../src/crystal/WorkflowTemplateRegistry.js'
import { ESSENTIA_RUNMAKE_SD15 } from '../../../src/crystal/seeds/essentiae.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const REAL_WORKFLOWS = path.join(__dirname, '../../../src/crystal/workflows')

function makeCompiler(fixedSeed = 42) {
  const registry = new WorkflowTemplateRegistry(REAL_WORKFLOWS)
  return new Compiler(registry, () => fixedSeed)
}

test('compile(ESSENTIA_RUNMAKE_SD15) slots the prompt into the positive CLIPTextEncode node', async () => {
  const compiler = makeCompiler()
  const { spec } = await compiler.compile(ESSENTIA_RUNMAKE_SD15, { prompt: 'a cat' })
  const positive = spec.workflow.inputTemplate['6'] as { class_type: string; inputs: Record<string, unknown> }
  assert.equal(positive.class_type, 'CLIPTextEncode')
  assert.equal(positive.inputs.text, 'a cat')
})

test('compile(ESSENTIA_RUNMAKE_SD15) includes the SD1.5 checkpoint in spec.models', async () => {
  const compiler = makeCompiler()
  const { spec } = await compiler.compile(ESSENTIA_RUNMAKE_SD15, { prompt: 'a cat' })
  const checkpoint = spec.models.find(m => m.role === 'checkpoint')
  assert.ok(checkpoint, 'expected a checkpoint model in spec.models')
  assert.equal(checkpoint!.id, 'intella.sd15-v1-5')
  assert.equal(checkpoint!.dest, 'checkpoints/v1-5-pruned-emaonly.safetensors')
})
