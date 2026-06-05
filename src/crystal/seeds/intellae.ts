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

// ── LLM base models (llama.cpp runtime) ──────────────────────────────────────
// The first non-ComfyUI family. A GGUF chat model served by llama.cpp — deliberately TINY so a
// real pod downloads it in seconds (cheap to spin up). Establishes the second runtime in the
// catalog so /arm + the model explorer become runtime-aware. (Inference needs the llama-server
// pod runner — a GPU sprint; the catalog/UI abstraction lands now.)
export const INTELLA_SMOLLM2_135M: Intella = {
  id: 'intella.smollm2-135m-instruct',
  nomen: 'SmolLM2 135M Instruct (Q8)',
  genus: 'model',
  architectura: 'gguf',
  parametri: 135_000_000,
  sources: [
    {
      provenance: 'huggingface',
      uri: 'https://huggingface.co/HuggingFaceTB/SmolLM2-135M-Instruct-GGUF/resolve/main/smollm2-135m-instruct-q8_0.gguf',
      format: 'gguf',
      meta: { repo: 'HuggingFaceTB/SmolLM2-135M-Instruct-GGUF', branch: 'main', filename: 'smollm2-135m-instruct-q8_0.gguf' },
    },
  ],
  dest: 'gguf/smollm2-135m-instruct-q8_0.gguf',
  sizeGb: 0.145,
  versio: '1.0.0',
  canonica: true,
  natum: new Date('2025-01-01'),
}

// A small, SELF-CONTAINED ComfyUI checkpoint (VAE + CLIP baked into one ~4GB file) — the cheap
// image-gen flow for validation, so we're not downloading FLUX's ~34GB (24GB unet + 9.8GB T5-XXL)
// just to exercise the gen/warm-add plumbing. (Verify the HF URL before a real run — SD1.5 re-host
// paths have shifted since runwayml pulled the original.)
export const INTELLA_SD15: Intella = {
  id: 'intella.sd15-v1-5',
  nomen: 'Stable Diffusion 1.5 (pruned emaonly)',
  genus: 'model',
  architectura: 'sd15',
  parametri: 860_000_000,
  sources: [
    {
      provenance: 'huggingface',
      uri: 'https://huggingface.co/stable-diffusion-v1-5/stable-diffusion-v1-5/resolve/main/v1-5-pruned-emaonly.safetensors',
      format: 'safetensors',
      meta: { repo: 'stable-diffusion-v1-5/stable-diffusion-v1-5', branch: 'main', filename: 'v1-5-pruned-emaonly.safetensors' },
    },
  ],
  dest: 'checkpoints/v1-5-pruned-emaonly.safetensors',
  sizeGb: 4.27,
  versio: '1.0.0',
  canonica: true,
  natum: new Date('2025-01-01'),
}

// A real SD1.5 LoRA (CivitAI "armored dress" v2.0) — tiny (~13.5 MB), so the SD1.5 base filter has a
// LoRA to show and the warm-add `/install` has something cheap to download. Tagged `sd15` so it
// buckets under the SD1.5 flow. (CivitAI downloads may need an API token for the real fetch — that
// auth is part of the URL-import work; the canonical download URL is recorded here.)
export const INTELLA_LORA_ARMORED_DRESS: Intella = {
  id: 'intella.lora.armored-dress',
  nomen: 'Armored Dress (v2.0)',
  genus: 'lora',
  architectura: 'lora',
  parametri: 0,
  sources: [
    {
      provenance: 'civitai',
      uri: 'https://civitai.com/api/download/models/1165788',
      format: 'safetensors',
      meta: { modelId: '92654', modelVersionId: '1165788' },
    },
  ],
  dest: 'loras/armored_dress_V02.safetensors',
  sizeGb: 0.0135,
  versio: '2.0.0',
  trigger: 'gothic armor,armored_dress,armored skirt,gauntlets,breastplate',
  baseIntellaId: 'intella.sd15-v1-5',
  tags: [{ tag: 'sd15', source: 'curator' }, { tag: 'lora', source: 'curator' }],
  canonica: true,
  natum: new Date('2025-01-01'),
}

export const CANONICAL_INTELLAE: Intella[] = [
  INTELLA_FLUX_SCHNELL,
  INTELLA_FLUX_VAE,
  INTELLA_T5XXL,
  INTELLA_CLIP_L,
  INTELLA_SD15,
  INTELLA_SMOLLM2_135M,
  INTELLA_LORA_ARMORED_DRESS,
]
