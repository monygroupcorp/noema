import { test } from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { Compiler } from '../../../src/crystal/Compiler.js'
import { WorkflowTemplateRegistry } from '../../../src/crystal/WorkflowTemplateRegistry.js'
import { ESSENTIA_RUNMAKE_SD15 } from '../../../src/crystal/seeds/essentiae.js'
import type { Intellarum, Intella, Intellae } from '../../../src/types/intelligendi.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const REAL_WORKFLOWS = path.join(__dirname, '../../../src/crystal/workflows')

function makeCompiler(fixedSeed = 42) {
  const registry = new WorkflowTemplateRegistry(REAL_WORKFLOWS)
  return new Compiler(registry, () => fixedSeed)
}

/**
 * DB-free Intellarum for the sd15 template: an `intella.sd15-v1-5` checkpoint base
 * carrying familia 'sd15' (so the Compiler derives an sd15 flow family) plus a set
 * of LoRAs, each declared for a given familia. `triggerMap(familia)` is family-keyed
 * so cross-family LoRAs are never offered.
 */
function makeSd15Intellarum(
  loras: Array<{ slug: string; trigger: string; familia: string; defaultWeight?: number }>,
): Intellarum {
  const records = loras.map(l => ({
    id: `intella.${l.slug}`,
    nomen: l.slug, genus: 'lora' as const, architectura: 'lora' as const,
    familia: l.familia, parametri: 0,
    sources: [{ provenance: 'miladystation' as const, uri: `https://example.com/${l.slug}.safetensors` }],
    dest: `models/loras/${l.slug}.safetensors`, sizeGb: 0.1, versio: '1.0.0', canonica: true,
    natum: new Date(), trigger: l.trigger, slug: l.slug, defaultWeight: l.defaultWeight ?? 1.0,
    access: 'public' as const,
  } as Intella))
  const sd15Base = {
    id: 'intella.sd15-v1-5', nomen: 'sd15 base', genus: 'model' as const, architectura: 'unet' as const,
    familia: 'sd15', parametri: 0,
    sources: [{ provenance: 'huggingface' as const, uri: 'https://example.com/sd15.safetensors' }],
    dest: 'checkpoints/v1-5-pruned-emaonly.safetensors', sizeGb: 1, versio: '1.0.0', canonica: true, natum: new Date(),
  } as Intella
  return {
    async find(id: string) {
      if (id === sd15Base.id) return sd15Base
      return records.find(r => r.id === id) ?? null
    },
    async list() { return records },
    async canonical() { return records },
    async findByTrigger() { return [] },
    async triggerMap(familia: string): Promise<Map<string, Intellae>> {
      const m = new Map<string, Intellae>()
      for (const r of records) {
        if (r.familia !== familia) continue
        for (const raw of (r.trigger ?? '').split(',')) {
          const k = raw.trim().toLowerCase(); if (!k) continue
          const b = m.get(k); if (b) b.push(r); else m.set(k, [r])
        }
      }
      return m
    },
  }
}

test('compile(ESSENTIA_RUNMAKE_SD15) slots the prompt into the LoraTextExtractor node', async () => {
  // sd15 is now loraCapable: the prompt routes through the cozyness LoraTextExtractor
  // (node 10), and the positive CLIPTextEncode (node 6) reads its cleaned-text output.
  const compiler = makeCompiler()
  const { spec } = await compiler.compile(ESSENTIA_RUNMAKE_SD15, { prompt: 'a cat' })
  const extractor = spec.workflow.inputTemplate['10'] as { class_type: string; inputs: Record<string, unknown> }
  assert.equal(extractor.class_type, 'LoraTextExtractor-b1f83aa2')
  assert.equal(extractor.inputs.text, 'a cat')
  const positive = spec.workflow.inputTemplate['6'] as { class_type: string; inputs: Record<string, unknown> }
  assert.equal(positive.class_type, 'CLIPTextEncode')
  assert.deepEqual(positive.inputs.text, ['10', 0])
})

test('compile(ESSENTIA_RUNMAKE_SD15) includes the SD1.5 checkpoint in spec.models', async () => {
  const compiler = makeCompiler()
  const { spec } = await compiler.compile(ESSENTIA_RUNMAKE_SD15, { prompt: 'a cat' })
  const checkpoint = spec.models.find(m => m.role === 'checkpoint')
  assert.ok(checkpoint, 'expected a checkpoint model in spec.models')
  assert.equal(checkpoint!.id, 'intella.sd15-v1-5')
  assert.equal(checkpoint!.dest, 'checkpoints/v1-5-pruned-emaonly.safetensors')
})

// ── customNodes plumbing (Part 1) ─────────────────────────────────────────────

test('compile() forwards the sd15 template customNodes (Coziness pack) onto spec.customNodes', async () => {
  const compiler = makeCompiler()
  const { spec } = await compiler.compile(ESSENTIA_RUNMAKE_SD15, { prompt: 'a cat' })
  assert.ok(Array.isArray(spec.customNodes), 'customNodes is carried onto the spec')
  assert.equal(spec.customNodes!.length, 1)
  assert.equal(spec.customNodes![0].url, 'https://github.com/skfoo/ComfyUI-Coziness')
  assert.equal(spec.customNodes![0].name, 'ComfyUI-Coziness')
})

test('compile() omits spec.customNodes when the template declares none', async () => {
  // flux-schnell-no-url declares no customNodes; resolve its model via a minimal Intellarum.
  const intellarum: Intellarum = {
    async find(id: string) {
      if (id !== 'intella.flux-schnell') return null
      return {
        id, nomen: 'flux schnell', genus: 'model', architectura: 'dit', parametri: 0,
        sources: [{ provenance: 'miladystation', uri: 'https://example.com/flux-schnell.safetensors' }],
        dest: 'unet/flux1-schnell.safetensors', sizeGb: 1, versio: '1.0.0', canonica: true, natum: new Date(),
      } as Intella
    },
    async list() { return [] },
    async canonical() { return [] },
    async findByTrigger() { return [] },
    async triggerMap() { return new Map() },
  }
  const compiler = new Compiler(new WorkflowTemplateRegistry(REAL_WORKFLOWS), () => 42, intellarum)
  const noUrl: Essentia = {
    ...ESSENTIA_RUNMAKE_SD15,
    intellae: [{ id: 'intella.flux-schnell', role: 'unet' }],
    runpodSpec: {
      ...ESSENTIA_RUNMAKE_SD15.runpodSpec!,
      workflowTemplate: 'flux-schnell-no-url',
      workflowTemplateVersion: '1',
    },
  }
  const { spec } = await compiler.compile(noUrl, { prompt: 'a cat' })
  assert.equal(spec.customNodes, undefined, 'no customNodes declared → field omitted')
})

// ── LoRA familia gating on the sd15 template (Part 2) ─────────────────────────

test('compile() on sd15 + a familia:sd15 LoRA trigger: applies it + rewrites the prompt into the extractor', async () => {
  const intellarum = makeSd15Intellarum([{ slug: 'sd15style', trigger: 'sdtrigger', familia: 'sd15' }])
  const compiler = new Compiler(new WorkflowTemplateRegistry(REAL_WORKFLOWS), () => 42, intellarum)
  const r = await compiler.compile(ESSENTIA_RUNMAKE_SD15, { prompt: 'a portrait, sdtrigger style' })

  // applied + surfaced
  assert.equal(r.appliedLoras?.length, 1)
  assert.equal(r.appliedLoras?.[0].slug, 'sd15style')
  // <lora:...> tag routed into the LoraTextExtractor (node 10), NOT the CLIPTextEncode directly
  const node10 = r.spec.workflow.inputTemplate['10'] as { inputs: Record<string, unknown> }
  assert.match(node10.inputs.text as string, /<lora:sd15style:1>/)
  // positive CLIPTextEncode reads the extractor's cleaned-text output
  const node6 = r.spec.workflow.inputTemplate['6'] as { inputs: Record<string, unknown> }
  assert.deepEqual(node6.inputs.text, ['10', 0])
  // model list gained the LoRA
  assert.ok(r.spec.models.find(m => m.role === 'lora'), 'LoRA in spec.models')
})

// ── Prompt affix weave (TASK-007) ─────────────────────────────────────────────

/** Clone the sd15 essentia with affixes baked onto the prompt Porta. */
function withPromptAffix(affix: { praefixum?: string; suffixum?: string }): Essentia {
  return {
    ...ESSENTIA_RUNMAKE_SD15,
    aditus: {
      ...ESSENTIA_RUNMAKE_SD15.aditus,
      prompt: { ...ESSENTIA_RUNMAKE_SD15.aditus.prompt, ...affix },
    },
  }
}

test('weave: a prompt Porta suffixum is woven after the user prompt in the slotted text node', async () => {
  const compiler = makeCompiler()
  const { spec } = await compiler.compile(withPromptAffix({ suffixum: 'watercolor, masterpiece' }), { prompt: 'a fox' })
  const node10 = spec.workflow.inputTemplate['10'] as { inputs: Record<string, unknown> }
  assert.equal(node10.inputs.text, 'a fox, watercolor, masterpiece')
})

test('weave: a prompt Porta praefixum is woven before the user prompt', async () => {
  const compiler = makeCompiler()
  const { spec } = await compiler.compile(withPromptAffix({ praefixum: 'masterpiece' }), { prompt: 'a fox' })
  const node10 = spec.workflow.inputTemplate['10'] as { inputs: Record<string, unknown> }
  assert.equal(node10.inputs.text, 'masterpiece, a fox')
})

test('weave: no affixes → prompt unchanged (no-op)', async () => {
  const compiler = makeCompiler()
  const { spec } = await compiler.compile(ESSENTIA_RUNMAKE_SD15, { prompt: 'a fox' })
  const node10 = spec.workflow.inputTemplate['10'] as { inputs: Record<string, unknown> }
  assert.equal(node10.inputs.text, 'a fox')
})

test('weave-before-lora: a trigger word inside a suffixum resolves into an applied LoRA', async () => {
  // The user's prompt has NO trigger; the flow-baked suffix carries the trigger word.
  // Because the weave runs BEFORE resolveLoraTriggers, the LoRA is applied.
  const intellarum = makeSd15Intellarum([{ slug: 'sd15style', trigger: 'sdtrigger', familia: 'sd15' }])
  const compiler = new Compiler(new WorkflowTemplateRegistry(REAL_WORKFLOWS), () => 42, intellarum)
  const essentia = withPromptAffix({ suffixum: 'sdtrigger, masterpiece' })
  const r = await compiler.compile(essentia, { prompt: 'a portrait' })

  assert.equal(r.appliedLoras?.length, 1)
  assert.equal(r.appliedLoras?.[0].slug, 'sd15style')
  const node10 = r.spec.workflow.inputTemplate['10'] as { inputs: Record<string, unknown> }
  assert.match(node10.inputs.text as string, /<lora:sd15style:1>/)
  assert.ok(r.spec.models.find(m => m.role === 'lora'), 'LoRA in spec.models')
})

test('compile() on sd15 does NOT apply a familia:flux LoRA on the same trigger word', async () => {
  const intellarum = makeSd15Intellarum([{ slug: 'fluxstyle', trigger: 'sdtrigger', familia: 'flux' }])
  const compiler = new Compiler(new WorkflowTemplateRegistry(REAL_WORKFLOWS), () => 42, intellarum)
  const r = await compiler.compile(ESSENTIA_RUNMAKE_SD15, { prompt: 'a portrait, sdtrigger style' })
  assert.equal(r.appliedLoras, undefined, 'cross-family (flux) LoRA must NOT be offered on an sd15 flow')
  const node10 = r.spec.workflow.inputTemplate['10'] as { inputs: Record<string, unknown> }
  assert.equal(node10.inputs.text, 'a portrait, sdtrigger style', 'prompt unchanged')
  assert.equal(r.spec.models.filter(m => m.role === 'lora').length, 0)
})
