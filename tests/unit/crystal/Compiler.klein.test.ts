import { test } from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { Compiler } from '../../../src/crystal/Compiler.js'
import { WorkflowTemplateRegistry } from '../../../src/crystal/WorkflowTemplateRegistry.js'
import { ESSENTIA_KLEIN } from '../../../src/crystal/seeds/essentiae.js'
import { CANONICAL_FUNDAMENTA } from '../../../src/crystal/seeds/fundamenta.js'
import { CANONICAL_INTELLAE } from '../../../src/crystal/seeds/intellae.js'
import { MemoryFundamentorum } from '../../../src/crystal/MemoryFundamentorum.js'
import { canonicalFamilia } from '../../../src/crystal/aitkConfig.js'
import type { Intellarum, Intella, Intellae } from '../../../src/types/intelligendi.js'

// Hermetic acceptance for the canonical FLUX.2 Klein 4B TXT2IMG flow ('klein').
// Mirrors Compiler.turbo.test.ts: compiles the REAL seed against the REAL template,
// checks the klein gotchas that cost live GPU debugging on the edit flow (CFGGuider
// `cfg` carries guidance; Qwen3-4B TE — NOT the 9B's qwen3-8b; Coziness LoRA stack so
// imported `-klein` LoRAs — familia 'flux2' — ride prompt triggers).

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const REAL_WORKFLOWS = path.join(__dirname, '../../../src/crystal/workflows')
const FUNDS = new MemoryFundamentorum(CANONICAL_FUNDAMENTA)

/** DB-free Intellarum over the canonical base weights + injected LoRAs, family-keyed like MongoIntella.triggerMap. */
function makeIntellarum(loras: Array<{ slug: string; trigger: string; familia: string }>): Intellarum {
  const records = loras.map(l => ({
    id: `intella.${l.slug}`, nomen: l.slug, genus: 'lora' as const, architectura: 'lora' as const,
    familia: l.familia, parametri: 0,
    sources: [{ provenance: 'miladystation' as const, uri: `https://example.com/${l.slug}.safetensors` }],
    dest: `models/loras/${l.slug}.safetensors`, sizeGb: 0.1, versio: '1.0.0', canonica: false,
    natum: new Date(), trigger: l.trigger, slug: l.slug, defaultWeight: 1.0, access: 'public' as const,
  } as Intella))
  const byId = new Map<string, Intella>(CANONICAL_INTELLAE.map(i => [i.id, i]))
  for (const r of records) byId.set(r.id, r)
  return {
    async find(id: string) { return byId.get(id) ?? null },
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

function compilerWith(intellarum: Intellarum) {
  return new Compiler(new WorkflowTemplateRegistry(REAL_WORKFLOWS), () => 42, intellarum, FUNDS)
}

test('compile(klein) resolves the 4B stack (4B unet + Qwen3-4B TE + flux2 VAE) and the Coziness pack', async () => {
  const compiler = compilerWith(makeIntellarum([]))
  const { spec } = await compiler.compile(ESSENTIA_KLEIN, { prompt: 'a fox' })
  assert.ok(spec.models.find(m => m.id === 'intella.flux2-klein-4b'), '4B unet in spec.models')
  assert.ok(spec.models.find(m => m.id === 'intella.qwen3-4b-flux2'), 'Qwen3-4B (not 8B) text encoder in spec.models')
  assert.ok(spec.models.find(m => m.id === 'intella.flux2-vae-full-encoder'), 'flux2 VAE in spec.models')
  assert.equal(spec.customNodes?.[0].url, 'https://github.com/skfoo/ComfyUI-Coziness')
  // prompt routes through the LoraTextExtractor (node 200)
  const extractor = spec.workflow.inputTemplate['200'] as { class_type: string; inputs: Record<string, unknown> }
  assert.equal(extractor.class_type, 'LoraTextExtractor-b1f83aa2')
  assert.equal(extractor.inputs.text, 'a fox')
})

test('compile(klein) routes guidance into CFGGuider.cfg and width/height into scheduler + latent', async () => {
  const compiler = compilerWith(makeIntellarum([]))
  const { spec } = await compiler.compile(ESSENTIA_KLEIN, { prompt: 'a fox', guidance: 2.5, steps: 6, width: 768, height: 1344 })
  const g = (id: string) => (spec.workflow.inputTemplate[id] as { inputs: Record<string, unknown> }).inputs
  assert.equal(g('63').cfg, 2.5, 'guidance rides CFGGuider.cfg (klein has no FluxGuidance node)')
  assert.equal(g('62').steps, 6)
  assert.equal(g('62').width, 768)
  assert.equal(g('62').height, 1344)
  assert.equal(g('66').width, 768)
  assert.equal(g('66').height, 1344)
})

test('compile(klein) stacks a flux2-familia LoRA from its trigger word (the imported -klein LoRA path)', async () => {
  const intellarum = makeIntellarum([{ slug: 'impresstation', trigger: 'ps2', familia: canonicalFamilia('klein-4b') }])
  const r = await compilerWith(intellarum).compile(ESSENTIA_KLEIN, { prompt: 'a portrait, ps2 style' })
  assert.equal(r.appliedLoras?.length, 1)
  assert.equal(r.appliedLoras?.[0].slug, 'impresstation')
  const node200 = r.spec.workflow.inputTemplate['200'] as { inputs: Record<string, unknown> }
  assert.match(node200.inputs.text as string, /<lora:impresstation:1>/)
  assert.ok(r.spec.models.find(m => m.role === 'lora'), 'LoRA in spec.models')
})

test('compile(klein) does NOT stack a cross-family (flux.1) LoRA on the same trigger', async () => {
  const intellarum = makeIntellarum([{ slug: 'fluxstyle', trigger: 'ps2', familia: 'flux' }])
  const r = await compilerWith(intellarum).compile(ESSENTIA_KLEIN, { prompt: 'a portrait, ps2 style' })
  assert.equal(r.appliedLoras, undefined, 'flux.1 LoRA must not be offered to the flux2 base')
  assert.equal(r.spec.models.filter(m => m.role === 'lora').length, 0)
})
