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

test('compile() uses increment strategy: baseSeed + pieceIndex', async () => {
  const essentia = makeEssentia({
    runpodSpec: {
      ...makeEssentia().runpodSpec!,
      defaultCookFlags: { seedStrategy: 'increment' },
    },
  })
  const compiler = makeCompiler()
  const { spec } = await compiler.compile(essentia, {
    prompt: 'test',
    _cookFlags: { baseSeed: 1000, pieceIndex: 7 },
  })
  assert.equal(spec.seed, 1007)
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
    async triggerMap() { return new Map() },
  }
}

test('compile() resolves model URL from Intellarum registry when set', async () => {
  const registryUrl = 'https://registry.example.com/unet/flux1-schnell.safetensors'
  const intellarum = makeIntellarum({
    'intella.flux-schnell-fp8-scaled': {
      sources: [{ provenance: 'miladystation', uri: registryUrl }],
      dest: 'unet/flux1-schnell.safetensors',
    },
  })
  const compiler = new Compiler(new WorkflowTemplateRegistry(REAL_WORKFLOWS), () => 42, intellarum)
  const { spec } = await compiler.compile(makeEssentia(), { prompt: 'test' })
  const unet = spec.models.find(m => m.id === 'intella.flux-schnell-fp8-scaled')
  assert.equal(unet?.url, registryUrl)
})

test('compile() falls back to template URL when Intellarum returns null for model', async () => {
  const intellarum = makeIntellarum({})
  const compiler = new Compiler(new WorkflowTemplateRegistry(REAL_WORKFLOWS), () => 42, intellarum)
  const { spec } = await compiler.compile(makeEssentia(), { prompt: 'test' })
  const unet = spec.models.find(m => m.id === 'intella.flux-schnell-fp8-scaled')
  assert.ok(unet?.url?.includes('miladystation2.net'), `expected template URL fallback, got: ${unet?.url}`)
})

test('compile() uses dest from Intellarum record when registry resolves model', async () => {
  const intellarum = makeIntellarum({
    'intella.flux-schnell-fp8-scaled': {
      sources: [{ provenance: 'huggingface', uri: 'https://huggingface.co/flux1-schnell.safetensors' }],
      dest: 'unet/flux1-schnell.safetensors',
    },
  })
  const compiler = new Compiler(new WorkflowTemplateRegistry(REAL_WORKFLOWS), () => 42, intellarum)
  const { spec } = await compiler.compile(makeEssentia(), { prompt: 'test' })
  const unet = spec.models.find(m => m.id === 'intella.flux-schnell-fp8-scaled')
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

// ── compile() — LoRA trigger resolution on loraCapable templates ─────────────

/** Build an Intellarum that returns a trigger map for a fixed set of LoRAs. */
function makeLoraIntellarum(loras: Array<Partial<{ id: string; slug: string; trigger: string; defaultWeight: number; access: 'public' | 'private'; ownerAnimaId: string }>>) {
  type Intella = import('../../../src/types/intelligendi.js').Intella
  type Intellae = import('../../../src/types/intelligendi.js').Intellae
  const records = loras.map(l => ({
    id: l.id ?? `intella.${l.slug ?? l.trigger}`,
    nomen: l.slug ?? 'lora',
    genus: 'lora' as const,
    architectura: 'lora' as const,
    parametri: 0,
    sources: [{ provenance: 'miladystation' as const, uri: `https://example.com/${l.slug}.safetensors` }],
    dest: `models/loras/${l.slug}.safetensors`,
    sizeGb: 0.1,
    versio: '1.0.0',
    canonica: true,
    natum: new Date(),
    trigger: l.trigger ?? l.slug,
    slug: l.slug ?? l.trigger,
    defaultWeight: l.defaultWeight ?? 1.0,
    access: l.access ?? 'public',
    ...(l.ownerAnimaId ? { ownerAnimaId: l.ownerAnimaId } : {}),
  } as Intella))

  return {
    async find(id: string) { return records.find(r => r.id === id) ?? null },
    async list() { return records },
    async canonical() { return records },
    async findByTrigger() { return [] },
    async triggerMap(_baseIntellaId: string, _animaId?: string): Promise<Map<string, Intellae>> {
      const m = new Map<string, Intellae>()
      for (const r of records) {
        for (const raw of (r.trigger ?? '').split(',')) {
          const k = raw.trim().toLowerCase()
          if (!k) continue
          const b = m.get(k); if (b) b.push(r); else m.set(k, [r])
        }
      }
      return m
    },
  }
}

function makeLoraEssentia(): Essentia {
  return makeEssentia({
    intellaId: 'intella.flux-base',
    runpodSpec: {
      imageId: 'runpod/pytorch',
      imageVersion: '2.4.0-py3.11-cuda12.4.1-devel-ubuntu22.04',
      workflowTemplate: 'lora-test',
      workflowTemplateVersion: '1',
      seedInputKey: 'input_seed',
      defaultCookFlags: { batchSize: 1, seedStrategy: 'fixed', seedPlaceholder: 42, privateMode: false, vramGb: 24 },
    },
  })
}

test('compile() on loraCapable template + matching trigger: rewrites prompt + appends LoRA to models', async () => {
  const intellarum = makeLoraIntellarum([
    { slug: 'milady-v3', trigger: 'milady', defaultWeight: 1.0 },
  ])
  const compiler = new Compiler(new WorkflowTemplateRegistry(REAL_WORKFLOWS), () => 42, intellarum)
  const r = await compiler.compile(makeLoraEssentia(), { prompt: 'a portrait, milady style' })

  // Prompt embedded into the CLIP node now contains the <lora:...> tag
  const node22 = r.spec.workflow.inputTemplate['22'] as { inputs: Record<string, unknown> }
  assert.match(node22.inputs.clip_l as string, /<lora:milady-v3:1>/)

  // Model list gained the LoRA, sorted next to the unet base
  const lora = r.spec.models.find(m => m.role === 'lora')
  assert.ok(lora, 'expected the resolved LoRA in spec.models')
  assert.equal(lora!.id, 'intella.milady-v3')

  // Surfaced upward
  assert.equal(r.appliedLoras?.length, 1)
  assert.equal(r.appliedLoras?.[0].slug, 'milady-v3')
})

test('compile() on loraCapable template with no trigger hit: prompt unchanged, no extra models', async () => {
  const intellarum = makeLoraIntellarum([
    { slug: 'milady-v3', trigger: 'milady', defaultWeight: 1.0 },
  ])
  const compiler = new Compiler(new WorkflowTemplateRegistry(REAL_WORKFLOWS), () => 42, intellarum)
  const r = await compiler.compile(makeLoraEssentia(), { prompt: 'a portrait of a cat' })

  const node22 = r.spec.workflow.inputTemplate['22'] as { inputs: Record<string, unknown> }
  assert.equal(node22.inputs.clip_l, 'a portrait of a cat')
  assert.equal(r.spec.models.filter(m => m.role === 'lora').length, 0)
  assert.equal(r.appliedLoras, undefined, 'no LoRAs applied → field omitted')
})

test('compile() on NOT-loraCapable template: resolver does not run even with matching triggers', async () => {
  const intellarum = makeLoraIntellarum([
    { slug: 'milady-v3', trigger: 'milady', defaultWeight: 1.0 },
  ])
  const compiler = new Compiler(new WorkflowTemplateRegistry(REAL_WORKFLOWS), () => 42, intellarum)
  // flux-schnell (default) is not loraCapable
  const r = await compiler.compile(makeEssentia(), { prompt: 'a portrait, milady style' })
  const node22 = r.spec.workflow.inputTemplate['22'] as { inputs: Record<string, unknown> }
  assert.equal(node22.inputs.clip_l, 'a portrait, milady style', 'prompt unchanged')
  assert.equal(r.spec.models.filter(m => m.role === 'lora').length, 0)
})

test('compile() honors animaId for private-LoRA conflict resolution', async () => {
  const intellarum = makeLoraIntellarum([
    { slug: 'pub-shared',  trigger: 'shared', access: 'public' },
    { slug: 'my-shared',   trigger: 'shared', access: 'private', ownerAnimaId: 'anima-alice' },
  ])
  const compiler = new Compiler(new WorkflowTemplateRegistry(REAL_WORKFLOWS), () => 42, intellarum)
  const r = await compiler.compile(makeLoraEssentia(), { prompt: 'shared style' }, { animaId: 'anima-alice' })
  assert.equal(r.appliedLoras?.[0].slug, 'my-shared', 'private owner wins')
})

// ── compile() against a v2-shape Intella record via MongoIntella shim ───────
//
// Item 3 of the trigger-resolution sprint: end-to-end verify that records
// written in v2 shape (the migration's output) are picked up by the resolver
// and surface in spec.models, with no shape errors along the way.

import { MongoClient } from 'mongodb'
import { MongoIntella } from '../../../src/crystal/MongoIntella.js'

const MONGO_URI = process.env.MONGO_PASS ?? process.env.MONGODB_URI ?? 'mongodb://localhost:27017'
const V2_DB  = 'noemaplane_test'
const V2_COL = 'intellae_compiler_v2'

test('compile() resolves a v2-shape LoRA record from MongoIntella + injects into spec.models', async () => {
  const client = new MongoClient(MONGO_URI)
  await client.connect()
  try {
    const col = client.db(V2_DB).collection(V2_COL)
    await col.deleteMany({})
    // Insert a v2-shape doc — the shape the chunk migration writes
    await col.insertOne({
      id: 'intella.v2-compiler',
      nomen: 'milady v2',
      genus: 'lora',
      architectura: 'flux',
      parametri: 0,
      sources: [{ provenance: 'miladystation', uri: 'https://example.com/milady-v2.safetensors' }],
      dest: 'models/loras/milady-v2.safetensors',
      sizeGb: 0.2,
      versio: '1.0.0',
      canonica: false,
      natum: new Date('2026-01-01'),
      params: {
        triggerWords: ['miladyy'],
        slug: 'milady-v2',
        defaultWeight: 1.0,
        baseIntellaId: 'intella.flux-base',
      },
      access: { kind: 'public' },
    })

    const intellarum = new MongoIntella(col)
    const compiler = new Compiler(new WorkflowTemplateRegistry(REAL_WORKFLOWS), () => 42, intellarum)
    const r = await compiler.compile(makeLoraEssentia(), { prompt: 'a portrait, miladyy style' })

    // Resolver hit the v2 record — applied LoRA surfaces
    assert.equal(r.appliedLoras?.length, 1)
    assert.equal(r.appliedLoras?.[0].slug, 'milady-v2')
    // Tag injected into the CLIP prompt
    const node22 = r.spec.workflow.inputTemplate['22'] as { inputs: Record<string, unknown> }
    assert.match(node22.inputs.clip_l as string, /<lora:milady-v2:1>/)
    // spec.models gained the LoRA entry from the v2 record
    const lora = r.spec.models.find(m => m.role === 'lora')
    assert.ok(lora, 'expected the resolved LoRA in spec.models')
    assert.equal(lora!.id, 'intella.v2-compiler')

    await col.deleteMany({})
  } finally {
    await client.close()
  }
})

// ── compile() — pinned models (Mod • → Add, via opts.pinnedModels) ───────────

test('compile() unions opts.pinnedModels into spec.models', async () => {
  const intellarum = makeLoraIntellarum([{ slug: 'extra', trigger: 'zzz' }])
  const compiler = new Compiler(new WorkflowTemplateRegistry(REAL_WORKFLOWS), () => 42, intellarum)
  const r = await compiler.compile(makeEssentia(), { prompt: 'a cat' },
    { pinnedModels: [{ role: 'lora', id: 'intella.extra', dest: 'models/loras/extra.safetensors' }] })
  const pinned = r.spec.models.find(m => m.id === 'intella.extra')
  assert.ok(pinned, 'pinned model resolved into spec.models')
  assert.equal(pinned!.url, 'https://example.com/extra.safetensors', 'url resolved from the Intella, not the rough dest')
})

test('compile() dedupes a pinned model already present from prompt LoRA resolution', async () => {
  const intellarum = makeLoraIntellarum([{ slug: 'milady-v3', trigger: 'milady' }])
  const compiler = new Compiler(new WorkflowTemplateRegistry(REAL_WORKFLOWS), () => 42, intellarum)
  const r = await compiler.compile(makeLoraEssentia(), { prompt: 'a portrait, milady style' },
    { pinnedModels: [{ role: 'lora', id: 'intella.milady-v3', dest: 'models/loras/milady-v3.safetensors' }] })
  assert.equal(r.spec.models.filter(m => m.id === 'intella.milady-v3').length, 1, 'not duplicated')
})

test('compile() with no pinnedModels behaves exactly as before', async () => {
  const compiler = makeCompiler(42)
  const r = await compiler.compile(makeEssentia(), { prompt: 'a cat' })
  assert.ok(Array.isArray(r.spec.models) && r.spec.models.length > 0)
})
