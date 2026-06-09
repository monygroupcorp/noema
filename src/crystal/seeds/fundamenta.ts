import type { Fundamentum } from '../../types/fundamentum.js'

// =============================================================================
// Canonical Fundamenta — the platform's compute-substrate specs (ADR-0005).
//
// A Fundamentum is the provider-neutral environment a family of flows runs on:
// image + runtime + the shared base/support weights + a capacity hint. Essentiae
// reference one by id+versio (see seeds/essentiae.ts). The decomposition of the
// former `Essentia.runpodSpec`: the environment half lives here; each flow keeps
// its own form (workflowTemplate, seedInputKey, cookFlags).
//
// contentHash is omitted — computed/set on first registration (parity with modi).
// =============================================================================

/** FLUX · ComfyUI — the FLUX.1 base stack (unet + vae + dual CLIP). */
export const FUNDAMENTUM_FLUX_COMFYUI: Fundamentum = {
  id: 'flux-comfyui',
  nomen: 'FLUX · ComfyUI',
  versio: '1.0.0',
  contentHash: '',
  imageId: 'runpod/pytorch',
  imageVersion: '2.4.0-py3.11-cuda12.4.1-devel-ubuntu22.04',
  runtime: 'ComfyUI',
  // The shared base/support weights every flux flow sits on. Family ('flux') derives
  // from these weights' `Intella.familia` (the unet base carries it).
  intellae: [
    { id: 'intella.flux-schnell-fp8-scaled', role: 'unet' },
    { id: 'intella.flux-vae',                role: 'vae' },
    { id: 'intella.t5xxl-fp16',              role: 'clip' },
    { id: 'intella.clip-l',                  role: 'clip' },
  ],
  vramGb: 24,
  canonica: true,
  natum: new Date('2025-01-01'),
  mutatum: new Date('2025-01-01'),
}

/** SD1.5 · ComfyUI — the self-contained Stable Diffusion 1.5 checkpoint. */
export const FUNDAMENTUM_SD15_COMFYUI: Fundamentum = {
  id: 'sd15-comfyui',
  nomen: 'SD1.5 · ComfyUI',
  versio: '1.0.0',
  contentHash: '',
  imageId: 'runpod/pytorch',
  imageVersion: '2.4.0-py3.11-cuda12.4.1-devel-ubuntu22.04',
  runtime: 'ComfyUI',
  intellae: [
    { id: 'intella.sd15-v1-5', role: 'checkpoint' },
  ],
  vramGb: 8,
  canonica: true,
  natum: new Date('2025-01-01'),
  mutatum: new Date('2025-01-01'),
}

/** All canonical fundamenta — seeded on boot (parity with CANONICAL_ESSENTIAE). */
export const CANONICAL_FUNDAMENTA: Fundamentum[] = [
  FUNDAMENTUM_FLUX_COMFYUI,
  FUNDAMENTUM_SD15_COMFYUI,
]
