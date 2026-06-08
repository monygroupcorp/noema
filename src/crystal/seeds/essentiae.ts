import type { Essentia } from '../../types/essendi.js'

// =============================================================================
// Canonical Essentiae — platform atomic operations
//
// Each Essentia is the crystal representation of a platform tool.
// intellae[] is the weight manifest — the Intellae the flow downloads.
// runpodSpec carries the container + workflow template reference.
//
// contentHash is omitted here — computed and set on first registration
// via hashModus() in Phase 2. Left undefined in seeds for staging.
// =============================================================================

export const ESSENTIA_RUNMAKE_FLUX_SCHNELL: Essentia = {
  id: 'flux-schnell',
  nomen: 'FLUX Schnell — text to image',
  genus: 'atomicus',
  versio: '1.0.0',
  contentHash: '',        // set on registration via hashModus()
  ministerium: 'runpod',
  canonica: true,
  categoria: 'image',

  // The flow's weight manifest — what it downloads. Family is DERIVED from these
  // weights' `Intella.familia` (the unet base carries 'flux').
  intellae: [
    { id: 'intella.flux-schnell-fp8-scaled', role: 'unet' },
    { id: 'intella.flux-vae',                role: 'vae' },
    { id: 'intella.t5xxl-fp16',              role: 'clip' },
    { id: 'intella.clip-l',                  role: 'clip' },
  ],

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

  natum: new Date('2025-01-01'),
  mutatum: new Date('2025-01-01'),
}

export const ESSENTIA_RUNMAKE_SD15: Essentia = {
  id: 'sd1-5',
  nomen: 'Stable Diffusion 1.5 — text to image',
  genus: 'atomicus',
  versio: '1.0.0',
  contentHash: '',        // set on registration via hashModus()
  ministerium: 'runpod',
  canonica: true,
  categoria: 'image',

  // The flow's weight manifest — a single self-contained SD1.5 checkpoint.
  // Family ('sd15') is DERIVED from this weight's `Intella.familia`.
  intellae: [
    { id: 'intella.sd15-v1-5', role: 'checkpoint' },
  ],

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

  runpodSpec: {
    imageId: 'runpod/pytorch',
    imageVersion: '2.4.0-py3.11-cuda12.4.1-devel-ubuntu22.04',
    runtime: 'ComfyUI',
    workflowTemplate: 'sd15',
    workflowTemplateVersion: '1',
    seedInputKey: 'input_seed',
    defaultCookFlags: {
      batchSize: 1,
      seedStrategy: 'shuffle',
      seedPlaceholder: 88888888,
      privateMode: false,
      vramGb: 8,
    },
  },

  natum: new Date('2025-01-01'),
  mutatum: new Date('2025-01-01'),
}

export const CANONICAL_ESSENTIAE: Essentia[] = [
  ESSENTIA_RUNMAKE_FLUX_SCHNELL,
  ESSENTIA_RUNMAKE_SD15,
]
