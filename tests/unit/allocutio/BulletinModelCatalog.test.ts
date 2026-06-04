import { test } from 'node:test'
import assert from 'node:assert/strict'
import { BulletinModelCatalog } from '../../../src/allocutio/telegram/BulletinModelCatalog.js'
import type { Intellarum } from '../../../src/types/intelligendi.js'

const CATALOG = [
  { id: 'intella.flux-schnell', nomen: 'FLUX.1 Schnell', genus: 'model', architectura: 'dit', dest: 'unet/flux.safetensors' },
  { id: 'intella.flux-vae', nomen: 'FLUX VAE', genus: 'embedding', architectura: 'vae', dest: 'vae/ae.safetensors' },
  { id: 'intella.clip-l', nomen: 'CLIP-L (text encoder)', genus: 'embedding', architectura: 'transformer', dest: 'clip/clip_l.safetensors' },
  { id: 'intella.sd15', nomen: 'Stable Diffusion 1.5', genus: 'model', architectura: 'sd15', dest: 'checkpoints/v1-5-pruned-emaonly.safetensors' },
  { id: 'intella.smollm2', nomen: 'SmolLM2 135M Instruct', genus: 'model', architectura: 'gguf', dest: 'gguf/smollm2.gguf' },
  { id: 'l1', nomen: 'drifella', genus: 'lora', dest: 'loras/drifella.safetensors', tags: [{ tag: 'flux' }] },
]
const intellarum = { async list() { return CATALOG as never }, async find() { return null } } as unknown as Intellarum
const sender = { async sendMessage() { return { message_id: 1 } } }
const cat = () => new BulletinModelCatalog({ intellarum, sender })

test('listFlows derives one flow per base family, each with its own runtime', async () => {
  const flows = await cat().listFlows()
  const byLabel = Object.fromEntries(flows.map(f => [f.label, f]))
  assert.ok(byLabel['FLUX'],   'a FLUX flow (ComfyUI)')
  assert.ok(byLabel['SmolLM2'], 'a SmolLM2 flow (llama.cpp)')
  assert.equal(byLabel['FLUX'].config, 'ComfyUI', 'FLUX runs under ComfyUI')
  assert.equal(byLabel['SmolLM2'].config, 'llama.cpp', 'a GGUF model routes to the llama.cpp runtime')
  assert.equal(flows.at(-1)?.id, 'custom', 'Custom is last')
})

test('a ComfyUI flow bundles VAE/CLIP; a llama.cpp flow does not', async () => {
  const flows = await cat().listFlows()
  const flux = flows.find(f => f.label === 'FLUX')!
  const smol = flows.find(f => f.label === 'SmolLM2')!
  assert.ok(flux.models?.some(m => /VAE/.test(m)) && flux.models?.some(m => /CLIP/.test(m)), 'FLUX carries its support models')
  assert.deepEqual(smol.models, ['SmolLM2 135M Instruct'], 'the LLM flow is just the GGUF model — no VAE/CLIP')
  assert.match(smol.blurb ?? '', /llama\.cpp/, 'blurb names the runtime')
})

test('a checkpoint flow is self-contained — no external VAE/CLIP attached (FLUX encoders stay off it)', async () => {
  const flows = await cat().listFlows()
  const sd = flows.find(f => f.label === 'SD1.5')!
  assert.ok(sd, 'SD1.5 derives as its own ComfyUI flow')
  assert.equal(sd.config, 'ComfyUI', 'image-gen runtime')
  assert.deepEqual(sd.models, ['Stable Diffusion 1.5'], 'just the checkpoint — VAE/CLIP are baked in, FLUX encoders excluded')
  assert.match(sd.blurb ?? '', /self-contained checkpoint/, 'blurb reflects it')
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

test('listFlows stamps a rough VRAM footprint (the inert budget stub)', async () => {
  const withSizes = [
    { id: 'intella.flux-schnell', nomen: 'FLUX.1 Schnell', genus: 'model', architectura: 'dit', dest: 'unet/flux.safetensors', sizeGb: 24 },
    { id: 'intella.flux-vae', nomen: 'FLUX VAE', genus: 'embedding', architectura: 'vae', dest: 'vae/ae.safetensors', sizeGb: 0.3 },
    { id: 'intella.smollm2', nomen: 'SmolLM2 135M Instruct', genus: 'model', architectura: 'gguf', dest: 'gguf/smollm2.gguf', sizeGb: 0.145 },
  ]
  const ir = { async list() { return withSizes as never }, async find() { return null } } as unknown as Intellarum
  const flows = await new BulletinModelCatalog({ intellarum: ir, sender }).listFlows()
  assert.equal(flows.find(f => f.label === 'FLUX')?.vramGb, 24.3, 'FLUX footprint = base + VAE')
  assert.equal(flows.find(f => f.label === 'SmolLM2')?.vramGb, 0.1, 'the tiny GGUF is ~0.1 GB')
})
