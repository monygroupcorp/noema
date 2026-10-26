// A weight the user adds to a run — a LoRA their prompt triggers, a model they pin — whose
// registry record names no file. Legacy LoRAs migrated without a download URL sit in exactly
// this state and keep their trigger words, so an old customer's first prompt used to die at
// compile with "No URL for model '<database id>'" and the generic "try again". The Compiler now
// refuses by the model's own name, before any pod is paid for, and a base weight in the same
// state still reads as the catalogue's fault. Hermetic — a DB-free Intellarum + the loraCapable
// fixture template.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { Compiler, CompilerError } from '../../../src/crystal/Compiler.js'
import { WorkflowTemplateRegistry } from '../../../src/crystal/WorkflowTemplateRegistry.js'
import { MemoryFundamentorum } from '../../../src/crystal/MemoryFundamentorum.js'
import { hasDownloadAddress } from '../../../src/crystal/weightAddress.js'
import type { Intellarum, Intella, Intellae } from '../../../src/types/intelligendi.js'
import type { Essentia } from '../../../src/types/essendi.js'
import type { Fundamentum } from '../../../src/types/fundamentum.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const REAL_WORKFLOWS = path.join(__dirname, '../../../src/crystal/workflows')

const FUND: Fundamentum = {
  id: 'test-fund', versio: '1.0.0', imageId: 'runpod/pytorch', imageVersion: '2.4', runtime: 'ComfyUI',
  intellae: [{ id: 'intella.flux-base', role: 'unet' }],
  vramGb: 24, canonica: true, natum: new Date('2025-01-01'), mutatum: new Date('2025-01-01'),
}

function intella(over: Partial<Intella> & { id: string }): Intella {
  return {
    nomen: over.id, genus: 'lora', architectura: 'lora', familia: 'flux', parametri: 0,
    sources: [{ provenance: 'miladystation', uri: `https://example.com/${over.id}.safetensors` }],
    dest: `models/loras/${over.id}.safetensors`, sizeGb: 0.1, versio: '1.0.0', canonica: false, natum: new Date(),
    access: 'public', defaultWeight: 1.0,
    ...over,
  } as Intella
}

const BASE = intella({ id: 'intella.flux-base', nomen: 'FLUX base', genus: 'model', architectura: 'unet', dest: 'unet/flux.safetensors', sizeGb: 12 })
/** A legacy LoRA as the migration leaves one whose old record had no URL: a database id for an id,
 *  a display name, a trigger word, and an EMPTY source list. */
const ORPHAN = intella({ id: '6840901d0c6e432ada9d099e', nomen: 'Drifella', slug: 'drifella', trigger: 'drifella', sources: [] })
const HEALTHY = intella({ id: 'intella.milady-v3', nomen: 'Milady v3', slug: 'milady-v3', trigger: 'milady' })

function registry(records: Intella[]): Intellarum {
  const all = [BASE, ...records]
  return {
    async find(id: string) { return all.find(r => r.id === id) ?? null },
    async list() { return all },
    async canonical() { return all.filter(r => r.canonica) },
    async findByTrigger() { return [] },
    async triggerMap(familia: string | string[]): Promise<Map<string, Intellae>> {
      const accepted = Array.isArray(familia) ? familia : [familia]
      const m = new Map<string, Intellae>()
      for (const r of all) {
        if (r.genus !== 'lora' || !r.familia || !accepted.includes(r.familia)) continue
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

const ESSENTIA: Essentia = {
  id: 'lora-flow', nomen: 'LoRA flow', genus: 'atomicus', versio: '1.0.0', contentHash: 'abc', ministerium: 'runpod',
  canonica: true, categoria: 'image',
  aditus: { prompt: { type: 'text', required: true } }, exitus: { image: { type: 'image' } },
  natum: new Date(), mutatum: new Date(),
  intellae: [{ id: 'intella.flux-base', role: 'unet' }],
  fundamentumId: 'test-fund', fundamentumVersio: '1.0.0',
  workflowTemplate: 'lora-test', workflowTemplateVersion: '1', seedInputKey: 'input_seed',
  defaultGenFlags: { batchSize: 1, seedStrategy: 'fixed', seedPlaceholder: 42, privateMode: false, vramGb: 24 },
}

const compilerWith = (i: Intellarum) =>
  new Compiler(new WorkflowTemplateRegistry(REAL_WORKFLOWS), () => 42, i, new MemoryFundamentorum([FUND]))

const unfetchableNaming = (name: string) => (e: unknown) =>
  e instanceof CompilerError && e.code === 'MODEL_UNFETCHABLE' && e.message.includes(`'${name}'`) && !e.message.includes(ORPHAN.id)

test('hasDownloadAddress: a record with no source, an empty list, or a blank uri has none', () => {
  assert.equal(hasDownloadAddress(HEALTHY), true)
  assert.equal(hasDownloadAddress(ORPHAN), false)
  assert.equal(hasDownloadAddress({ sources: undefined as never }), false)
  assert.equal(hasDownloadAddress({ sources: [{ provenance: 'huggingface', uri: '' }] }), false)
})

test('a trigger word for a LoRA with no download address refuses the run, naming the LoRA and not its id', async () => {
  const compiler = compilerWith(registry([ORPHAN, HEALTHY]))
  await assert.rejects(
    () => compiler.compile(ESSENTIA, { prompt: 'a portrait, drifella style' }),
    unfetchableNaming('Drifella'),
  )
})

test('a pinned model with no download address refuses the same way', async () => {
  const compiler = compilerWith(registry([ORPHAN]))
  await assert.rejects(
    () => compiler.compile(ESSENTIA, { prompt: 'a cat' }, {
      pinnedModels: [{ role: 'lora', id: ORPHAN.id, dest: `models/loras/${ORPHAN.id}.safetensors` }],
    }),
    unfetchableNaming('Drifella'),
  )
})

test('a LoRA with an address still applies when an addressless one is merely in the catalogue', async () => {
  const compiler = compilerWith(registry([ORPHAN, HEALTHY]))
  const r = await compiler.compile(ESSENTIA, { prompt: 'a portrait, milady style' })
  assert.ok(r.spec.models.some(m => m.id === HEALTHY.id), 'the healthy LoRA is in the weight set')
  assert.ok(!r.spec.models.some(m => m.id === ORPHAN.id), 'the orphan is not')
})

test('a BASE weight with no download address is still the catalogue\'s fault (MODEL_NOT_RESOLVED)', async () => {
  // A weight the FLOW declares (not the user), whose record names no file and which the template
  // holds no fallback address for: the flow is mis-set-up, and that is what the caller is told.
  const bareVae = intella({ id: 'intella.bare-vae', nomen: 'bare VAE', genus: 'embedding', architectura: 'vae', dest: 'vae/bare.safetensors', sources: [] })
  const compiler = compilerWith(registry([bareVae]))
  const flow: Essentia = { ...ESSENTIA, intellae: [...ESSENTIA.intellae!, { id: bareVae.id, role: 'vae' }] }
  await assert.rejects(
    () => compiler.compile(flow, { prompt: 'a cat' }),
    (e: unknown) => e instanceof CompilerError && e.code === 'MODEL_NOT_RESOLVED',
  )
})
