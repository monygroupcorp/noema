import { test } from 'node:test'
import assert from 'node:assert/strict'
import { BulletinModelCatalog } from '../../../src/allocutio/telegram/BulletinModelCatalog.js'
import type { Intellarum } from '../../../src/types/intelligendi.js'
import type { Fundamentorum, Fundamentum } from '../../../src/types/fundamentum.js'

const CATALOG = [
  { id: 'intella.flux-schnell', nomen: 'FLUX.1 Schnell', genus: 'model', architectura: 'dit', dest: 'unet/flux.safetensors', sizeGb: 24 },
  { id: 'intella.flux-vae', nomen: 'FLUX VAE', genus: 'embedding', architectura: 'vae', dest: 'vae/ae.safetensors', sizeGb: 0.3 },
  { id: 'intella.clip-l', nomen: 'CLIP-L (text encoder)', genus: 'embedding', architectura: 'transformer', dest: 'clip/clip_l.safetensors' },
  { id: 'intella.sd15', nomen: 'Stable Diffusion 1.5', genus: 'model', architectura: 'sd15', dest: 'checkpoints/v1-5-pruned-emaonly.safetensors' },
  { id: 'intella.smollm2', nomen: 'SmolLM2 135M Instruct', genus: 'model', architectura: 'gguf', dest: 'gguf/smollm2.gguf', sizeGb: 0.145 },
  { id: 'l1', nomen: 'drifella', genus: 'lora', dest: 'loras/drifella.safetensors', tags: [{ tag: 'flux' }] },
]
const intellarum = {
  async list() { return CATALOG as never },
  async find(id: string) { return (CATALOG.find(c => c.id === id) ?? null) as never },
} as unknown as Intellarum

// Two canonical fundamenta — the substrates /arm projects (a ComfyUI flux stack + a llama.cpp LLM).
const FUNDS: Fundamentum[] = [
  {
    id: 'flux-comfyui', versio: '1.0.0', imageId: 'runpod/pytorch', imageVersion: '2.4', runtime: 'ComfyUI',
    intellae: [{ id: 'intella.flux-schnell', role: 'unet' }, { id: 'intella.flux-vae', role: 'vae' }],
    vramGb: 24, canonica: true, natum: new Date('2025-01-01'), mutatum: new Date('2025-01-01'),
  },
  {
    id: 'smollm-llama', versio: '1.0.0', imageId: 'ghcr.io/ggml', imageVersion: 'srv', runtime: 'llama.cpp',
    intellae: [{ id: 'intella.smollm2', role: 'gguf' }],
    vramGb: 1, canonica: true, natum: new Date('2025-01-01'), mutatum: new Date('2025-01-01'),
  },
]
const fundamentorum = {
  async list() { return FUNDS as never },
  async find(id: string) { return (FUNDS.find(f => f.id === id) ?? null) as never },
  async register() {},
} as unknown as Fundamentorum
const sender = { async sendMessage() { return { message_id: 1 } } }
const cat = () => new BulletinModelCatalog({ intellarum, fundamentorum, sender })

test('listFlows projects one card per canonical Fundamentum, carrying its id, family + runtime', async () => {
  const flows = await cat().listFlows()
  const byLabel = Object.fromEntries(flows.map(f => [f.label, f]))
  assert.equal(byLabel['FLUX'].id, 'flux-comfyui', 'card id is the fundament id (not the family)')
  assert.equal(byLabel['FLUX'].familia, 'flux', 'familia scopes the LoRA picker (armBase)')
  assert.equal(byLabel['FLUX'].config, 'ComfyUI', 'runtime comes from the fundament')
  assert.equal(byLabel['SmolLM2'].id, 'smollm-llama')
  assert.equal(byLabel['SmolLM2'].familia, 'smollm')
  assert.equal(byLabel['SmolLM2'].config, 'llama.cpp')
  assert.equal(flows.at(-1)?.id, 'custom', 'Custom is last')
})

test("the card lists the fundament's resolved weight manifest (names, not ids)", async () => {
  const flows = await cat().listFlows()
  assert.deepEqual(flows.find(f => f.label === 'FLUX')!.models, ['FLUX.1 Schnell', 'FLUX VAE'])
  const smol = flows.find(f => f.label === 'SmolLM2')!
  assert.deepEqual(smol.models, ['SmolLM2 135M Instruct'])
  assert.match(smol.blurb ?? '', /llama\.cpp/, 'blurb names the runtime')
})

test('the card surfaces LoRA availability for its family', async () => {
  const flows = await cat().listFlows()
  assert.match(flows.find(f => f.label === 'FLUX')!.blurb ?? '', /1 LoRA/, 'one flux LoRA (drifella) available')
  assert.doesNotMatch(flows.find(f => f.label === 'SmolLM2')!.blurb ?? '', /LoRA/, 'no LoRAs for the LLM family')
})

test('no fundamentorum → only the Custom card (nothing to project)', async () => {
  const flows = await new BulletinModelCatalog({ intellarum, sender }).listFlows()
  assert.deepEqual(flows, [{ id: 'custom', label: 'Custom' }])
})

test('imageLabel maps a raw OCI ref to a friendly label (no bare URL to auto-link)', () => {
  const c = cat()
  assert.equal(c.imageLabel('ghcr.io/ggml-org/llama.cpp:server-cuda'), 'llama.cpp server (CUDA)')
  assert.equal(c.imageLabel('runpod/pytorch:2.4.0-cuda12.4'), 'PyTorch 2.4 · CUDA 12.4')
  assert.doesNotMatch(c.imageLabel('ghcr.io/unknown/thing:tag'), /ghcr\.io/, 'unknown ref drops the registry host')
})

test('an image advertises the SET of runtimes it can serve (capability, not 1:1)', async () => {
  const c = cat()
  const images = c.listImages()
  assert.equal(images.length, 2, 'two images on offer')
  const comfy = images.find(i => /PyTorch/.test(i))!
  const llama = images.find(i => /llama/.test(i))!
  assert.deepEqual(c.configsForImage(comfy), ['ComfyUI', 'llama.cpp'], 'the general image can host both')
  assert.deepEqual(c.configsForImage(llama), ['llama.cpp'], 'the lean image is single-runtime')
})

test('resolveTriggers with a base family defers to the crystal triggerMap (familia-keyed)', async () => {
  // The studio is armed to FLUX → resolution must go through triggerMap('flux'), NOT a tag scan.
  const lora = { id: 'l1', nomen: 'drifella', genus: 'lora', dest: 'loras/drifella.safetensors', trigger: 'drifella' }
  let askedFamilia: string | undefined
  const ir = {
    async list() { throw new Error('list() must not be used on the family path') },
    async find() { return null },
    async triggerMap(familia: string) {
      askedFamilia = familia
      return new Map([['drifella', [lora]]]) as never
    },
  } as unknown as Intellarum

  const { matched, unmatched } = await new BulletinModelCatalog({ intellarum: ir, sender })
    .resolveTriggers('drifella, nope', { family: 'flux' })

  assert.equal(askedFamilia, 'flux', 'queried the trigger map for the studio family')
  assert.deepEqual(matched.map(m => m.nomen), ['drifella'])
  assert.deepEqual(unmatched, ['nope'])
})

test('resolveTriggers without a family falls back to a flat scan over all LoRAs', async () => {
  const withTriggers = [
    ...CATALOG,
    { id: 'l2', nomen: 'painterly', genus: 'lora', dest: 'loras/painterly.safetensors', trigger: 'painterly, oilpaint' },
  ]
  const ir = {
    async list() { return withTriggers as never },
    async find() { return null },
    async triggerMap() { throw new Error('triggerMap must not be used without a family') },
  } as unknown as Intellarum

  const { matched, unmatched } = await new BulletinModelCatalog({ intellarum: ir, sender })
    .resolveTriggers('oilpaint missing', {})

  assert.deepEqual(matched.map(m => m.nomen), ['painterly'], 'a comma-split alias resolves')
  assert.deepEqual(unmatched, ['missing'])
})

test('the card carries the VRAM footprint declared on the fundament', async () => {
  const flows = await cat().listFlows()
  assert.equal(flows.find(f => f.label === 'FLUX')?.vramGb, 24, 'from Fundamentum.vramGb')
  assert.equal(flows.find(f => f.label === 'SmolLM2')?.vramGb, 1)
})

test('vramGb falls back to summing the resolved weight sizes when the fundament omits it', async () => {
  const noVram: Fundamentum[] = [{
    id: 'flux-comfyui', versio: '1.0.0', imageId: 'runpod/pytorch', imageVersion: '2.4', runtime: 'ComfyUI',
    intellae: [{ id: 'intella.flux-schnell', role: 'unet' }, { id: 'intella.flux-vae', role: 'vae' }],
    canonica: true, natum: new Date('2025-01-01'), mutatum: new Date('2025-01-01'),
  }]
  const fr = { async list() { return noVram as never }, async find() { return noVram[0] as never }, async register() {} } as unknown as Fundamentorum
  const flows = await new BulletinModelCatalog({ intellarum, fundamentorum: fr, sender }).listFlows()
  assert.equal(flows.find(f => f.label === 'FLUX')?.vramGb, 24.3, 'sum of resolved weight sizes (24 + 0.3)')
})

// ── Directed compatibility: two substrates, one derived family ────────────────
// The Kontext edit stack and the schnell stack both derive `familia: 'flux'` (the Kontext unet is a
// flux-stack model), so the family string alone cannot tell the two studios apart. The Kontext
// substrate DECLARES `acceptsFamiliae: ['flux','kontext']`; the schnell one declares nothing. The
// accepted set is therefore carried on the card and handed to the trigger map — which is what keeps
// a Kontext-trained LoRA out of a schnell studio while still offering it in a Kontext one.

const DIRECTED_CATALOG = [
  { id: 'intella.flux-schnell', nomen: 'FLUX.1 Schnell', genus: 'model', familia: 'flux', dest: 'unet/flux.safetensors', sizeGb: 24 },
  { id: 'intella.flux-kontext', nomen: 'FLUX.1 Kontext', genus: 'model', familia: 'flux', dest: 'unet/kontext.safetensors', sizeGb: 24 },
  { id: 'lora.flux', nomen: 'flux-lora', genus: 'lora', familia: 'flux', dest: 'loras/flux-lora.safetensors', trigger: 'fluxtrig' },
  { id: 'lora.kontext', nomen: 'kontext-lora', genus: 'lora', familia: 'kontext', dest: 'loras/kontext-lora.safetensors', trigger: 'kontexttrig' },
]

const DIRECTED_FUNDS: Fundamentum[] = [
  {
    id: 'flux-comfyui', versio: '1.0.0', imageId: 'runpod/pytorch', imageVersion: '2.4', runtime: 'ComfyUI',
    intellae: [{ id: 'intella.flux-schnell', role: 'unet' }],
    canonica: true, natum: new Date('2025-01-01'), mutatum: new Date('2025-01-01'),
  },
  {
    id: 'flux-kontext-comfyui', versio: '1.0.0', imageId: 'runpod/pytorch', imageVersion: '2.4', runtime: 'ComfyUI',
    intellae: [{ id: 'intella.flux-kontext', role: 'unet' }],
    acceptsFamiliae: ['flux', 'kontext'],
    canonica: true, natum: new Date('2025-01-01'), mutatum: new Date('2025-01-01'),
  },
]

/** Family-keyed like `MongoIntella.triggerMap`: a single family matches by equality, a SET by
 *  membership — so a LoRA is only reachable when its familia is in the requested set. */
function directedCatalog() {
  const ir = {
    async list() { return DIRECTED_CATALOG as never },
    async find(id: string) { return (DIRECTED_CATALOG.find(c => c.id === id) ?? null) as never },
    async triggerMap(familia: string | string[]) {
      const accepted = new Set(Array.isArray(familia) ? familia : [familia])
      const map = new Map<string, unknown[]>()
      for (const i of DIRECTED_CATALOG) {
        if (i.genus !== 'lora' || !accepted.has(i.familia)) continue
        map.set(i.trigger!, [i])
      }
      return map as never
    },
  } as unknown as Intellarum
  const fr = {
    async list() { return DIRECTED_FUNDS as never },
    async find(id: string) { return (DIRECTED_FUNDS.find(f => f.id === id) ?? null) as never },
    async register() {},
  } as unknown as Fundamentorum
  return new BulletinModelCatalog({ intellarum: ir, fundamentorum: fr, sender })
}

/** Arm a studio from its card the way the bulletin does, then resolve trigger words in it. */
async function offeredIn(fundamentumId: string, text: string): Promise<string[]> {
  const c = directedCatalog()
  const card = (await c.listFlows()).find(f => f.id === fundamentumId)!
  const scope = card.acceptsFamiliae?.length ? { family: card.acceptsFamiliae } : { family: card.familia! }
  const { matched } = await c.resolveTriggers(text, scope)
  return matched.map(m => m.nomen)
}

test('the card carries the accepted-familiae SET, not just the derived family', async () => {
  const flows = await directedCatalog().listFlows()
  const schnell = flows.find(f => f.id === 'flux-comfyui')!
  const kontext = flows.find(f => f.id === 'flux-kontext-comfyui')!
  assert.equal(schnell.familia, 'flux')
  assert.equal(kontext.familia, 'flux', 'both substrates derive the same family — the string cannot separate them')
  assert.deepEqual(schnell.acceptsFamiliae, ['flux'], 'undeclared → its own family, i.e. the existing behaviour')
  assert.deepEqual(kontext.acceptsFamiliae, ['flux', 'kontext'], 'own family unioned with the declaration')
})

test('a kontext studio offers a kontext LoRA AND a flux LoRA', async () => {
  assert.deepEqual(
    (await offeredIn('flux-kontext-comfyui', 'kontexttrig fluxtrig')).sort(),
    ['flux-lora', 'kontext-lora'],
    'acceptance is directed: the kontext substrate consumes both',
  )
})

test('a schnell studio offers the flux LoRA and NOT the kontext one', async () => {
  const offered = await offeredIn('flux-comfyui', 'kontexttrig fluxtrig')
  assert.deepEqual(offered, ['flux-lora'], 'a plain flux substrate consumes only flux LoRAs')
  assert.ok(!offered.includes('kontext-lora'), 'the kontext LoRA is not on offer here')
})

test('an empty accepted set is treated as no scope, not as a scope matching nothing', async () => {
  const c = directedCatalog()
  const { matched } = await c.resolveTriggers('fluxtrig kontexttrig', { family: [] })
  assert.deepEqual(matched.map(m => m.nomen).sort(), ['flux-lora', 'kontext-lora'], 'falls back to the flat scan')
})
