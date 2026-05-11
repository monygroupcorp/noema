import type { Intella } from '../../types/intelligendi.js'

// =============================================================================
// Canonical Intellae — platform base models
//
// These are the platform-owned compute substrates. Every canonical Essentia
// points to one of these via intellaId. LoRA Intellae point to one of these
// via baseIntellaId.
//
// Source order convention:
//   [0] models.miladystation2.net — our R2 mirror (always first when cached)
//   [1+] public origins — HuggingFace, CivitAI, etc.
// =============================================================================

export const INTELLA_FLUX_SCHNELL: Intella = {
  id: 'intella.flux-schnell',
  nomen: 'FLUX.1 Schnell',
  genus: 'model',
  architectura: 'dit',
  parametri: 12_000_000_000,
  sources: [
    {
      provenance: 'miladystation',
      uri: 'https://models.miladystation2.net/unet/flux1-schnell.safetensors',
      format: 'safetensors',
    },
    {
      provenance: 'huggingface',
      uri: 'https://huggingface.co/black-forest-labs/FLUX.1-schnell/resolve/main/flux1-schnell.safetensors',
      format: 'safetensors',
      meta: { repo: 'black-forest-labs/FLUX.1-schnell', branch: 'main', filename: 'flux1-schnell.safetensors' },
    },
  ],
  dest: 'unet/flux1-schnell.safetensors',
  sizeGb: 24,
  versio: '1.0.0',
  canonica: true,
  natum: new Date('2025-01-01'),
}

export const INTELLA_FLUX_VAE: Intella = {
  id: 'intella.flux-vae',
  nomen: 'FLUX VAE (ae.safetensors)',
  genus: 'embedding',
  architectura: 'vae',
  parametri: 0,
  sources: [
    {
      provenance: 'miladystation',
      uri: 'https://models.miladystation2.net/vae/ae.safetensors',
      format: 'safetensors',
    },
    {
      provenance: 'huggingface',
      uri: 'https://huggingface.co/black-forest-labs/FLUX.1-schnell/resolve/main/ae.safetensors',
      format: 'safetensors',
      meta: { repo: 'black-forest-labs/FLUX.1-schnell', branch: 'main', filename: 'ae.safetensors' },
    },
  ],
  dest: 'vae/ae.safetensors',
  sizeGb: 0.34,
  versio: '1.0.0',
  canonica: true,
  natum: new Date('2025-01-01'),
}

export const INTELLA_T5XXL: Intella = {
  id: 'intella.t5xxl-fp16',
  nomen: 'T5-XXL FP16 (CLIP encoder)',
  genus: 'embedding',
  architectura: 'transformer',
  parametri: 11_000_000_000,
  sources: [
    {
      provenance: 'miladystation',
      uri: 'https://models.miladystation2.net/clip/t5xxl_fp16.safetensors',
      format: 'safetensors',
    },
    {
      provenance: 'huggingface',
      uri: 'https://huggingface.co/comfyanonymous/flux_text_encoders/resolve/main/t5xxl_fp16.safetensors',
      format: 'safetensors',
      meta: { repo: 'comfyanonymous/flux_text_encoders', branch: 'main', filename: 't5xxl_fp16.safetensors' },
    },
  ],
  dest: 'clip/t5xxl_fp16.safetensors',
  sizeGb: 9.8,
  versio: '1.0.0',
  canonica: true,
  natum: new Date('2025-01-01'),
}

export const INTELLA_CLIP_L: Intella = {
  id: 'intella.clip-l',
  nomen: 'CLIP-L (text encoder)',
  genus: 'embedding',
  architectura: 'transformer',
  parametri: 123_000_000,
  sources: [
    {
      provenance: 'miladystation',
      uri: 'https://models.miladystation2.net/clip/clip_l.safetensors',
      format: 'safetensors',
    },
    {
      provenance: 'huggingface',
      uri: 'https://huggingface.co/comfyanonymous/flux_text_encoders/resolve/main/clip_l.safetensors',
      format: 'safetensors',
      meta: { repo: 'comfyanonymous/flux_text_encoders', branch: 'main', filename: 'clip_l.safetensors' },
    },
  ],
  dest: 'clip/clip_l.safetensors',
  sizeGb: 0.24,
  versio: '1.0.0',
  canonica: true,
  natum: new Date('2025-01-01'),
}

export const CANONICAL_INTELLAE: Intella[] = [
  INTELLA_FLUX_SCHNELL,
  INTELLA_FLUX_VAE,
  INTELLA_T5XXL,
  INTELLA_CLIP_L,
]
