import { test } from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { Compiler } from '../../../src/crystal/Compiler.js'
import { WorkflowTemplateRegistry } from '../../../src/crystal/WorkflowTemplateRegistry.js'
import { ESSENTIA_RUNMAKE_ZIMAGE_TURBO, ESSENTIA_RUNMAKE_KREA_TURBO } from '../../../src/crystal/seeds/essentiae.js'
import { CANONICAL_FUNDAMENTA } from '../../../src/crystal/seeds/fundamenta.js'
import { CANONICAL_INTELLAE } from '../../../src/crystal/seeds/intellae.js'
import { MemoryFundamentorum } from '../../../src/crystal/MemoryFundamentorum.js'
import { canonicalFamilia } from '../../../src/crystal/aitkConfig.js'
import type { Intellarum, Intella, Intellae } from '../../../src/types/intelligendi.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const REAL_WORKFLOWS = path.join(__dirname, '../../../src/crystal/workflows')
const FUNDS = new MemoryFundamentorum(CANONICAL_FUNDAMENTA)

/** A DB-free Intellarum over the canonical base weights + an injected LoRA set, family-keyed exactly
 *  like MongoIntella.triggerMap (so cross-family LoRAs are never offered). */
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
    async triggerMap(familia: string | string[]): Promise<Map<string, Intellae>> {
      // The Compiler passes the flow's ACCEPTED SET (`Fundamentum.acceptsFamiliae` unioned with the
      // flow's own derived families); a scalar is still legal. Mirror both, as MongoIntella does.
      const accepted = Array.isArray(familia) ? familia : [familia]
      const m = new Map<string, Intellae>()
      for (const r of records) {
        if (!r.familia || !accepted.includes(r.familia)) continue
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

const FLOWS = [
  { name: 'z-image-turbo', essentia: ESSENTIA_RUNMAKE_ZIMAGE_TURBO, familia: 'zimage', unetId: 'intella.z-image-turbo' },
  { name: 'krea-turbo',    essentia: ESSENTIA_RUNMAKE_KREA_TURBO,    familia: 'krea2',  unetId: 'intella.krea-2-turbo' },
] as const

for (const f of FLOWS) {
  test(`compile(${f.name}) resolves its base unet and forwards the Coziness pack`, async () => {
    const compiler = compilerWith(makeIntellarum([]))
    const { spec } = await compiler.compile(f.essentia, { prompt: 'a fox' })
    assert.ok(spec.models.find(m => m.id === f.unetId), `${f.unetId} in spec.models`)
    assert.equal(spec.customNodes?.[0].url, 'https://github.com/skfoo/ComfyUI-Coziness')
    // prompt routes through the LoraTextExtractor (node 20)
    const extractor = spec.workflow.inputTemplate['20'] as { class_type: string; inputs: Record<string, unknown> }
    assert.equal(extractor.class_type, 'LoraTextExtractor-b1f83aa2')
    assert.equal(extractor.inputs.text, 'a fox')
  })

  test(`compile(${f.name}) stacks a same-familia LoRA from its trigger word`, async () => {
    const intellarum = makeIntellarum([{ slug: `${f.familia}style`, trigger: 'mytrigger', familia: f.familia }])
    const r = await compilerWith(intellarum).compile(f.essentia, { prompt: 'a portrait, mytrigger style' })
    assert.equal(r.appliedLoras?.length, 1)
    assert.equal(r.appliedLoras?.[0].slug, `${f.familia}style`)
    const node20 = r.spec.workflow.inputTemplate['20'] as { inputs: Record<string, unknown> }
    assert.match(node20.inputs.text as string, new RegExp(`<lora:${f.familia}style:1>`))
    assert.ok(r.spec.models.find(m => m.role === 'lora'), 'LoRA in spec.models')
  })

  test(`compile(${f.name}) does NOT stack a cross-family (flux) LoRA on the same trigger`, async () => {
    const intellarum = makeIntellarum([{ slug: 'fluxstyle', trigger: 'mytrigger', familia: 'flux' }])
    const r = await compilerWith(intellarum).compile(f.essentia, { prompt: 'a portrait, mytrigger style' })
    assert.equal(r.appliedLoras, undefined, 'cross-family LoRA must not be offered')
    assert.equal(r.spec.models.filter(m => m.role === 'lora').length, 0)
  })
}

// canonicalFamilia: the alias names users may train under must collapse to the base flow's exact key,
// so the trained LoRA's familia (set in trainingFinalizer) matches triggerMap's exact-equality filter.
test('canonicalFamilia collapses krea/z-image training aliases to the inference base familia', () => {
  for (const a of ['krea2', 'krea2-raw', 'krea2-turbo', 'krea-turbo', 'krea']) assert.equal(canonicalFamilia(a), 'krea2')
  for (const a of ['zimage', 'z-image', 'zimage-turbo', 'z-image-turbo']) assert.equal(canonicalFamilia(a), 'zimage')
  // unmapped bases pass through (today's behaviour for flux/sd15/sdxl, where baseModel already IS the familia)
  assert.equal(canonicalFamilia('sd15'), 'sd15')
  assert.equal(canonicalFamilia('FLUX'), 'flux')
})
