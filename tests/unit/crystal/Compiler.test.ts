import { test } from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { Compiler, CompilerError } from '../../../src/crystal/Compiler.js'
import { WorkflowTemplateRegistry } from '../../../src/crystal/WorkflowTemplateRegistry.js'
import type { Essentia } from '../../../src/types/essendi.js'
import type { Intellarum, Intella } from '../../../src/types/intelligendi.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const REAL_WORKFLOWS = path.join(__dirname, '../../../src/crystal/workflows')

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeEssentia(overrides: Partial<Essentia> = {}): Essentia {
  return {
    id: 'runmake.flux-schnell',
    nomen: 'FLUX Schnell',
    genus: 'atomicus',
    versio: '1.0.0',
    contentHash: 'abc',
    ministerium: 'runpod',
    canonica: true,
    categoria: 'image',
    aditus: { prompt: { type: 'text', required: true } },
    exitus: { image: { type: 'image' } },
    natum: new Date(),
    mutatum: new Date(),
    runpodSpec: {
      imageId: 'runpod/pytorch',
      imageVersion: '2.4.0-py3.11-cuda12.4.1-devel-ubuntu22.04',
      workflowTemplate: 'flux-schnell',
      workflowTemplateVersion: '1',
      seedInputKey: 'input_seed',
      defaultCookFlags: {
        batchSize: 1,
        seedStrategy: 'shuffle',
        seedPlaceholder: 88888888,
        privateMode: false,
        vramGb: 24,
      },
    },
    ...overrides,
  }
}

function makeCompiler(fixedSeed?: number) {
  const registry = new WorkflowTemplateRegistry(REAL_WORKFLOWS)
  return new Compiler(registry, fixedSeed !== undefined ? () => fixedSeed : undefined)
}

// ── compile() — slot substitution ────────────────────────────────────────────

test('compile() embeds prompt into CLIPTextEncodeFlux nodes via slotMap', async () => {
  const compiler = makeCompiler(42)
  const { spec } = await compiler.compile(makeEssentia(), { prompt: 'a glowing cat' })
  const node22 = spec.workflow.inputTemplate['22'] as { inputs: Record<string, unknown> }
  assert.equal(node22.inputs.clip_l, 'a glowing cat')
  assert.equal(node22.inputs.t5xxl, 'a glowing cat')
})

test('compile() embeds width and height into EmptyLatentImage', async () => {
  const compiler = makeCompiler(42)
  const { spec } = await compiler.compile(makeEssentia(), { prompt: 'test', width: 768, height: 512 })
  const node6 = spec.workflow.inputTemplate['6'] as { inputs: Record<string, unknown> }
  assert.equal(node6.inputs.width, 768)
  assert.equal(node6.inputs.height, 512)
})

test('compile() embeds steps into KSampler', async () => {
  const compiler = makeCompiler(42)
  const { spec } = await compiler.compile(makeEssentia(), { prompt: 'test', steps: 8 })
  const node13 = spec.workflow.inputTemplate['13'] as { inputs: Record<string, unknown> }
  assert.equal(node13.inputs.steps, 8)
})

test('compile() leaves unset optional slots at template defaults', async () => {
  const compiler = makeCompiler(99)
  const { spec } = await compiler.compile(makeEssentia(), { prompt: 'test' })
  const node6 = spec.workflow.inputTemplate['6'] as { inputs: Record<string, unknown> }
  assert.equal(node6.inputs.width, 512)
  assert.equal(node6.inputs.height, 512)
})

// ── compile() — seed resolution ───────────────────────────────────────────────

test('compile() uses explicit input_seed when provided', async () => {
  const compiler = makeCompiler()
  const { spec } = await compiler.compile(makeEssentia(), { prompt: 'test', input_seed: 12345 })
  assert.equal(spec.seed, 12345)
  const node13 = spec.workflow.inputTemplate['13'] as { inputs: Record<string, unknown> }
  assert.equal(node13.inputs.seed, 12345)
})

test('compile() generates random seed when input_seed absent (shuffle strategy)', async () => {
  const compiler = new Compiler(new WorkflowTemplateRegistry(REAL_WORKFLOWS))
  const { spec } = await compiler.compile(makeEssentia(), { prompt: 'test' })
  assert.equal(typeof spec.seed, 'number')
  assert.ok(spec.seed >= 0)
})

test('compile() uses fixed seedPlaceholder when strategy is fixed', async () => {
  const essentia = makeEssentia({
    runpodSpec: {
      ...makeEssentia().runpodSpec!,
      defaultCookFlags: { seedStrategy: 'fixed', seedPlaceholder: 77777777 },
    },
  })
  const compiler = makeCompiler()
  const { spec } = await compiler.compile(essentia, { prompt: 'test' })
  assert.equal(spec.seed, 77777777)
})

test('compile() seed 0 is treated as explicit (not auto-shuffled)', async () => {
  const compiler = makeCompiler(999)
  const { spec } = await compiler.compile(makeEssentia(), { prompt: 'test', input_seed: 0 })
  assert.equal(spec.seed, 0)
})

// ── compile() — output shape ──────────────────────────────────────────────────

test('compile() returns a hash string starting with sha256:', async () => {
  const compiler = makeCompiler(1)
  const { hash } = await compiler.compile(makeEssentia(), { prompt: 'test' })
  assert.ok(typeof hash === 'string' && hash.startsWith('sha256:'), `hash was: ${hash}`)
})

test('compile() includes image ociRef in spec', async () => {
  const compiler = makeCompiler(1)
  const { spec } = await compiler.compile(makeEssentia(), { prompt: 'test' })
  assert.equal(spec.image.ociRef, 'runpod/pytorch:2.4.0-py3.11-cuda12.4.1-devel-ubuntu22.04')
})

test('compile() includes requiredModels from template', async () => {
  const compiler = makeCompiler(1)
  const { spec } = await compiler.compile(makeEssentia(), { prompt: 'test' })
  assert.ok(Array.isArray(spec.models))
  assert.ok(spec.models.length > 0)
  assert.ok(spec.models.some(m => m.role === 'unet'))
})

test('compile() does not mutate input aditus', async () => {
  const compiler = makeCompiler(42)
  const aditus = { prompt: 'test', width: 512 }
  const before = JSON.stringify(aditus)
  await compiler.compile(makeEssentia(), aditus)
  assert.equal(JSON.stringify(aditus), before)
})

test('compile() produces deterministic hash for same inputs', async () => {
  const compiler = makeCompiler(42)
  const { hash: h1 } = await compiler.compile(makeEssentia(), { prompt: 'hello', input_seed: 42 })
  const { hash: h2 } = await compiler.compile(makeEssentia(), { prompt: 'hello', input_seed: 42 })
  assert.equal(h1, h2)
})

test('compile() produces different hash when prompt differs', async () => {
  const compiler = makeCompiler(42)
  const { hash: h1 } = await compiler.compile(makeEssentia(), { prompt: 'cat', input_seed: 42 })
  const { hash: h2 } = await compiler.compile(makeEssentia(), { prompt: 'dog', input_seed: 42 })
  assert.notEqual(h1, h2)
})

// ── compile() — error paths ───────────────────────────────────────────────────

test('compile() throws when runpodSpec absent on essentia', async () => {
  const compiler = makeCompiler(1)
  const essentia = makeEssentia({ runpodSpec: undefined })
  await assert.rejects(
    () => compiler.compile(essentia, { prompt: 'test' }),
    /runpodSpec/i
  )
})

test('compile() throws CompilerError when template not found', async () => {
  const compiler = makeCompiler(1)
  const essentia = makeEssentia({
    runpodSpec: { ...makeEssentia().runpodSpec!, workflowTemplate: 'nonexistent' },
  })
  await assert.rejects(
    () => compiler.compile(essentia, { prompt: 'test' }),
    (err: unknown) => err instanceof CompilerError && err.code === 'TEMPLATE_NOT_FOUND'
  )
})

// ── compile() — Intellarum model registry ────────────────────────────────────

function makeIntellarum(records: Record<string, Partial<Intella>>): Intellarum {
  return {
    async find(id: string) {
      const rec = records[id]
      if (!rec) return null
      return {
        id,
        nomen: rec.nomen ?? id,
        genus: rec.genus ?? 'model',
        architectura: rec.architectura ?? 'unet',
        parametri: rec.parametri ?? 0,
        sources: rec.sources ?? [{ provenance: 'miladystation', uri: `https://registry.example.com/${id}.safetensors` }],
        dest: rec.dest ?? `models/${id}.safetensors`,
        sizeGb: rec.sizeGb ?? 1,
        versio: rec.versio ?? '1.0.0',
        canonica: rec.canonica ?? true,
        natum: new Date(),
      }
    },
    async list() { return [] },
    async canonical() { return [] },
    async findByTrigger() { return [] },
  }
}

test('compile() resolves model URL from Intellarum registry when set', async () => {
  const registryUrl = 'https://registry.example.com/unet/flux1-schnell.safetensors'
  const intellarum = makeIntellarum({
    'intella.flux-schnell': {
      sources: [{ provenance: 'miladystation', uri: registryUrl }],
      dest: 'unet/flux1-schnell.safetensors',
    },
  })
  const compiler = new Compiler(new WorkflowTemplateRegistry(REAL_WORKFLOWS), () => 42, intellarum)
  const { spec } = await compiler.compile(makeEssentia(), { prompt: 'test' })
  const unet = spec.models.find(m => m.id === 'intella.flux-schnell')
  assert.equal(unet?.url, registryUrl)
})

test('compile() falls back to template URL when Intellarum returns null for model', async () => {
  const intellarum = makeIntellarum({})
  const compiler = new Compiler(new WorkflowTemplateRegistry(REAL_WORKFLOWS), () => 42, intellarum)
  const { spec } = await compiler.compile(makeEssentia(), { prompt: 'test' })
  const unet = spec.models.find(m => m.id === 'intella.flux-schnell')
  assert.ok(unet?.url?.includes('miladystation2.net'), `expected template URL fallback, got: ${unet?.url}`)
})

test('compile() uses dest from Intellarum record when registry resolves model', async () => {
  const intellarum = makeIntellarum({
    'intella.flux-schnell': {
      sources: [{ provenance: 'huggingface', uri: 'https://huggingface.co/flux1-schnell.safetensors' }],
      dest: 'unet/flux1-schnell.safetensors',
    },
  })
  const compiler = new Compiler(new WorkflowTemplateRegistry(REAL_WORKFLOWS), () => 42, intellarum)
  const { spec } = await compiler.compile(makeEssentia(), { prompt: 'test' })
  const unet = spec.models.find(m => m.id === 'intella.flux-schnell')
  assert.equal(unet?.dest, 'unet/flux1-schnell.safetensors')
})

test('compile() throws MODEL_NOT_RESOLVED when Intellarum set, model missing, and template has no url', async () => {
  const intellarum = makeIntellarum({})
  const registry = new WorkflowTemplateRegistry(REAL_WORKFLOWS)
  const compiler = new Compiler(registry, () => 42, intellarum)
  const essentiaNoUrl = makeEssentia({
    runpodSpec: {
      ...makeEssentia().runpodSpec!,
      workflowTemplate: 'flux-schnell-no-url',
      workflowTemplateVersion: '1',
    },
  })
  await assert.rejects(
    () => compiler.compile(essentiaNoUrl, { prompt: 'test' }),
    (err: unknown) => err instanceof CompilerError && err.code === 'MODEL_NOT_RESOLVED'
  )
})
