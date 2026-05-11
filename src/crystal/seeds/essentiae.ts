import type { Essentia } from '../../types/essendi.js'

// =============================================================================
// Canonical Essentiae — platform atomic operations
//
// Each Essentia is the crystal representation of a platform tool.
// intellaId points to the base model Intella required to run it.
// runpodSpec carries the container + workflow template reference.
//
// contentHash is omitted here — computed and set on first registration
// via hashModus() in Phase 2. Left undefined in seeds for staging.
// =============================================================================

export const ESSENTIA_RUNMAKE_FLUX_SCHNELL: Essentia = {
  id: 'runmake.flux-schnell',
  nomen: 'FLUX Schnell — text to image',
  genus: 'atomicus',
  versio: '1.0.0',
  contentHash: '',        // set on registration via hashModus()
  ministerium: 'runpod',
  canonica: true,
  categoria: 'image',

  intellaId: 'intella.flux-schnell',

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

export const CANONICAL_ESSENTIAE: Essentia[] = [
  ESSENTIA_RUNMAKE_FLUX_SCHNELL,
]
