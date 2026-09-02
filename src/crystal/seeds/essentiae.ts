import type { Essentia } from '../../types/essendi.js'

// =============================================================================
// Canonical Essentiae — platform atomic operations
//
// Each Essentia is the crystal representation of a platform tool. It REFERENCES
// its compute substrate (`Fundamentum`, see seeds/fundamenta.ts) by id+versio —
// the substrate carries the image, runtime, and base/support weights. The
// Essentia keeps its own FORM: workflowTemplate + seedInputKey + genFlags.
// (Decomposed from the former provider-named `runpodSpec` — ADR-0005.)
//
// contentHash is omitted here — computed and set on first registration
// via hashModus() in Phase 2. Left undefined in seeds for staging.
// =============================================================================

export const ESSENTIA_RUNMAKE_FLUX_SCHNELL: Essentia = {
  id: 'flux-schnell',
  nomen: 'FLUX Schnell — text to image',
  descriptio: 'Fast 4-step FLUX text-to-image — the quick general-purpose default. Pick it for speed and clean prompt adherence over the slower, higher-fidelity SDXL/Chroma/Krea siblings.',
  genus: 'atomicus',
  versio: '1.0.0',
  contentHash: '',        // set on registration via hashModus()
  ministerium: 'runpod',
  canonica: true,
  categoria: 'image',

  // Substrate: the FLUX·ComfyUI fundament carries image + runtime + base weights.
  // Family ('flux') derives from the fundament's weights' `Intella.familia`.
  fundamentumId: 'flux-comfyui',
  fundamentumVersio: '1.1.0',

  aditus: {
    prompt:     { type: 'text',  required: true,  description: 'Text prompt for image generation' },
    width:      { type: 'int',   required: false, default: 512, description: 'Output width in pixels' },
    height:     { type: 'int',   required: false, default: 512, description: 'Output height in pixels' },
    steps:      { type: 'int',   required: false, default: 4,   description: 'Inference steps' },
    input_seed: { type: 'int',   required: false,              description: 'Random seed — omit to shuffle' },
  },

  exitus: {
    image: { type: 'image', description: 'Generated image' },
  },

  // Form: which workflow graph runs on the fundament, + seed/generation defaults.
  workflowTemplate: 'flux-schnell',
  workflowTemplateVersion: '1',
  seedInputKey: 'input_seed',
  defaultGenFlags: {
    batchSize: 1,
    seedStrategy: 'shuffle',
    seedPlaceholder: 88888888,
    privateMode: false,
    vramGb: 24,
  },

  natum: new Date('2025-01-01'),
  mutatum: new Date('2025-01-01'),
}

export const ESSENTIA_RUNMAKE_SD15: Essentia = {
  id: 'sd1-5',
  nomen: 'Stable Diffusion 1.5 — text to image',
  descriptio: 'Lightweight SD1.5 text-to-image (8GB, fast and cheap) with the widest LoRA ecosystem. Pick it for quick drafts and heavy LoRA use; step up to SDXL or FLUX when you need higher fidelity.',
  genus: 'atomicus',
  versio: '1.0.0',
  contentHash: '',        // set on registration via hashModus()
  ministerium: 'runpod',
  canonica: true,
  categoria: 'image',

  // Substrate: the SD1.5·ComfyUI fundament (self-contained checkpoint).
  // Family ('sd15') derives from the fundament's weight's `Intella.familia`.
  fundamentumId: 'sd15-comfyui',
  fundamentumVersio: '1.1.0',

  aditus: {
    prompt:     { type: 'text',  required: true,  description: 'Text prompt for image generation' },
    width:      { type: 'int',   required: false, default: 512,  description: 'Output width in pixels' },
    height:     { type: 'int',   required: false, default: 512,  description: 'Output height in pixels' },
    steps:      { type: 'int',   required: false, default: 20,   description: 'Inference steps' },
    guidance:   { type: 'float', required: false, default: 7.5,  description: 'CFG guidance scale' },
    input_seed: { type: 'int',   required: false,               description: 'Random seed — omit to shuffle' },
  },

  exitus: {
    image: { type: 'image', description: 'Generated image' },
  },

  // Form: which workflow graph runs on the fundament, + seed/generation defaults.
  workflowTemplate: 'sd15',
  workflowTemplateVersion: '1',
  seedInputKey: 'input_seed',
  defaultGenFlags: {
    batchSize: 1,
    seedStrategy: 'shuffle',
    seedPlaceholder: 88888888,
    privateMode: false,
    vramGb: 8,
  },

  // Cost curve, fitted from this flow's own completed runs (n=21). Warm p95 is 20 s at the
  // default 20 steps — execution alone, since a warm pod has already provisioned and
  // downloaded — giving perStepSeconds = 1.0. Cold p95 is 86 s, i.e. that same execution
  // plus this flow's own provision + download + load, giving baseSeconds = 86 − 20 = 66.
  // perMegapixelSeconds is deliberately absent: every run in the sample is 512², so there
  // is no resolution variance to fit and a coefficient would be invented rather than
  // measured. At the declared defaults this reserves 172 impetus (≈$0.058).
  // A flow reserves `GENERIC_RESERVE_IMPETUS` until it has enough of its own runs to fit a
  // curve like this one; `krea-turbo` is the other flow that has reached that point.
  pretium: {
    baseSeconds: 66,
    perStepSeconds: 1.0,
  },

  natum: new Date('2025-01-01'),
  mutatum: new Date('2025-01-01'),
}

export const ESSENTIA_RUNMAKE_SDXL: Essentia = {
  id: 'sdxl',
  nomen: 'Stable Diffusion XL — text to image',
  descriptio: 'Stable Diffusion XL text-to-image at 1024px — balanced quality with a broad LoRA ecosystem. Pick it over SD1.5 for detail, and over FLUX/Krea when you want classic Stable Diffusion styles.',
  genus: 'atomicus',
  versio: '1.0.0',
  contentHash: '',        // set on registration via hashModus()
  ministerium: 'runpod',
  canonica: true,
  categoria: 'image',

  // Substrate: the SDXL·ComfyUI fundament (self-contained checkpoint).
  // Family ('sdxl') derives from the fundament's weight's `Intella.familia`.
  fundamentumId: 'sdxl-comfyui',
  fundamentumVersio: '1.1.0',

  aditus: {
    prompt:     { type: 'text',  required: true,  description: 'Text prompt for image generation' },
    width:      { type: 'int',   required: false, default: 1024, description: 'Output width in pixels' },
    height:     { type: 'int',   required: false, default: 1024, description: 'Output height in pixels' },
    steps:      { type: 'int',   required: false, default: 30,   description: 'Inference steps' },
    guidance:   { type: 'float', required: false, default: 7,    description: 'CFG guidance scale' },
    input_seed: { type: 'int',   required: false,               description: 'Random seed — omit to shuffle' },
  },

  exitus: {
    image: { type: 'image', description: 'Generated image' },
  },

  workflowTemplate: 'sdxl',
  workflowTemplateVersion: '1',
  seedInputKey: 'input_seed',
  defaultGenFlags: {
    batchSize: 1,
    seedStrategy: 'shuffle',
    seedPlaceholder: 88888888,
    privateMode: false,
    vramGb: 12,
  },

  natum: new Date('2025-01-01'),
  mutatum: new Date('2025-01-01'),
}

export const ESSENTIA_RUNMAKE_CHROMA: Essentia = {
  id: 'chroma',
  nomen: 'Chroma — text to image',
  descriptio: 'Chroma text-to-image (FLUX-family, 1024px) with a distinct stylized, illustrative aesthetic. Pick it for artistic/non-photoreal looks; choose FLUX or Krea when you want photorealism.',
  genus: 'atomicus',
  versio: '1.0.0',
  contentHash: '',        // set on registration via hashModus()
  ministerium: 'runpod',
  canonica: true,
  categoria: 'image',

  // Substrate: the Chroma·ComfyUI fundament (Chroma unet + shared FLUX T5/VAE).
  // Family ('chroma') derives from the unet weight's `Intella.familia`.
  fundamentumId: 'chroma-comfyui',
  fundamentumVersio: '1.1.0',

  aditus: {
    prompt:     { type: 'text',  required: true,  description: 'Text prompt for image generation' },
    width:      { type: 'int',   required: false, default: 1024, description: 'Output width in pixels' },
    height:     { type: 'int',   required: false, default: 1024, description: 'Output height in pixels' },
    steps:      { type: 'int',   required: false, default: 26,   description: 'Sampling steps' },
    guidance:   { type: 'float', required: false, default: 4,    description: 'CFG guidance scale' },
    input_seed: { type: 'int',   required: false,               description: 'Random seed — omit to shuffle' },
  },

  exitus: {
    image: { type: 'image', description: 'Generated image' },
  },

  workflowTemplate: 'chroma',
  workflowTemplateVersion: '1',
  seedInputKey: 'input_seed',
  defaultGenFlags: {
    batchSize: 1,
    seedStrategy: 'shuffle',
    seedPlaceholder: 666,
    privateMode: false,
    vramGb: 24,
  },

  natum: new Date('2025-01-01'),
  mutatum: new Date('2025-01-01'),
}

// Z-Image Turbo — text to image (8-step distilled). Alibaba Tongyi's 6B S3-DiT on the
// z-image-turbo-comfyui substrate (new unet + Qwen3-4B encoder + shared FLUX VAE). LoRA-capable via the
// Coziness MultiLoraLoader: a LoRA trained on Z-Image (familia 'zimage') stacks from its trigger word.
// Turbo is distilled → few steps, cfg ~1. Family ('zimage') derives from the unet's `Intella.familia`.
export const ESSENTIA_RUNMAKE_ZIMAGE_TURBO: Essentia = {
  id: 'z-image-turbo',
  nomen: 'Z-Image Turbo — text to image',
  descriptio: 'Z-Image Turbo — 8-step distilled 6B text-to-image: fast, high quality, and LoRA-capable (familia \'zimage\'). Pick it for quick gens, especially when applying a trained Z-Image LoRA.',
  genus: 'atomicus',
  versio: '1.0.0',
  contentHash: '',        // set on registration via hashModus()
  ministerium: 'runpod',
  canonica: true,
  categoria: 'image',

  fundamentumId: 'z-image-turbo-comfyui',
  fundamentumVersio: '1.1.0',

  aditus: {
    prompt:     { type: 'text',  required: true,  description: 'Text prompt for image generation' },
    width:      { type: 'int',   required: false, default: 1024, description: 'Output width in pixels' },
    height:     { type: 'int',   required: false, default: 1024, description: 'Output height in pixels' },
    steps:      { type: 'int',   required: false, default: 8,    description: 'Sampling steps (Turbo is distilled — few steps)' },
    guidance:   { type: 'float', required: false, default: 1,    description: 'CFG guidance scale (Turbo runs near 1)' },
    input_seed: { type: 'int',   required: false,               description: 'Random seed — omit to shuffle' },
  },

  exitus: {
    image: { type: 'image', description: 'Generated image' },
  },

  workflowTemplate: 'z-image-turbo',
  workflowTemplateVersion: '1',
  seedInputKey: 'input_seed',
  defaultGenFlags: {
    batchSize: 1,
    seedStrategy: 'shuffle',
    seedPlaceholder: 88888888,
    privateMode: false,
    vramGb: 24,
  },

  natum: new Date('2026-06-26'),
  mutatum: new Date('2026-06-26'),
}

// Krea 2 Turbo — text to image (8-step distilled). The 12.9B single_mmdit_large_wide DiT on the
// krea-turbo-comfyui substrate (Krea 2 Turbo unet + Qwen3-VL-4B encoder + Qwen-Image VAE). LoRA-capable
// via the Coziness MultiLoraLoader: a LoRA trained on Krea 2 RAW (familia 'krea2') stacks from its
// trigger word — train on RAW, run on Turbo. License: Krea 2 Community License (<$1M revenue commercial).
export const ESSENTIA_RUNMAKE_KREA_TURBO: Essentia = {
  id: 'krea-turbo',
  nomen: 'Krea 2 Turbo — text to image',
  descriptio: 'Krea 2 Turbo — 8-step distilled text-to-image tuned for photoreal output, LoRA-capable (train on RAW, run on Turbo). Pick it for realism; choose Chroma for stylized, FLUX Schnell for raw speed.',
  genus: 'atomicus',
  versio: '1.0.0',
  contentHash: '',        // set on registration via hashModus()
  ministerium: 'runpod',
  canonica: true,
  categoria: 'image',

  fundamentumId: 'krea-turbo-comfyui',
  fundamentumVersio: '1.1.0',

  aditus: {
    prompt:     { type: 'text',  required: true,  description: 'Text prompt for image generation' },
    width:      { type: 'int',   required: false, default: 1024, description: 'Output width in pixels' },
    height:     { type: 'int',   required: false, default: 1024, description: 'Output height in pixels' },
    steps:      { type: 'int',   required: false, default: 8,    description: 'Sampling steps (Turbo is distilled — few steps)' },
    guidance:   { type: 'float', required: false, default: 1,    description: 'CFG guidance scale (Turbo runs near 1)' },
    input_seed: { type: 'int',   required: false,               description: 'Random seed — omit to shuffle' },
  },

  exitus: {
    image: { type: 'image', description: 'Generated image' },
  },

  workflowTemplate: 'krea-turbo',
  workflowTemplateVersion: '1',
  seedInputKey: 'input_seed',
  defaultGenFlags: {
    batchSize: 1,
    seedStrategy: 'shuffle',
    seedPlaceholder: 88888888,
    privateMode: false,
    vramGb: 24,
  },

  // Cost curve, fitted from this flow's own settled runs at the declared defaults
  // (8 steps, 1024²). The observed shape is two-tier: a run whose pod has no weights yet
  // settles around 222, a run landing on a pod that already holds them around 14. Settlement
  // on the pod path is one impetus per billed second, so those are seconds directly — the
  // curve's own units, no conversion.
  //
  // The ~208 difference is this flow's cold overhead. It is NOT pod provisioning: the billed
  // window is the runner's job clock, which opens once the runner accepts the job, so RunPod
  // boot and SSH bootstrap sit outside it. What is inside is node install, ComfyUI restart,
  // and the pull of a 12.9B unet plus text encoder and VAE onto a fresh disk — download, not
  // compute. That is `baseSeconds`; the ~14 is graph execution.
  //
  // Splitting the execution term: an additive curve cannot express the steps × megapixels
  // product a sampler actually costs, and one operating point cannot separate the two
  // coefficients. So each variable term is set to reproduce the WHOLE measured execution on
  // its own — 14/8 per step, 14/1.048576 per megapixel — which keeps the curve an upper
  // bound when either input is raised above the defaults. The price is that execution is
  // counted twice at the defaults (28 against a measured 14); since execution is ~6% of the
  // cold total, that costs ~6% of the reserve. Omitting the resolution term as `sd1-5` does
  // is only safe where the sample has no resolution range to speak of — this flow's 24GB pod
  // puts 2048² within reach, so the term stays.
  //
  // At the declared defaults this reserves 472 impetus (≈$0.16) against a ~222 measured cold
  // run — 2.1× the worst case observed, and roughly half the generic bound, so a given purse
  // sustains about twice the `concurrentia` (see `reserveHeadroomImpetus`). It holds its
  // ~2× margin as either input is raised: ~2.1× at 2048², ~2.1× at 40 steps. Far enough out
  // (40 steps AND 4096²) the product term outruns an additive curve, but so does the generic
  // bound — that corner is held by the `maxJobSeconds` ceiling, not by any reservation model.
  //
  // `baseSeconds` is deliberately the FULL cold overhead and is not amortised across a
  // collection: concurrent dispatches all miss `Praefectus.findWarm` together and each pay
  // their own download.
  pretium: {
    baseSeconds: 208,
    perStepSeconds: 1.75,
    perMegapixelSeconds: 13.35,
  },

  natum: new Date('2026-06-26'),
  mutatum: new Date('2026-06-26'),
}

// FLUX img2img / restyle — i2i (effect). The input image is VAE-encoded to a latent and partially
// denoised (`strength`), so the output keeps the source composition and restyles per the prompt. Reuses
// the shared flux-comfyui substrate (schnell unet + flux VAE + T5/CLIP — all seeded). The `image` aditus
// rides the i2i primitive into a LoadImage node feeding VAEEncode. categoria 'image'.
export const ESSENTIA_FLUXI2I: Essentia = {
  id: 'flux-i2i',
  nomen: 'FLUX — image to image (restyle)',
  descriptio: 'FLUX image-to-image restyle — keeps the source composition and repaints it per your prompt (strength controls how far it drifts). Pick it to restyle an existing image, not to follow edit instructions.',
  genus: 'atomicus',
  versio: '1.0.0',
  contentHash: '',
  ministerium: 'runpod',
  canonica: true,
  categoria: 'image',

  fundamentumId: 'flux-comfyui',
  fundamentumVersio: '1.1.0',

  aditus: {
    prompt:     { type: 'text',  required: true,  description: 'How to restyle the image' },
    image:      { type: 'image', required: true,  description: 'Source image to restyle' },
    strength:   { type: 'float', required: false, default: 0.6, description: 'Denoise strength — higher = more change, lower = closer to source' },
    steps:      { type: 'int',   required: false, default: 6,   description: 'Sampling steps' },
    guidance:   { type: 'float', required: false, default: 3.5, description: 'FLUX guidance' },
    input_seed: { type: 'int',   required: false,              description: 'Random seed — omit to shuffle' },
  },
  exitus: { image: { type: 'image', description: 'Restyled image' } },

  workflowTemplate: 'fluxi2i',
  workflowTemplateVersion: '1',
  seedInputKey: 'input_seed',
  defaultGenFlags: { batchSize: 1, seedStrategy: 'shuffle', seedPlaceholder: 88888888, privateMode: false, vramGb: 24 },

  natum: new Date('2025-01-01'),
  mutatum: new Date('2025-01-01'),
}

// FLUX.1 Kontext — instruction edit (effect). The input image becomes a ReferenceLatent conditioning;
// the prompt is an edit instruction ("add a hat", "make it night"). Works with our existing flux LoRAs
// (familia 'flux'). New flux-kontext-comfyui substrate (Kontext unet + shared flux T5/CLIP/VAE).
// categoria 'image'.
export const ESSENTIA_KONTEXTEDIT: Essentia = {
  id: 'kontext-edit',
  nomen: 'FLUX.1 Kontext — instruction edit',
  descriptio: 'FLUX.1 Kontext instruction edit — follows plain-language edits ("add a hat", "make it night") and works with flux.1 LoRAs. Pick it for targeted edits; use FLUX.2 Klein for stronger, newer edits.',
  genus: 'atomicus',
  versio: '1.0.0',
  contentHash: '',
  ministerium: 'runpod',
  canonica: true,
  categoria: 'image',

  fundamentumId: 'flux-kontext-comfyui',
  fundamentumVersio: '1.1.0',

  aditus: {
    prompt:     { type: 'text',  required: true,  description: 'Edit instruction (e.g. "add a red hat", "make it winter")' },
    image:      { type: 'image', required: true,  description: 'Image to edit' },
    steps:      { type: 'int',   required: false, default: 20,  description: 'Sampling steps' },
    guidance:   { type: 'float', required: false, default: 2.5, description: 'FLUX guidance' },
    input_seed: { type: 'int',   required: false,              description: 'Random seed — omit to shuffle' },
  },
  exitus: { image: { type: 'image', description: 'Edited image' } },

  workflowTemplate: 'kontextedit',
  workflowTemplateVersion: '1',
  seedInputKey: 'input_seed',
  defaultGenFlags: { batchSize: 1, seedStrategy: 'shuffle', seedPlaceholder: 88888888, privateMode: false, vramGb: 24 },

  natum: new Date('2025-01-01'),
  mutatum: new Date('2025-01-01'),
}

// FLUX.2 Klein — instruction edit (effect). A more capable edit model than Kontext: FLUX.2 architecture
// (Qwen3 text encoder, flux2 VAE). The input image is scaled, VAE-encoded, and injected as a
// ReferenceLatent into both the prompt conditioning and a zeroed negative; the prompt is the edit
// instruction. NOT LoRA-compatible with our flux.1 LoRAs (familia 'flux2', no Coziness stack). Graph
// ported 1:1 from the official Comfy-Org flux2-klein-9b image-edit template. categoria 'image'.
export const ESSENTIA_KLEINEDIT: Essentia = {
  id: 'klein-edit',
  nomen: 'FLUX.2 Klein — instruction edit',
  descriptio: 'FLUX.2 Klein 9B instruction edit — more capable than Kontext (FLUX.2 architecture). Pick it for high-quality edits when you do not need a LoRA (it is not flux.1-LoRA compatible); use Klein 4B for LoRA edits.',
  genus: 'atomicus',
  versio: '1.0.0',
  contentHash: '',
  ministerium: 'runpod',
  canonica: true,
  categoria: 'image',

  fundamentumId: 'flux2-klein-comfyui',
  fundamentumVersio: '1.1.0',

  aditus: {
    prompt:     { type: 'text',  required: true,  description: 'Edit instruction (e.g. "replace the background with a coastal cliff at sunset")' },
    image:      { type: 'image', required: true,  description: 'Image to edit' },
    steps:      { type: 'int',   required: false, default: 4,  description: 'Sampling steps (Klein is distilled — few steps)' },
    input_seed: { type: 'int',   required: false,             description: 'Random seed — omit to shuffle' },
  },
  exitus: { image: { type: 'image', description: 'Edited image' } },

  workflowTemplate: 'kleinedit',
  workflowTemplateVersion: '1',
  seedInputKey: 'input_seed',
  defaultGenFlags: { batchSize: 1, seedStrategy: 'shuffle', seedPlaceholder: 88888888, privateMode: false, vramGb: 24 },

  natum: new Date('2025-01-01'),
  mutatum: new Date('2025-01-01'),
}

// FLUX.2 Klein 4B — instruction edit, LoRA-CAPABLE. Same edit graph as klein-edit (9B) but on the 4B
// DiT (fits a 4090 with room for a LoRA) and carrying the Coziness MultiLoraLoader stack, so a
// `<lora:slug:weight>` tag in the prompt stacks adapters. This is the canonical base our `stationthis`
// flagship custom modus forks from (deriveSavedModus → one degree off). categoria 'image'.
export const ESSENTIA_KLEINEDIT_4B: Essentia = {
  id: 'klein-edit-4b',
  nomen: 'FLUX.2 Klein 4B — instruction edit',
  descriptio: 'FLUX.2 Klein 4B instruction edit, LoRA-capable (familia \'flux2\') — pick when your edit needs a flux2 LoRA or trigger word. This is the canonical base the STATIONTHIS flagship flow forks from.',
  genus: 'atomicus',
  versio: '1.0.0',
  contentHash: '',
  ministerium: 'runpod',
  canonica: true,
  categoria: 'image',

  fundamentumId: 'flux2-klein-4b-comfyui',
  fundamentumVersio: '1.1.0',

  aditus: {
    prompt:     { type: 'text',  required: true,  description: 'Edit instruction — describe the change you want. Naming a known style keyword pulls that look into the edit.' },
    image:      { type: 'image', required: true,  description: 'Image to edit' },
    steps:      { type: 'int',   required: false, default: 9,  description: 'Sampling steps' },
    guidance:   { type: 'float', required: false, default: 3,  description: 'CFGGuider guidance — how strongly the edit follows the instruction/style. FLUX.2 klein uses this (not a FluxGuidance node); higher = stronger restyle.' },
    input_seed: { type: 'int',   required: false,             description: 'Random seed — omit to shuffle' },
  },
  exitus: { image: { type: 'image', description: 'Edited image' } },

  workflowTemplate: 'kleinedit4b',
  workflowTemplateVersion: '1',
  seedInputKey: 'input_seed',
  defaultGenFlags: { batchSize: 1, seedStrategy: 'shuffle', seedPlaceholder: 88888888, privateMode: false, vramGb: 24 },

  natum: new Date('2026-06-30'),
  mutatum: new Date('2026-06-30'),
}

// FLUX.2 Klein 4B — TEXT TO IMAGE, LoRA-CAPABLE. The plain txt2img counterpart of klein-edit-4b:
// same substrate (flux2-klein-4b-comfyui — 4B DiT + Qwen3-4B TE + flux2 VAE) and the same Coziness
// MultiLoraLoader stack, minus the image-injection chain (no LoadImage/VAEEncode/ReferenceLatent —
// conditioning feeds CFGGuider directly; width/height feed Flux2Scheduler + EmptyFlux2LatentImage).
// This is the canonical base that imported `-klein` LoRAs (familia 'flux2') stack on via prompt
// trigger words / `<lora:slug:weight>` tags. Guidance rides CFGGuider's `cfg` (FLUX.2 klein has no
// FluxGuidance node). Defaults mirror klein-edit-4b (steps 9, guidance 3). categoria 'image'.
export const ESSENTIA_KLEIN: Essentia = {
  id: 'klein',
  nomen: 'FLUX.2 Klein 4B — text to image',
  descriptio: 'FLUX.2 Klein 4B text-to-image, LoRA-capable (familia \'flux2\') with strong prompt adherence. Pick it when you need a flux2 LoRA/trigger or the newest FLUX.2 quality over the FLUX Schnell / SDXL siblings.',
  genus: 'atomicus',
  versio: '1.0.0',
  contentHash: '',
  ministerium: 'runpod',
  canonica: true,
  categoria: 'image',

  fundamentumId: 'flux2-klein-4b-comfyui',
  fundamentumVersio: '1.1.0',

  aditus: {
    prompt:     { type: 'text',  required: true,  description: 'Text prompt for image generation — describe the scene you want. Naming a known style keyword pulls that look into the image.' },
    width:      { type: 'int',   required: false, default: 1024, description: 'Output width in pixels' },
    height:     { type: 'int',   required: false, default: 1024, description: 'Output height in pixels' },
    steps:      { type: 'int',   required: false, default: 9,   description: 'Sampling steps' },
    guidance:   { type: 'float', required: false, default: 3,   description: 'CFGGuider guidance — how strongly the image follows the prompt/style. FLUX.2 klein uses this (not a FluxGuidance node).' },
    input_seed: { type: 'int',   required: false,              description: 'Random seed — omit to shuffle' },
  },
  exitus: { image: { type: 'image', description: 'Generated image' } },

  workflowTemplate: 'klein',
  workflowTemplateVersion: '1',
  seedInputKey: 'input_seed',
  defaultGenFlags: { batchSize: 1, seedStrategy: 'shuffle', seedPlaceholder: 88888888, privateMode: false, vramGb: 24 },

  natum: new Date('2026-07-06'),
  mutatum: new Date('2026-07-06'),
}

// Background removal — i2i (enhance). InspyrenetRembg pack (self-downloads its ckpt) on the weightless
// comfyui-base substrate. The `image` aditus rides the i2i primitive into a LoadImage feeding the rembg
// node; output is the cut-out (transparent PNG). categoria 'image'.
export const ESSENTIA_RMBG: Essentia = {
  id: 'rmbg',
  nomen: 'Remove background',
  descriptio: 'Remove background — cuts the subject out onto transparency (RGBA PNG). Pick it to isolate a subject for compositing or layering; it changes only the background, not the subject.',
  genus: 'atomicus',
  versio: '1.0.0',
  contentHash: '',
  ministerium: 'runpod',
  canonica: true,
  categoria: 'image',

  fundamentumId: 'comfyui-base',
  fundamentumVersio: '1.1.0',

  aditus: {
    image: { type: 'image', required: true, description: 'Image to remove the background from' },
  },
  exitus: { image: { type: 'image', description: 'Subject cut out on transparency (RGBA PNG)' } },

  workflowTemplate: 'rmbg',
  workflowTemplateVersion: '1',
  defaultGenFlags: { batchSize: 1, privateMode: false, vramGb: 8 },

  natum: new Date('2025-01-01'),
  mutatum: new Date('2025-01-01'),
}

// Image upscale — the first i2i flow, pack-free + model-only (core UpscaleModelLoader +
// ImageUpscaleWithModel; replaces the old UltimateSDUpscale graphs). The image-typed, slot-mapped
// `image` aditus rides the i2i image-input primitive (Compiler.ts "Media inputs" — runner fetches the
// URL into ComfyUI's input/ dir as a destFilename, keyed purely on Porta.type). Verified to compile to
// a correct mediaInputs spec. Runnable pending a real-pod staging run (graph correctness + the HF
// weight URL). categoria 'image'; verb binding (enhance) is a separate decision.
export const ESSENTIA_UPSCALE: Essentia = {
  id: 'upscale',
  nomen: 'Image upscale — 4x-UltraSharp',
  descriptio: 'Image upscale (4x-UltraSharp) — enlarges and sharpens an existing image 4x without changing its content. Pick it to increase resolution; use a restyle/edit flow to actually change the picture.',
  genus: 'atomicus',
  versio: '1.0.0',
  contentHash: '',        // set on registration via hashModus()
  ministerium: 'runpod',
  canonica: true,
  categoria: 'image',

  fundamentumId: 'upscale-comfyui',
  fundamentumVersio: '1.1.0',

  aditus: {
    image: { type: 'image', required: true, description: 'Image to upscale 4x' },
  },

  exitus: {
    image: { type: 'image', description: 'Upscaled image (4x)' },
  },

  workflowTemplate: 'upscale',
  workflowTemplateVersion: '1',
  defaultGenFlags: {
    batchSize: 1,
    privateMode: false,
    vramGb: 6,
  },

  natum: new Date('2025-01-01'),
  mutatum: new Date('2025-01-01'),
}

// Wan2.2 — text to video. Native ComfyUI nodes only (no custom node pack): the two-model MoE
// unets (high-noise → low-noise, KSamplerAdvanced split at step 10) share the umt5 text encoder
// + Wan2.1 VAE (FUNDAMENTUM_WAN22_T2V_COMFYUI). Render-proven graph (wan-artifacts/wan22-t2v.api.json
// rendered a real mp4 on this box). categoria 'video'.
export const ESSENTIA_WAN22_T2V: Essentia = {
  id: 'wan22-t2v',
  nomen: 'Wan2.2 — text to video',
  descriptio: 'Wan2.2 text-to-video (MoE) — turns a prompt into a short mp4, higher quality but heavier than LTX. Pick it for text-only video; use wan22-i2v to animate an existing image.',
  genus: 'atomicus',
  versio: '1.0.0',
  contentHash: '',
  ministerium: 'runpod',
  canonica: true,
  categoria: 'video',

  fundamentumId: 'wan22-t2v-comfyui',
  fundamentumVersio: '1.1.0',

  aditus: {
    prompt:          { type: 'text', required: true,  description: 'Text prompt for video generation' },
    negative_prompt: { type: 'text', required: false, description: 'Negative prompt — what to avoid' },
    frames:          { type: 'int',  required: false, default: 33, description: 'Video length in frames (fps 16)' },
    input_seed:      { type: 'int',  required: false,              description: 'Random seed — omit to shuffle' },
  },

  exitus: {
    video: { type: 'video', description: 'Generated video (mp4/h264)' },
  },

  workflowTemplate: 'wan22-t2v',
  workflowTemplateVersion: '1',
  seedInputKey: 'input_seed',
  defaultGenFlags: { batchSize: 1, seedStrategy: 'shuffle', seedPlaceholder: 42, privateMode: false, vramGb: 48 },

  natum: new Date('2026-07-07'),
  mutatum: new Date('2026-07-07'),
}

// Wan2.2 — image to video. Same MoE shape as T2V, but the required `image` aditus rides the i2i
// image-input primitive into `LoadImage` → `WanImageToVideo.start_image` (that node emits
// [positive, negative, latent] feeding both samplers). Render-proven graph
// (wan-artifacts/wan22-i2v.api.json rendered a real mp4 on this box). categoria 'video'.
export const ESSENTIA_WAN22_I2V: Essentia = {
  id: 'wan22-i2v',
  nomen: 'Wan2.2 — image to video',
  descriptio: 'Wan2.2 image-to-video (MoE) — animates a start-frame image into a short mp4. Pick it to bring a still to life at higher quality; use ltx-i2v for a faster, lighter alternative.',
  genus: 'atomicus',
  versio: '1.0.0',
  contentHash: '',
  ministerium: 'runpod',
  canonica: true,
  categoria: 'video',

  fundamentumId: 'wan22-i2v-comfyui',
  fundamentumVersio: '1.1.0',

  aditus: {
    prompt:          { type: 'text',  required: true,  description: 'Text prompt for video generation' },
    image:           { type: 'image', required: true,  description: 'Start frame image' },
    negative_prompt: { type: 'text',  required: false, description: 'Negative prompt — what to avoid' },
    frames:          { type: 'int',   required: false, default: 33, description: 'Video length in frames (fps 16)' },
    input_seed:      { type: 'int',   required: false,              description: 'Random seed — omit to shuffle' },
  },

  exitus: {
    video: { type: 'video', description: 'Generated video (mp4/h264)' },
  },

  workflowTemplate: 'wan22-i2v',
  workflowTemplateVersion: '1',
  seedInputKey: 'input_seed',
  defaultGenFlags: { batchSize: 1, seedStrategy: 'shuffle', seedPlaceholder: 42, privateMode: false, vramGb: 48 },

  natum: new Date('2026-07-07'),
  mutatum: new Date('2026-07-07'),
}

// =============================================================================
// Understanding-track Essentiae — "read a new medium → text" (ADR-0007).
//
// All three share ONE substrate (FUNDAMENTUM_QWEN_VL_VLLM: a vLLM serving image,
// runtime 'vLLM') but carry their OWN LM in `intellae` — the fundament pins no base
// weights, so each flow swaps its checkpoint (Compiler merges both manifests).
//
// categoria 'text' → no exitus/type extension needed (the cheap track). They are
// seeded CATALOG-FIRST: they are discoverable now, but cannot run until BOTH land —
//   (1) the pod-side TransformersVllmExecutor (ADR-0007 Part A), and
//   (2) the Compiler's non-ComfyUI branch + LLM CompiledSpec variant (Compiler.ts is
//       currently ComfyUI-hardwired: it REQUIRES workflowTemplate and always emits a
//       workflow graph). Hence no `workflowTemplate` here — the form half is the LLM
//       prompt+gen-params variant (ADR-0007 Part B item 4), pending.
// (Same staging discipline as INTELLA_SMOLLM2_135M: catalog/UI lands ahead of the runner.)
// =============================================================================

export const ESSENTIA_QWEN3_VL: Essentia = {
  id: 'qwen3-vl-8b',
  nomen: 'Qwen3-VL — image + text to text',
  descriptio: 'Qwen3-VL vision-language — answers questions about an image (or runs text-only). Pick it as the general "look at this and tell me" flow; use the captioner for dataset captions or ShotVL for cinematography.',
  genus: 'atomicus',
  versio: '1.0.0',
  contentHash: '',
  ministerium: 'runpod',
  canonica: true,
  categoria: 'text',

  fundamentumId: 'qwen-vl-vllm',
  fundamentumVersio: '1.0.0',
  intellae: [{ id: 'intella.qwen3-vl-8b', role: 'lm' }],

  // Explicit override (noema-087): optional (not required) image input means rule 2
  // never fires, so the cascade falls through to the text rule's `chat` default; the
  // real intent (image + text -> text) is `describe`.
  verbum: 'describe',

  aditus: {
    prompt:      { type: 'text',  required: true,  description: 'The question or instruction' },
    image:       { type: 'image', required: false, description: 'Image to reason over (optional)' },
    max_tokens:  { type: 'int',   required: false, default: 1024, description: 'Max output tokens' },
    temperature: { type: 'float', required: false, default: 0.7,  description: 'Sampling temperature' },
  },
  exitus: {
    text: { type: 'text', description: 'The model\'s textual answer' },
  },

  // The LLM form half (ADR-0007 Part B): a baked assistant persona + baseline gen params
  // (the aditus knobs override these). The vLLM executor builds its chat call from this.
  inferentia: {
    systemPrompt: 'You are Qwen-VL, a precise multimodal assistant. Answer the user\'s question about the provided image directly and concisely.',
    genParams: { top_p: 0.9 },
  },

  natum: new Date('2026-06-11'),
  mutatum: new Date('2026-06-23'),
}

export const ESSENTIA_MOSS_MUSIC: Essentia = {
  id: 'moss-music-8b',
  nomen: 'MOSS-Music — audio to text (music understanding)',
  descriptio: 'MOSS-Music audio understanding — transcribes, describes, or analyzes a music clip (chords, structure) to text. Pick it to read a piece of audio; it does not generate audio.',
  genus: 'atomicus',
  versio: '1.0.0',
  contentHash: '',
  ministerium: 'runpod',
  canonica: true,
  categoria: 'text',

  // MOSS is a custom arch (audio encoder) vLLM can't serve → its own SGLang substrate (ADR-0007).
  fundamentumId: 'moss-sglang',
  fundamentumVersio: '1.0.0',
  intellae: [{ id: 'intella.moss-music-8b', role: 'lm' }],

  aditus: {
    audio:       { type: 'audio', required: true,  description: 'Audio/music clip to analyze' },
    prompt:      { type: 'text',  required: false, description: 'What to ask about the audio (e.g. transcribe, describe, chords)' },
    max_tokens:  { type: 'int',   required: false, default: 1024, description: 'Max output tokens' },
    temperature: { type: 'float', required: false, default: 0.7,  description: 'Sampling temperature' },
  },
  exitus: {
    text: { type: 'text', description: 'Description, transcription, or analysis of the audio' },
  },

  natum: new Date('2026-06-11'),
  mutatum: new Date('2026-06-11'),
}

export const ESSENTIA_SHOTVL: Essentia = {
  id: 'shotvl-7b',
  nomen: 'ShotVL — video/image to text (cinematography)',
  descriptio: 'ShotVL cinematography analysis — reads shot size, framing, and lighting from a video or still frame. Pick it for film/shot analysis; use Qwen3-VL for general image Q&A.',
  genus: 'atomicus',
  versio: '1.0.0',
  contentHash: '',
  ministerium: 'runpod',
  canonica: true,
  categoria: 'text',

  fundamentumId: 'qwen-vl-vllm',
  fundamentumVersio: '1.0.0',
  intellae: [{ id: 'intella.shotvl-7b', role: 'lm' }],

  // Explicit override (noema-087): both media inputs are optional, so rule 2 never
  // fires and the cascade falls through to the text rule's `chat` default; the real
  // intent (video/image + text -> text) is `describe`.
  verbum: 'describe',

  aditus: {
    prompt:      { type: 'text',  required: true,  description: 'What to analyze (shot size, framing, lighting...)' },
    video:       { type: 'video', required: false, description: 'Video clip to analyze (optional)' },
    image:       { type: 'image', required: false, description: 'Still frame to analyze (optional)' },
    max_tokens:  { type: 'int',   required: false, default: 1024, description: 'Max output tokens' },
    temperature: { type: 'float', required: false, default: 0.7,  description: 'Sampling temperature' },
  },
  exitus: {
    text: { type: 'text', description: 'Cinematography analysis' },
  },

  natum: new Date('2026-06-11'),
  mutatum: new Date('2026-06-11'),
}

// =============================================================================
// ESSENTIA_QWEN3_VL_CAPTION — a caption-focused understanding flow (Slice D).
//
// Same substrate + weights as ESSENTIA_QWEN3_VL (the Qwen3-VL VLM), but the form
// half is specialised for ONE job: producing dense, comma-separated training
// captions. The captioner instruction lives in two baked places so the flow is
// usable image-only: a `systemPrompt` persona/format-rule (the system turn) and a
// `prompt` Porta `praefixum` (the user turn — woven even when no prompt is typed,
// since the inference compile reads the raw prompt and weaves affixes). Feeds the
// canon-training dataset-prep loop. Execution is GPU-gated on the vLLM executor
// (ADR-0007 A2.2c) — the seed compiles to a runnable spec today, hermetically.
// =============================================================================
export const ESSENTIA_QWEN3_VL_CAPTION: Essentia = {
  id: 'qwen3-vl-caption',
  nomen: 'Qwen3-VL — image captioner (training datasets)',
  descriptio: 'Qwen3-VL captioner — produces one dense, comma-separated caption per image, tuned for LoRA training datasets. Pick it to auto-caption images; use the general Qwen3-VL flow for open-ended questions.',
  genus: 'atomicus',
  versio: '1.0.0',
  contentHash: '',
  ministerium: 'runpod',
  canonica: true,
  categoria: 'text',

  fundamentumId: 'qwen-vl-vllm',
  fundamentumVersio: '1.0.0',
  intellae: [{ id: 'intella.qwen3-vl-8b', role: 'lm' }],

  aditus: {
    image:       { type: 'image', required: true,  description: 'Image to caption' },
    prompt:      { type: 'text',  required: false, praefixum: 'Describe this image in one dense caption — subject, attributes, style, and composition.', description: 'Optional extra guidance, woven after the caption instruction' },
    max_tokens:  { type: 'int',   required: false, default: 256, description: 'Max caption tokens' },
    temperature: { type: 'float', required: false, default: 0.3, description: 'Sampling temperature (low = stable captions)' },
  },
  exitus: {
    caption: { type: 'text', description: 'A dense, comma-separated training caption' },
  },

  inferentia: {
    systemPrompt: 'You are an expert image captioner producing training-dataset captions. Reply with ONE line: comma-separated descriptive phrases covering subject, attributes, style, and composition. No preamble, no markdown, no quotes.',
    genParams: { top_p: 0.9, repeat_penalty: 1.05 },
  },

  natum:   new Date('2026-06-23'),
  mutatum: new Date('2026-06-23'),
}

// =============================================================================
// Generation track — HeartMuLa (text→music), runtime 'python-modelcard' (ADR-0007).
//
// Not a ComfyUI graph and not an OpenAI server: a cloned `heartlib` repo run as a one-shot CLI.
// The `script` form encodes the real CLI — lyrics+tags are written to FILES (fileInputs), the
// numeric knobs become flags (argMap), and the .mp3 is collected (output). categoria 'audio' (no
// new type). Seeded catalog-first; runs once the PythonModelcardExecutor lands (pod-side).
// =============================================================================
export const ESSENTIA_HEARTMULA: Essentia = {
  id: 'heartmula-3b',
  nomen: 'HeartMuLa — text to music',
  descriptio: 'HeartMuLa text-to-music — turns lyrics plus style tags into a generated track (.mp3). Pick it to compose music from words; use MOSS-Music to analyze existing audio instead.',
  genus: 'atomicus',
  versio: '1.0.0',
  contentHash: '',
  ministerium: 'runpod',
  canonica: true,
  categoria: 'audio',

  fundamentumId: 'heartmula-pytorch',
  fundamentumVersio: '1.0.0',
  intellae: [
    { id: 'intella.heartmula-gen', role: 'config' },
    { id: 'intella.heartmula-3b',  role: 'generator' },
    { id: 'intella.heartcodec',    role: 'codec' },
  ],

  aditus: {
    lyrics:              { type: 'text',  required: true,  description: 'Lyrics, with [Intro]/[Verse]/[Chorus] section markers' },
    tags:                { type: 'text',  required: true,  description: 'Comma-separated style tags (e.g. piano,happy,synthwave)' },
    max_audio_length_ms: { type: 'int',   required: false, default: 240000, description: 'Max track length in ms' },
    temperature:         { type: 'float', required: false, default: 1.0,    description: 'Sampling temperature' },
    topk:                { type: 'int',   required: false, default: 50,     description: 'Top-k sampling' },
    cfg_scale:           { type: 'float', required: false, default: 1.5,    description: 'Classifier-free guidance scale' },
  },
  exitus: {
    audio: { type: 'audio', description: 'Generated music track (.mp3)' },
  },

  // Form half: the heartlib CLI. lyrics/tags → files; knobs → flags; collect the mp3.
  script: {
    repo: 'https://github.com/HeartMuLa/heartlib',
    entry: 'python examples/run_music_generation.py',
    // --lazy_load: heartlib's single-GPU memory saver (the 3B + codec just exceed 24GB at the codec
    // decode step otherwise — verified-live-local 2026-06-12).
    fixedArgs: ['--model_path=./ckpt', '--version=3B', '--save_path=assets/output.mp3', '--lazy_load', 'true'],
    argMap: {
      max_audio_length_ms: '--max_audio_length_ms',
      temperature: '--temperature',
      topk: '--topk',
      cfg_scale: '--cfg_scale',
    },
    fileInputs: { lyrics: 'assets/lyrics.txt', tags: 'assets/tags.txt' },
    output: 'assets/output.mp3',
    outputKind: 'audio',
  },

  defaultGenFlags: { vramGb: 24 },

  natum: new Date('2026-06-12'),
  mutatum: new Date('2026-06-12'),
}

// =============================================================================
// Generation track — Hunyuan3D (image→3D, SHAPE-ONLY), runtime 'python-modelcard' (ADR-0007).
//
// Hunyuan3D has no CLI — the `script` form drops a thin wrapper (fixedFiles) that loads the shape
// pipeline, runs it on the input image, and exports a .glb. categoria '3d' (Part B). Shape-only
// (~10GB) fits a 24GB pod; texture (~29GB + custom CUDA build) is deferred. The pipeline
// self-downloads tencent/Hunyuan3D-2.1 (HF_HOME on the model volume). Seeded catalog-first.
// =============================================================================
const HUNYUAN3D_SHAPE_WRAPPER = `import sys, argparse, urllib.request
sys.path.insert(0, './hy3dshape')
from hy3dshape.pipelines import Hunyuan3DDiTFlowMatchingPipeline
ap = argparse.ArgumentParser()
ap.add_argument('--image'); ap.add_argument('--output')
a = ap.parse_args()
img = a.image
if img.startswith('http'):
    urllib.request.urlretrieve(img, '/tmp/in.png'); img = '/tmp/in.png'
pipe = Hunyuan3DDiTFlowMatchingPipeline.from_pretrained('tencent/Hunyuan3D-2.1')
mesh = pipe(image=img)[0]
mesh.export(a.output)
print('exported', a.output)
`

export const ESSENTIA_HUNYUAN3D: Essentia = {
  id: 'hunyuan3d-21',
  nomen: 'Hunyuan3D — image to 3D (shape)',
  descriptio: 'Hunyuan3D image-to-3D — turns a clean, front-facing reference image into an untextured 3D mesh (.glb). Pick it to lift a picture into 3D geometry; texturing is a separate/deferred step.',
  genus: 'atomicus',
  versio: '1.0.0',
  contentHash: '',
  ministerium: 'runpod',
  canonica: true,
  categoria: '3d',

  fundamentumId: 'hunyuan3d-pytorch',
  fundamentumVersio: '1.0.0',

  // Explicit override (noema-087): image-only aditus (no text port) would otherwise
  // hit rule 1 and misclassify as `enhance`; this is really i2m — `lift`.
  verbum: 'lift',

  aditus: {
    image: { type: 'image', required: true, description: 'Reference image — a clean, front-facing subject works best' },
  },
  exitus: {
    mesh: { type: '3d', description: 'Generated 3D mesh (.glb), untextured (shape-only)' },
  },

  // Form half: the Hunyuan3D shape pipeline, wrapped (the repo has no CLI).
  script: {
    repo: 'https://github.com/Tencent-Hunyuan/Hunyuan3D-2.1',
    // SHAPE-ONLY deps (hy3dshape/requirements.txt) — the root requirements.txt pulls texture-only,
    // build-fragile packages (basicsr/realesrgan/tb_nightly) that fail; the shape set is light and
    // keeps the base torch. Plus `timm` (image encoder, undeclared) and libGL/glib (pymeshlab needs
    // libOpenGL.so.0). Verified-live-local 2026-06-12 → valid .glb.
    install: 'apt-get update -qq && apt-get install -y -qq libgl1 libglib2.0-0 && pip install -r hy3dshape/requirements.txt timm -q',
    entry: 'python run_shape.py',
    argMap: { image: '--image' },
    fixedArgs: ['--output', 'output.glb'],
    fixedFiles: { 'run_shape.py': HUNYUAN3D_SHAPE_WRAPPER },
    output: 'output.glb',
    outputKind: '3d',
  },

  defaultGenFlags: { vramGb: 12 },

  natum: new Date('2026-06-12'),
  mutatum: new Date('2026-06-12'),
}

// LTX 2.3 — text to video. categoria 'video': the video seam is warm end-to-end (SaveVideo
// collection, <video> delivery already shipped). Shares the ltx-comfyui fundament with the I2V
// essentia below. House resolution 832x544, 81 frames, 16fps baked into the template.
export const ESSENTIA_LTX_T2V: Essentia = {
  id: 'ltx-t2v',
  nomen: 'LTX 2.3 — text to video',
  descriptio: 'LTX 2.3 text-to-video (832x544, 81 frames) — faster and lighter than Wan2.2 for short clips. Pick it for quick text-to-video; choose Wan2.2 when you want higher quality.',
  genus: 'atomicus',
  versio: '1.0.0',
  contentHash: '',
  ministerium: 'runpod',
  canonica: true,
  categoria: 'video',

  fundamentumId: 'ltx-comfyui',
  fundamentumVersio: '1.1.0',

  aditus: {
    prompt:     { type: 'text',  required: true,  description: 'Text prompt for video generation' },
    negative:   { type: 'text',  required: false, description: 'Negative prompt' },
    frames:     { type: 'int',   required: false, default: 81, description: 'Number of frames' },
    input_seed: { type: 'int',   required: false,              description: 'Random seed — omit to shuffle' },
  },

  exitus: {
    video: { type: 'video', description: 'Generated video' },
  },

  workflowTemplate: 'ltx-t2v',
  workflowTemplateVersion: '1',
  seedInputKey: 'input_seed',
  defaultGenFlags: {
    batchSize: 1,
    seedStrategy: 'shuffle',
    seedPlaceholder: 88888888,
    privateMode: false,
    vramGb: 48,
  },

  natum: new Date('2026-07-07'),
  mutatum: new Date('2026-07-07'),
}

// LTX 2.3 — image to video. Same fundament + templates family as T2V; the graph swaps in
// LoadImage -> LTXVImgToVideoConditionOnly to condition the first frames on the source image.
export const ESSENTIA_LTX_I2V: Essentia = {
  id: 'ltx-i2v',
  nomen: 'LTX 2.3 — image to video',
  descriptio: 'LTX 2.3 image-to-video — animates a source image into a short clip, the fast/light counterpart to wan22-i2v. Pick it for quick image-to-video; choose Wan2.2 i2v for higher quality.',
  genus: 'atomicus',
  versio: '1.0.0',
  contentHash: '',
  ministerium: 'runpod',
  canonica: true,
  categoria: 'video',

  fundamentumId: 'ltx-comfyui',
  fundamentumVersio: '1.1.0',

  aditus: {
    prompt:     { type: 'text',  required: true,  description: 'Text prompt for video generation' },
    image:      { type: 'image', required: true,  description: 'Source image to animate' },
    negative:   { type: 'text',  required: false, description: 'Negative prompt' },
    frames:     { type: 'int',   required: false, default: 81, description: 'Number of frames' },
    input_seed: { type: 'int',   required: false,              description: 'Random seed — omit to shuffle' },
  },

  exitus: {
    video: { type: 'video', description: 'Generated video' },
  },

  workflowTemplate: 'ltx-i2v',
  workflowTemplateVersion: '1',
  seedInputKey: 'input_seed',
  defaultGenFlags: {
    batchSize: 1,
    seedStrategy: 'shuffle',
    seedPlaceholder: 88888888,
    privateMode: false,
    vramGb: 48,
  },

  natum: new Date('2026-07-07'),
  mutatum: new Date('2026-07-07'),
}

// =============================================================================
// MiniMax H3 — three video+audio flows on ONE substrate (noema-372)
//
// All three sit on `minimax-h3-comfyui`, which carries the shared text encoder and
// both VAEs. Each flow adds only its own DiT + baked turbo LoRA via `intellae`, so
// co-hosted they pull the 26 GB encoder once, not three times.
//
// The turbo LoRA is a BAKED weight, not a user-selectable one: the graph names it in
// `LoraLoaderModelOnly` at strength 1.0 and the 4-step schedule depends on it. It rides
// the weight manifest and carries no `familia`, so the prompt-driven LoRA rail cannot
// surface or stack it.
//
// USER LORAS. All three templates are `loraCapable`, on the `minimax-h3` familia the two
// DiTs carry. The rail stacks ON TOP of the turbo LoRA — `MultiLoraLoader` takes the
// turbo loader's OUTPUT as its model — so a user LoRA never displaces the 4-step schedule
// the graph's `steps: 4` depends on. Nothing carries this familia yet, so the rail is a
// no-op until an H3 LoRA exists: `triggerMap` returns empty, the extractor emits an empty
// spec, and `MultiLoraLoader` passes the model through untouched. That the turbo LoRA
// patches the int8-convrot quantized DiT at all is the evidence the rail can work on it.
//
// AUDIO. H3 is video+audio ("va"): `VAEDecodeAudio` feeds `CreateVideo`, which muxes the
// voice track into the mp4 before `SaveVideo`. The exitus is therefore ONE `video`, same
// as Wan — there is no separate audio artifact.
//
// GEOMETRY IS BAKED at the rig-proven 960x768. `frames` is the only geometry the caller
// touches, and it is not a free int: legal H3 clip lengths are 17k+5, and the speech
// budget is ~2.55 words/s — an overrun silently DROPS a sentence rather than speeding up.
// =============================================================================

/**
 * MiniMax H3 — text to video.
 *
 * The same `MiniMaxH3ImageToVideo` node as fl2v with NEITHER optional frame port wired,
 * which is what makes t2v possible at all: `Comfy-Org/MiniMax-H3` publishes no t2v
 * checkpoint, only fl2va and ref2va.
 *
 * UNPROVEN ON A POD. That the node runs with no frame conditioning is read from its
 * schema (`first_frame`/`last_frame` both optional) and from the reference repo shipping
 * an i2v graph that wires neither — it has never been executed. If a live run rejects it,
 * t2v becomes a composite (an image front feeding fl2v) and is its own item; do not force
 * it here.
 */
export const ESSENTIA_MINIMAX_H3_T2V: Essentia = {
  id: 'minimax-h3-t2v',
  nomen: 'MiniMax H3 — text to video',
  descriptio: 'MiniMax H3 text-to-video with a synchronised audio track — a prompt in, a short mp4 with sound out. Pick it over Wan when you want speech or ambience in the clip; use wan22-t2v for silent video.',
  genus: 'atomicus',
  versio: '1.0.0',
  contentHash: '',
  ministerium: 'runpod',
  canonica: true,
  categoria: 'video',

  fundamentumId: 'minimax-h3-comfyui',
  fundamentumVersio: '1.0.0',

  intellae: [
    { id: 'intella.minimax-h3-fl2va-int8', role: 'unet' },
    { id: 'intella.minimax-h3-fl2v-turbo-4step', role: 'lora' },
  ],

  aditus: {
    prompt:     { type: 'text', required: true,  description: 'What the video should show and say. Dialogue is spoken aloud — budget ~2.55 words per second of clip.' },
    frames:     { type: 'int',  required: false, default: 209, description: 'Clip length in frames at 24fps (209 = 8.7s). Must be 17k+5.' },
    input_seed: { type: 'int',  required: false,               description: 'Random seed — omit to shuffle' },
  },

  exitus: {
    video: { type: 'video', description: 'Generated video with audio (mp4)' },
  },


  // Cost curve, from the first cold run (the first cold run, 2026-09-02): a billed window of
  // ~1428 s, of which 713 s was the 56 GB weight pull. `baseSeconds` is exactly what the field
  // means — this flow's own download + load overhead — and it dominates: the sample itself is
  // ~57 s of the total.
  //
  // ONE run is not a fit. It is here because the alternative is worse: on
  // GENERIC_RESERVE_IMPETUS (900) this flow measured 871, a 3.3% margin, and an
  // under-reservation does not merely mis-price — `ActumCompletor` throws `Cursor overcharge`
  // and the run FAILS after the video exists. Refit once there are runs to fit from.
  //
  // No `perStepSeconds` or `perMegapixelSeconds`: steps are baked at 4 by the turbo LoRA and the
  // geometry is baked at 960x768, so neither term has an input to multiply. `frames` does move
  // sample time and has no term in `Pretium` at all — acceptable while the download dominates,
  // and worth revisiting if the geometry is ever exposed.
  pretium: {
    baseSeconds: 1430,
  },

  workflowTemplate: 'minimax-h3-t2v',
  workflowTemplateVersion: '1',
  seedInputKey: 'input_seed',
  defaultGenFlags: { batchSize: 1, seedStrategy: 'shuffle', seedPlaceholder: 42, privateMode: false, vramGb: 48 },

  natum: new Date('2026-09-01'),
  mutatum: new Date('2026-09-01'),
}

/**
 * MiniMax H3 — first-frame to video.
 *
 * `LoadImage` → `MiniMaxH3ImageToVideo.first_frame`. Note this node has NO audio input of
 * any kind — not a voice reference, not a guide — so the speech it produces is
 * unconditioned. Use ref2v when the voice matters.
 *
 * `last_frame` exists on the node and is deliberately not exposed in v1: an absent optional
 * media port would leave its `LoadImage` holding a placeholder filename and fail at
 * execution (the Compiler injects a destFilename only for ports that carry a value).
 */
export const ESSENTIA_MINIMAX_H3_FL2V: Essentia = {
  id: 'minimax-h3-fl2v',
  nomen: 'MiniMax H3 — first frame to video',
  descriptio: 'MiniMax H3 image-to-video with audio — animates a start frame into a short mp4 with sound. Pick it to bring a still to life with ambience; use minimax-h3-ref2v when a specific character or voice must carry through.',
  genus: 'atomicus',
  versio: '1.0.0',
  contentHash: '',
  ministerium: 'runpod',
  canonica: true,
  categoria: 'video',

  fundamentumId: 'minimax-h3-comfyui',
  fundamentumVersio: '1.0.0',

  intellae: [
    { id: 'intella.minimax-h3-fl2va-int8', role: 'unet' },
    { id: 'intella.minimax-h3-fl2v-turbo-4step', role: 'lora' },
  ],

  aditus: {
    prompt:      { type: 'text',  required: true,  description: 'What should happen in the clip. Dialogue is spoken aloud — budget ~2.55 words per second.' },
    first_frame: { type: 'image', required: true,  description: 'The still the video opens on' },
    frames:      { type: 'int',   required: false, default: 209, description: 'Clip length in frames at 24fps (209 = 8.7s). Must be 17k+5.' },
    input_seed:  { type: 'int',   required: false,               description: 'Random seed — omit to shuffle' },
  },

  exitus: {
    video: { type: 'video', description: 'Generated video with audio (mp4)' },
  },


  // Cost curve, from the first cold run (the first cold run, 2026-09-02): a billed window of
  // ~1428 s, of which 713 s was the 56 GB weight pull. `baseSeconds` is exactly what the field
  // means — this flow's own download + load overhead — and it dominates: the sample itself is
  // ~57 s of the total.
  //
  // ONE run is not a fit. It is here because the alternative is worse: on
  // GENERIC_RESERVE_IMPETUS (900) this flow measured 871, a 3.3% margin, and an
  // under-reservation does not merely mis-price — `ActumCompletor` throws `Cursor overcharge`
  // and the run FAILS after the video exists. Refit once there are runs to fit from.
  //
  // No `perStepSeconds` or `perMegapixelSeconds`: steps are baked at 4 by the turbo LoRA and the
  // geometry is baked at 960x768, so neither term has an input to multiply. `frames` does move
  // sample time and has no term in `Pretium` at all — acceptable while the download dominates,
  // and worth revisiting if the geometry is ever exposed.
  pretium: {
    baseSeconds: 1430,
  },

  workflowTemplate: 'minimax-h3-fl2v',
  workflowTemplateVersion: '1',
  seedInputKey: 'input_seed',
  defaultGenFlags: { batchSize: 1, seedStrategy: 'shuffle', seedPlaceholder: 42, privateMode: false, vramGb: 48 },

  natum: new Date('2026-09-01'),
  mutatum: new Date('2026-09-01'),
}

/**
 * MiniMax H3 — reference to video.
 *
 * The interesting one: a reference image drives the character and a reference audio clip
 * carries VOICE TIMBRE, so one pass produces the character, the motion, the speech and the
 * ambience together, in sync.
 *
 * Both media ports are REQUIRED in v1. `ref_audio` is required because it is the point of
 * the flow, and because an absent optional media port fails at execution (see fl2v's note).
 * Multi-reference autogrow beyond index 0, `ref_video`, and `MiniMaxH3AddGuide` chaining are
 * out of scope for v1.
 *
 * The prompt convention is the model's, not ours: reference the inputs as `<Picture 1>` and
 * `<Audio 1>`, and tag the voice explicitly — "<Audio 1> is the voice-timbre reference for
 * <Picture 1>" — or the timbre is not reliably carried.
 */
export const ESSENTIA_MINIMAX_H3_REF2V: Essentia = {
  id: 'minimax-h3-ref2v',
  nomen: 'MiniMax H3 — reference to video',
  descriptio: 'MiniMax H3 reference-to-video — a reference image and a voice clip produce a character speaking, in sync, in one pass. Pick it when a specific face or voice must carry the clip; use minimax-h3-fl2v to animate a still without a voice reference.',
  genus: 'atomicus',
  versio: '1.0.0',
  contentHash: '',
  ministerium: 'runpod',
  canonica: true,
  categoria: 'video',

  fundamentumId: 'minimax-h3-comfyui',
  fundamentumVersio: '1.0.0',

  intellae: [
    { id: 'intella.minimax-h3-ref2va-int8', role: 'unet' },
    { id: 'intella.minimax-h3-ref2v-turbo-4step', role: 'lora' },
  ],

  aditus: {
    prompt:     { type: 'text',  required: true,  description: 'The scene and the dialogue. Reference the inputs as <Picture 1> and <Audio 1>, and say "<Audio 1> is the voice-timbre reference for <Picture 1>" to carry the voice.' },
    ref_image:  { type: 'image', required: true,  description: 'Reference image — the character or subject' },
    ref_audio:  { type: 'audio', required: true,  description: 'Reference audio — the voice timbre to speak in' },
    frames:     { type: 'int',   required: false, default: 209, description: 'Clip length in frames at 24fps (209 = 8.7s). Must be 17k+5.' },
    input_seed: { type: 'int',   required: false,               description: 'Random seed — omit to shuffle' },
  },

  exitus: {
    video: { type: 'video', description: 'Generated video with the referenced voice (mp4)' },
  },


  // Cost curve, from the first cold run (the first cold run, 2026-09-02): a billed window of
  // ~1428 s, of which 713 s was the 56 GB weight pull. `baseSeconds` is exactly what the field
  // means — this flow's own download + load overhead — and it dominates: the sample itself is
  // ~57 s of the total.
  //
  // ONE run is not a fit. It is here because the alternative is worse: on
  // GENERIC_RESERVE_IMPETUS (900) this flow measured 871, a 3.3% margin, and an
  // under-reservation does not merely mis-price — `ActumCompletor` throws `Cursor overcharge`
  // and the run FAILS after the video exists. Refit once there are runs to fit from.
  //
  // No `perStepSeconds` or `perMegapixelSeconds`: steps are baked at 4 by the turbo LoRA and the
  // geometry is baked at 960x768, so neither term has an input to multiply. `frames` does move
  // sample time and has no term in `Pretium` at all — acceptable while the download dominates,
  // and worth revisiting if the geometry is ever exposed.
  pretium: {
    baseSeconds: 1430,
  },

  workflowTemplate: 'minimax-h3-ref2v',
  workflowTemplateVersion: '1',
  seedInputKey: 'input_seed',
  defaultGenFlags: { batchSize: 1, seedStrategy: 'shuffle', seedPlaceholder: 42, privateMode: false, vramGb: 48 },

  natum: new Date('2026-09-01'),
  mutatum: new Date('2026-09-01'),
}

export const CANONICAL_ESSENTIAE: Essentia[] = [
  ESSENTIA_RUNMAKE_FLUX_SCHNELL,
  ESSENTIA_RUNMAKE_SD15,
  ESSENTIA_RUNMAKE_SDXL,
  ESSENTIA_RUNMAKE_CHROMA,
  ESSENTIA_RUNMAKE_ZIMAGE_TURBO,
  ESSENTIA_RUNMAKE_KREA_TURBO,
  ESSENTIA_FLUXI2I,
  ESSENTIA_KONTEXTEDIT,
  ESSENTIA_KLEINEDIT,
  ESSENTIA_KLEINEDIT_4B,
  ESSENTIA_KLEIN,
  ESSENTIA_RMBG,
  ESSENTIA_UPSCALE,
  ESSENTIA_QWEN3_VL,
  ESSENTIA_QWEN3_VL_CAPTION,
  ESSENTIA_MOSS_MUSIC,
  ESSENTIA_SHOTVL,
  ESSENTIA_HEARTMULA,
  ESSENTIA_HUNYUAN3D,
  ESSENTIA_LTX_T2V,
  ESSENTIA_LTX_I2V,
  ESSENTIA_WAN22_T2V,
  ESSENTIA_WAN22_I2V,
  ESSENTIA_MINIMAX_H3_T2V,
  ESSENTIA_MINIMAX_H3_FL2V,
  ESSENTIA_MINIMAX_H3_REF2V,
]
