import type { Intella } from '../../types/intelligendi.js'

// =============================================================================
// Canonical Intellae — platform base models
//
// These are the platform-owned compute substrates. Every canonical Essentia
// lists the ones it needs in its `intellae` weight manifest. LoRA compat keys
// on `familia` (the model-family string), which base weights and their LoRAs
// share identically.
//
// Source order convention:
//   [0] models.miladystation2.net — our R2 mirror (always first when cached)
//   [1+] public origins — HuggingFace, CivitAI, etc.
// =============================================================================

export const INTELLA_FLUX_SCHNELL: Intella = {
  id: 'intella.flux-schnell-fp8-scaled',
  nomen: 'FLUX.1 Schnell (fp8 scaled)',
  license: 'apache-2.0',
  commercialUse: 'yes',
  genus: 'model',
  architectura: 'dit',
  // family — the LoRA-compat key (NOT architectura, which is the structural 'dit')
  familia: 'flux',
  parametri: 12_000_000_000,
  sources: [
    {
      provenance: 'miladystation',
      uri: 'https://models.miladystation2.net/unet/flux1-schnell-fp8-scaled.safetensors',
      format: 'safetensors',
    },
  ],
  dest: 'unet/flux1-schnell-fp8-scaled.safetensors',
  sizeGb: 17,
  versio: '1.0.0',
  canonica: true,
  contentRating: 'sfw',
  natum: new Date('2025-01-01'),
}

export const INTELLA_FLUX_VAE: Intella = {
  id: 'intella.flux-vae',
  nomen: 'FLUX VAE (ae.safetensors)',
  license: 'apache-2.0',            // ships with FLUX.1-schnell (Apache 2.0)
  commercialUse: 'yes',
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
  contentRating: 'sfw',
  natum: new Date('2025-01-01'),
}

export const INTELLA_T5XXL: Intella = {
  id: 'intella.t5xxl-fp16',
  nomen: 'T5-XXL FP16 (CLIP encoder)',
  license: 'apache-2.0',            // Google T5
  commercialUse: 'yes',
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
  contentRating: 'sfw',
  natum: new Date('2025-01-01'),
}

export const INTELLA_CLIP_L: Intella = {
  id: 'intella.clip-l',
  nomen: 'CLIP-L (text encoder)',
  license: 'mit',                   // OpenAI CLIP
  commercialUse: 'yes',
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
  contentRating: 'sfw',
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
  license: 'apache-2.0',            // HuggingFace SmolLM2
  commercialUse: 'yes',
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
  contentRating: 'sfw',
  natum: new Date('2025-01-01'),
}

// A small, SELF-CONTAINED ComfyUI checkpoint (VAE + CLIP baked into one ~4GB file) — the cheap
// image-gen flow for validation, so we're not downloading FLUX's ~34GB (24GB unet + 9.8GB T5-XXL)
// just to exercise the gen/warm-add plumbing. (Verify the HF URL before a real run — SD1.5 re-host
// paths have shifted since runwayml pulled the original.)
export const INTELLA_SD15: Intella = {
  id: 'intella.sd15-v1-5',
  nomen: 'Stable Diffusion 1.5 (pruned emaonly)',
  license: 'openrail-m',           // CreativeML OpenRAIL-M (flow-down use restrictions)
  commercialUse: 'yes',
  genus: 'model',
  architectura: 'sd15',
  // family — the LoRA-compat key. Carries the SAME string as compatible LoRAs
  // (e.g. the Armored Dress LoRA below).
  familia: 'sd15',
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
  contentRating: 'sfw',
  natum: new Date('2025-01-01'),
}

// A real SD1.5 LoRA (CivitAI "armored dress" v2.0) — tiny (~13.5 MB), so the SD1.5 base filter has a
// LoRA to show and the warm-add `/install` has something cheap to download. Tagged `sd15` so it
// buckets under the SD1.5 flow. Mirrored to our R2 (models.miladystation2.net) as source[0] so the
// pod downloads AUTH-FREE — the CivitAI origin (source[1]) needs an API token and would 401 a pod.
export const INTELLA_LORA_ARMORED_DRESS: Intella = {
  id: 'intella.lora.armored-dress',
  nomen: 'Armored Dress (v2.0)',
  license: 'openrail-m',           // SD1.5 derivative → inherits base license
  commercialUse: 'yes',
  genus: 'lora',
  architectura: 'lora',
  parametri: 0,
  sources: [
    {
      provenance: 'miladystation',
      uri: 'https://models.miladystation2.net/loras/armored_dress_V02.safetensors',
      format: 'safetensors',
    },
    {
      provenance: 'civitai',
      uri: 'https://civitai.com/api/download/models/1165788',
      format: 'safetensors',
      meta: { modelId: '92654', modelVersionId: '1165788' },
    },
  ],
  dest: 'loras/armored_dress_V02.safetensors',
  // slug = the on-disk filename stem (models/loras/{slug}.safetensors); REQUIRED — the trigger
  // resolver builds `<lora:{slug}:weight>` and skips any LoRA without one, so omitting it makes
  // the LoRA un-triggerable (the 2026-06-09 live bug).
  slug: 'armored_dress_V02',
  sizeGb: 0.0135,
  versio: '2.0.0',
  trigger: 'gothic armor,armored_dress,armored skirt,gauntlets,breastplate',
  // family — IDENTICAL string to the SD1.5 base above; this is the compat key.
  // baseIntellaId stays as provenance (which exact base it trained on).
  familia: 'sd15',
  baseIntellaId: 'intella.sd15-v1-5',
  description: 'Fantasy armor LoRA — gothic plate armor, gauntlets, breastplate, armored skirt.',
  tags: [{ tag: 'sd15', source: 'curator' }, { tag: 'lora', source: 'curator' }, { tag: 'fantasy armor', source: 'curator' }],
  canonica: true,
  contentRating: 'sfw',
  natum: new Date('2025-01-01'),
}

// SDXL base 1.0 — the canonical SDXL checkpoint (self-contained: model + dual CLIP + VAE in one
// ~6.9GB file, like SD1.5). The canonical `make (sdxl)` flow bakes this; the old bot ran the
// ZavyChromaXL community finetune, but base SDXL is the license-clean, auth-free canonical default.
export const INTELLA_SDXL_BASE: Intella = {
  id: 'intella.sdxl-base-1-0',
  nomen: 'Stable Diffusion XL Base 1.0',
  license: 'openrail-m',           // CreativeML OpenRAIL-M (flow-down use restrictions)
  commercialUse: 'yes',
  genus: 'model',
  architectura: 'sdxl',
  // family — the LoRA-compat key (SDXL LoRAs carry the same 'sdxl' string).
  familia: 'sdxl',
  parametri: 3_500_000_000,
  sources: [
    {
      provenance: 'huggingface',
      uri: 'https://huggingface.co/stabilityai/stable-diffusion-xl-base-1.0/resolve/main/sd_xl_base_1.0.safetensors',
      format: 'safetensors',
      meta: { repo: 'stabilityai/stable-diffusion-xl-base-1.0', branch: 'main', filename: 'sd_xl_base_1.0.safetensors' },
    },
  ],
  dest: 'checkpoints/sd_xl_base_1.0.safetensors',
  sizeGb: 6.94,
  versio: '1.0.0',
  canonica: true,
  contentRating: 'sfw',
  natum: new Date('2025-01-01'),
}

// Chroma (unlocked v35) — an 8.9B Apache-2.0 model architecturally FLUX-adjacent (a DiT unet loaded
// via UNETLoader). It reuses the FLUX support stack: the T5-XXL text encoder (intella.t5xxl-fp16,
// via a CLIPLoader with type 'chroma') and the FLUX VAE (intella.flux-vae). Only the unet is new.
export const INTELLA_CHROMA: Intella = {
  id: 'intella.chroma-unlocked-v35',
  nomen: 'Chroma (unlocked v35)',
  license: 'apache-2.0',
  commercialUse: 'yes',
  genus: 'model',
  architectura: 'dit',
  familia: 'chroma',
  parametri: 8_900_000_000,
  sources: [
    {
      provenance: 'huggingface',
      uri: 'https://huggingface.co/lodestones/Chroma/resolve/main/chroma-unlocked-v35.safetensors',
      format: 'safetensors',
      meta: { repo: 'lodestones/Chroma', branch: 'main', filename: 'chroma-unlocked-v35.safetensors' },
    },
  ],
  dest: 'unet/chroma-unlocked-v35.safetensors',
  sizeGb: 17.8,
  versio: '1.0.0',
  canonica: true,
  contentRating: 'sfw',
  natum: new Date('2025-01-01'),
}

// FLUX.1 Kontext [dev] — the instruction-edit DiT (fp8 scaled). Sits on the same FLUX support stack as
// the other flux flows (reuses intella.t5xxl-fp16 + intella.clip-l + intella.flux-vae); only the unet is
// new. URL VERIFIED 200 (Comfy-Org fp8 mirror, ungated — no token needed) on 2026-06-19.
export const INTELLA_FLUX_KONTEXT_DEV: Intella = {
  id: 'intella.flux-kontext-dev',
  nomen: 'FLUX.1 Kontext [dev] (fp8 scaled)',
  license: 'flux-1-dev-nc',        // BFL Non-Commercial — NOT catalog-eligible without a BFL license
  commercialUse: 'no',
  genus: 'model',
  architectura: 'dit',
  familia: 'flux',
  parametri: 12_000_000_000,
  sources: [
    {
      provenance: 'huggingface',
      uri: 'https://huggingface.co/Comfy-Org/flux1-kontext-dev_ComfyUI/resolve/main/diffusion_models/flux1-dev-kontext_fp8_scaled.safetensors',
      format: 'safetensors',
      meta: { repo: 'Comfy-Org/flux1-kontext-dev_ComfyUI', branch: 'main', filename: 'diffusion_models/flux1-dev-kontext_fp8_scaled.safetensors' },
    },
  ],
  dest: 'unet/flux1-kontext-dev.safetensors',
  sizeGb: 11.9,
  versio: '1.0.0',
  canonica: true,
  contentRating: 'sfw',
  natum: new Date('2025-01-01'),
}

// ── FLUX.2 Klein 9B stack (ADR: a NEW family — not FLUX.1) ───────────────────
// FLUX.2 is a distinct architecture: a Qwen3 text encoder (CLIPLoader type 'flux2', NOT dual-CLIP) +
// its own VAE. FLUX.1 LoRAs do NOT apply → familia 'flux2' (separate compat key). Dest dirs are the
// FLUX.2 ComfyUI layout: diffusion_models/, text_encoders/, vae/. URLs are from the official Comfy-Org
// workflow_templates Klein-9B edit template.
// URL STATUS (2026-06-19): qwen3-8b + flux2-vae VERIFIED 200 (ungated). The klein-9b diffusion weight is
// `gated: auto` on BFL → 403 until the HF account accepts the gate once (then auto-granted). BUT the pod
// downloader (comfyrunner.py) uses plain unauthenticated wget, so gated HF URLs won't fetch on a pod
// regardless. ACTION before a real run: mirror flux-2-klein-9b-fp8 to our R2 (models.miladystation2.net)
// and make that source[0] — the established auth-free pattern (see INTELLA_FLUX_SCHNELL et al.).
export const INTELLA_FLUX2_KLEIN_9B: Intella = {
  id: 'intella.flux2-klein-9b',
  nomen: 'FLUX.2 Klein 9B (fp8)',
  license: 'flux-2-dev-nc',        // ONLY klein 4B is Apache; 9B is the FLUX Non-Commercial License (see modelLicense.ts)
  commercialUse: 'no',
  genus: 'model',
  architectura: 'dit',
  familia: 'flux2',
  parametri: 9_000_000_000,
  sources: [
    {
      provenance: 'huggingface',
      uri: 'https://huggingface.co/black-forest-labs/FLUX.2-klein-9b-fp8/resolve/main/flux-2-klein-9b-fp8.safetensors',
      format: 'safetensors',
      meta: { repo: 'black-forest-labs/FLUX.2-klein-9b-fp8', branch: 'main', filename: 'flux-2-klein-9b-fp8.safetensors' },
    },
  ],
  dest: 'diffusion_models/flux-2-klein-9b-fp8.safetensors',
  sizeGb: 9.5,
  versio: '1.0.0',
  canonica: true,
  contentRating: 'sfw',
  natum: new Date('2025-01-01'),
}

export const INTELLA_QWEN3_8B_FLUX2: Intella = {
  id: 'intella.qwen3-8b-flux2',
  nomen: 'Qwen3 8B (FLUX.2 text encoder, fp8 mixed)',
  license: 'apache-2.0',           // Qwen3 (Apache 2.0)
  commercialUse: 'yes',
  genus: 'embedding',
  architectura: 'transformer',
  parametri: 8_000_000_000,
  sources: [
    {
      provenance: 'huggingface',
      uri: 'https://huggingface.co/Comfy-Org/flux2-klein-9B/resolve/main/text_encoders/qwen_3_8b_fp8mixed.safetensors',
      format: 'safetensors',
      meta: { repo: 'Comfy-Org/flux2-klein-9B', branch: 'main', filename: 'text_encoders/qwen_3_8b_fp8mixed.safetensors' },
    },
  ],
  dest: 'text_encoders/qwen_3_8b_fp8mixed.safetensors',
  sizeGb: 9.0,
  versio: '1.0.0',
  canonica: true,
  contentRating: 'sfw',
  natum: new Date('2025-01-01'),
}

// The 4B Klein DiT pairs with a Qwen3-*4B* text encoder (hidden 2560 → txt_in dim
// 7680), NOT the 9B's qwen3-8b (hidden 4096 → 12288). Loading the 8B TE against the
// 4B model fails in `txt_in` with a (…x12288 vs 7680x…) matmul shape mismatch. This
// is the matching encoder from the official Comfy-Org klein-4b bundle.
export const INTELLA_QWEN3_4B_FLUX2: Intella = {
  id: 'intella.qwen3-4b-flux2',
  nomen: 'Qwen3 4B (FLUX.2 Klein 4B text encoder)',
  license: 'apache-2.0',           // Qwen3 (Apache 2.0)
  commercialUse: 'yes',
  genus: 'embedding',
  architectura: 'transformer',
  parametri: 4_000_000_000,
  sources: [
    {
      provenance: 'huggingface',
      uri: 'https://huggingface.co/Comfy-Org/vae-text-encorder-for-flux-klein-4b/resolve/main/text_encoders/qwen_3_4b.safetensors',
      format: 'safetensors',
      meta: { repo: 'Comfy-Org/vae-text-encorder-for-flux-klein-4b', branch: 'main', filename: 'text_encoders/qwen_3_4b.safetensors' },
    },
  ],
  dest: 'text_encoders/qwen_3_4b.safetensors',
  sizeGb: 8.0,
  versio: '1.0.0',
  canonica: true,
  contentRating: 'sfw',
  natum: new Date('2026-06-30'),
}

export const INTELLA_FLUX2_VAE_FULL: Intella = {
  id: 'intella.flux2-vae-full-encoder',
  nomen: 'FLUX.2 VAE (full encoder, small decoder)',
  license: 'apache-2.0',           // ships with FLUX.2 Klein (Apache 2.0)
  commercialUse: 'yes',
  genus: 'embedding',
  architectura: 'vae',
  parametri: 0,
  sources: [
    {
      provenance: 'huggingface',
      uri: 'https://huggingface.co/black-forest-labs/FLUX.2-small-decoder/resolve/main/full_encoder_small_decoder.safetensors',
      format: 'safetensors',
      meta: { repo: 'black-forest-labs/FLUX.2-small-decoder', branch: 'main', filename: 'full_encoder_small_decoder.safetensors' },
    },
  ],
  dest: 'vae/full_encoder_small_decoder.safetensors',
  sizeGb: 0.4,
  versio: '1.0.0',
  canonica: true,
  contentRating: 'sfw',
  natum: new Date('2025-01-01'),
}

// ── Z-Image Turbo stack (Alibaba Tongyi, 6B S3-DiT, Apache-2.0) ──────────────
// The 8-step distilled turbo for fast inference. Apache-clean (ungated). The DiT loads via UNETLoader;
// its text encoder is Qwen3-4B and it REUSES the FLUX VAE (intella.flux-vae, ae.safetensors) — so only
// the unet + the Qwen3-4B encoder are new here. familia 'zimage' is the LoRA-compat key: a LoRA trained
// on Z-Image (baseModel 'zimage' → familia 'zimage', canonicalFamilia()) stacks on this base via the
// Coziness MultiLoraLoader.
// CLIPLoader type: ComfyUI has no 'z_image' type — it auto-detects the qwen_3_4b encoder as TEModel
// QWEN3_4B and routes ANY non-flux clip_type to z_image.te (comfy/sd.py). So the workflow uses 'lumina2'
// (Z-Image's architectural parent, a valid type) — VERIFIED on an H100 staging pod 2026-06-26.
// SOURCES: our R2 mirror first (auth-free, our custody — scripts/mirror-weights.mjs), Comfy-Org HF
// (the upstream ComfyUI repackage, ungated, verified 200) as fallback.
export const INTELLA_ZIMAGE_TURBO: Intella = {
  id: 'intella.z-image-turbo',
  nomen: 'Z-Image Turbo (bf16)',
  license: 'apache-2.0',
  commercialUse: 'yes',
  genus: 'model',
  architectura: 'dit',
  familia: 'zimage',
  parametri: 6_000_000_000,
  sources: [
    {
      provenance: 'miladystation',
      uri: 'https://models.miladystation2.net/diffusion_models/z_image_turbo_bf16.safetensors',
      format: 'safetensors',
    },
    {
      provenance: 'huggingface',
      uri: 'https://huggingface.co/Comfy-Org/z_image_turbo/resolve/main/diffusion_models/z_image_turbo_bf16.safetensors',
      format: 'safetensors',
      meta: { repo: 'Comfy-Org/z_image_turbo', branch: 'main', filename: 'diffusion_models/z_image_turbo_bf16.safetensors' },
    },
  ],
  dest: 'diffusion_models/z_image_turbo_bf16.safetensors',
  sizeGb: 12.3,
  versio: '1.0.0',
  canonica: true,
  contentRating: 'sfw',
  natum: new Date('2026-06-26'),
}

export const INTELLA_QWEN3_4B_ZIMAGE: Intella = {
  id: 'intella.qwen3-4b',
  nomen: 'Qwen3 4B (Z-Image text encoder)',
  license: 'apache-2.0',           // Qwen3 (Apache 2.0)
  commercialUse: 'yes',
  genus: 'embedding',
  architectura: 'transformer',
  parametri: 4_000_000_000,
  sources: [
    {
      provenance: 'miladystation',
      uri: 'https://models.miladystation2.net/clip/qwen_3_4b.safetensors',
      format: 'safetensors',
    },
    {
      provenance: 'huggingface',
      uri: 'https://huggingface.co/Comfy-Org/z_image_turbo/resolve/main/text_encoders/qwen_3_4b.safetensors',
      format: 'safetensors',
      meta: { repo: 'Comfy-Org/z_image_turbo', branch: 'main', filename: 'text_encoders/qwen_3_4b.safetensors' },
    },
  ],
  dest: 'clip/qwen_3_4b.safetensors',
  sizeGb: 8,
  versio: '1.0.0',
  canonica: true,
  contentRating: 'sfw',
  natum: new Date('2026-06-26'),
}

// ── Krea 2 Turbo stack (12.9B single_mmdit_large_wide, Krea 2 Community License) ──────────────
// The 8-step distilled turbo. Qwen3-VL-4B text encoder + the Qwen-Image VAE (qwen_image_vae.safetensors).
// CLIPLoader type MUST be 'krea2': ComfyUI detects the qwen3vl_4b encoder as TEModel QWEN3VL_4B and only
// routes it to krea2.te when clip_type == KREA2 (comfy/sd.py:1633); any other type falls back to the
// klein encoder (wrong). familia 'krea2' is the LoRA-compat key: a LoRA trained on Krea 2 RAW (baseModel
// 'krea2'/'krea-turbo' → familia 'krea2' via canonicalFamilia()) stacks on Turbo.
// LICENSE: Krea 2 Community License (commercial use only for entities under $1M annual revenue).
// SOURCES: our R2 mirror first, the official ungated Comfy-Org/Krea-2 ComfyUI repackage (fp8_scaled) as
// fallback (verified 200, gated:false). fp8_scaled fits a 24GB card.
export const INTELLA_KREA2_TURBO: Intella = {
  id: 'intella.krea-2-turbo',
  nomen: 'Krea 2 Turbo (fp8 scaled)',
  license: 'krea-community',        // Krea 2 Community — commercial only under the <$1M-revenue threshold
  commercialUse: 'conditional',
  genus: 'model',
  architectura: 'dit',
  familia: 'krea2',
  parametri: 12_900_000_000,
  sources: [
    {
      provenance: 'miladystation',
      uri: 'https://models.miladystation2.net/diffusion_models/krea2_turbo_fp8_scaled.safetensors',
      format: 'safetensors',
    },
    {
      provenance: 'huggingface',
      uri: 'https://huggingface.co/Comfy-Org/Krea-2/resolve/main/diffusion_models/krea2_turbo_fp8_scaled.safetensors',
      format: 'safetensors',
      meta: { repo: 'Comfy-Org/Krea-2', branch: 'main', filename: 'diffusion_models/krea2_turbo_fp8_scaled.safetensors' },
    },
  ],
  dest: 'diffusion_models/krea2_turbo_fp8_scaled.safetensors',
  sizeGb: 13.1,
  versio: '1.0.0',
  canonica: true,
  contentRating: 'sfw',
  natum: new Date('2026-06-26'),
}

export const INTELLA_QWEN3_VL_4B_KREA: Intella = {
  id: 'intella.qwen3-vl-4b',
  nomen: 'Qwen3-VL 4B (Krea 2 text encoder, fp8 scaled)',
  license: 'apache-2.0',           // Qwen3-VL (Apache 2.0)
  commercialUse: 'yes',
  genus: 'embedding',
  architectura: 'transformer',
  parametri: 4_000_000_000,
  sources: [
    {
      provenance: 'miladystation',
      uri: 'https://models.miladystation2.net/clip/qwen3vl_4b_fp8_scaled.safetensors',
      format: 'safetensors',
    },
    {
      provenance: 'huggingface',
      uri: 'https://huggingface.co/Comfy-Org/Krea-2/resolve/main/text_encoders/qwen3vl_4b_fp8_scaled.safetensors',
      format: 'safetensors',
      meta: { repo: 'Comfy-Org/Krea-2', branch: 'main', filename: 'text_encoders/qwen3vl_4b_fp8_scaled.safetensors' },
    },
  ],
  dest: 'clip/qwen3vl_4b_fp8_scaled.safetensors',
  sizeGb: 5.2,
  versio: '1.0.0',
  canonica: true,
  contentRating: 'sfw',
  natum: new Date('2026-06-26'),
}

export const INTELLA_QWEN_IMAGE_VAE: Intella = {
  id: 'intella.qwen-image-vae',
  nomen: 'Qwen-Image VAE',
  license: 'apache-2.0',           // Qwen-Image (Apache 2.0)
  commercialUse: 'yes',
  genus: 'embedding',
  architectura: 'vae',
  parametri: 0,
  sources: [
    {
      provenance: 'miladystation',
      uri: 'https://models.miladystation2.net/vae/qwen_image_vae.safetensors',
      format: 'safetensors',
    },
    {
      provenance: 'huggingface',
      uri: 'https://huggingface.co/Comfy-Org/Krea-2/resolve/main/vae/qwen_image_vae.safetensors',
      format: 'safetensors',
      meta: { repo: 'Comfy-Org/Krea-2', branch: 'main', filename: 'vae/qwen_image_vae.safetensors' },
    },
  ],
  dest: 'vae/qwen_image_vae.safetensors',
  sizeGb: 0.25,
  versio: '1.0.0',
  canonica: true,
  contentRating: 'sfw',
  natum: new Date('2026-06-26'),
}

// 4x-UltraSharp — an ESRGAN super-resolution model (~67MB) for the pack-free, model-only upscale flow
// (core UpscaleModelLoader + ImageUpscaleWithModel; no UltimateSDUpscale, no checkpoint). Not a
// generative base → no `familia` (carries no LoRA-compat). (Verify the HF mirror URL before a real run.)
export const INTELLA_UPSCALE_ULTRASHARP: Intella = {
  id: 'intella.upscale-4x-ultrasharp',
  nomen: '4x-UltraSharp (ESRGAN upscaler)',
  license: 'unknown',              // upscaler license unverified — fail-closed pending clearance
  commercialUse: 'unknown',
  genus: 'model',
  architectura: 'esrgan',
  parametri: 0,
  sources: [
    {
      provenance: 'huggingface',
      uri: 'https://huggingface.co/lokCX/4x-Ultrasharp/resolve/main/4x-UltraSharp.pth',
      format: 'pt',
      meta: { repo: 'lokCX/4x-Ultrasharp', branch: 'main', filename: '4x-UltraSharp.pth' },
    },
  ],
  dest: 'upscale_models/4x-UltraSharp.pth',
  sizeGb: 0.067,
  versio: '1.0.0',
  canonica: true,
  contentRating: 'sfw',
  natum: new Date('2025-01-01'),
}

// ── Understanding-track LMs (vLLM/transformers runtime) — ADR-0007 ───────────
// The 3 "read a new medium → text" models. Each is a WHOLE HuggingFace repo (multi-file:
// sharded safetensors + config + tokenizer), not a single file — the TransformersVllmExecutor
// downloads the repo via `huggingface-cli download {meta.repo}` into `dest`. NOTE: the single-file
// `sources[].uri`/`format` shape and the ComfyUI-relative `dest` are an imperfect fit for repos
// (an Intella repo-download follow-up); modeled here as catalog records so the 3 flows are
// discoverable now, ahead of the executor + the Compiler's non-ComfyUI branch.
export const INTELLA_QWEN3_VL_8B: Intella = {
  id: 'intella.qwen3-vl-8b',
  nomen: 'Qwen3-VL 8B Instruct',
  license: 'apache-2.0',           // Qwen3-VL (Apache 2.0)
  commercialUse: 'yes',
  genus: 'model',
  architectura: 'qwen3-vl',
  parametri: 8_000_000_000,
  sources: [
    {
      provenance: 'huggingface',
      uri: 'https://huggingface.co/Qwen/Qwen3-VL-8B-Instruct',
      meta: { repo: 'Qwen/Qwen3-VL-8B-Instruct', branch: 'main' },
    },
  ],
  dest: 'transformers/qwen3-vl-8b',   // ⚠ executor-relative dir (not ComfyUI models/) — Gap: model_dest
  sizeGb: 18,
  versio: '1.0.0',
  canonica: true,
  contentRating: 'sfw',
  natum: new Date('2026-06-11'),
}

export const INTELLA_MOSS_MUSIC_8B: Intella = {
  id: 'intella.moss-music-8b',
  nomen: 'MOSS-Music 8B Instruct',
  license: 'unknown',              // MOSS-Music license unverified — fail-closed pending clearance
  commercialUse: 'unknown',
  genus: 'model',
  architectura: 'qwen3-audio',   // Qwen3-8B backbone + audio encoder
  parametri: 9_100_000_000,
  sources: [
    {
      provenance: 'huggingface',
      uri: 'https://huggingface.co/OpenMOSS-Team/MOSS-Music-8B-Instruct',
      meta: { repo: 'OpenMOSS-Team/MOSS-Music-8B-Instruct', branch: 'main' },
    },
  ],
  dest: 'transformers/moss-music-8b',
  sizeGb: 18,
  versio: '1.0.0',
  canonica: true,
  contentRating: 'sfw',
  natum: new Date('2026-06-11'),
}

export const INTELLA_SHOTVL_7B: Intella = {
  id: 'intella.shotvl-7b',
  nomen: 'ShotVL 7B (cinematography)',
  license: 'unknown',              // third-party Qwen2.5-VL fine-tune; own terms unverified — fail-closed
  commercialUse: 'unknown',
  genus: 'model',
  architectura: 'qwen2.5-vl',   // fine-tune of Qwen2.5-VL-7B-Instruct
  parametri: 8_000_000_000,
  sources: [
    {
      provenance: 'huggingface',
      uri: 'https://huggingface.co/Vchitect/ShotVL-7B',
      meta: { repo: 'Vchitect/ShotVL-7B', branch: 'main' },
    },
  ],
  dest: 'transformers/shotvl-7b',
  sizeGb: 16,
  versio: '1.0.0',
  canonica: true,
  contentRating: 'sfw',
  natum: new Date('2026-06-11'),
}

// ── Generation track — HeartMuLa (text→music), python-modelcard runtime (ADR-0007) ──────────
// HeartMuLa runs from a cloned `heartlib` repo; its 3 weight repos download into the repo's ./ckpt
// tree (dest is repo-relative). Multi-file HF repos (like the understanding LMs) — the executor
// pulls each via `hf download <repo> --local-dir <dest>`.
export const INTELLA_HEARTMULA_GEN: Intella = {
  id: 'intella.heartmula-gen',
  nomen: 'HeartMuLa Gen (config + tokenizer)',
  license: 'unknown',              // HeartMuLa license unverified — fail-closed pending clearance
  commercialUse: 'unknown',
  genus: 'model',
  architectura: 'heartmula',
  parametri: 0,
  sources: [{ provenance: 'huggingface', uri: 'https://huggingface.co/HeartMuLa/HeartMuLaGen',
              meta: { repo: 'HeartMuLa/HeartMuLaGen', branch: 'main' } }],
  dest: 'ckpt',
  sizeGb: 0.1,
  versio: '1.0.0',
  canonica: true,
  contentRating: 'sfw',
  natum: new Date('2026-06-12'),
}

export const INTELLA_HEARTMULA_3B: Intella = {
  id: 'intella.heartmula-3b',
  nomen: 'HeartMuLa 3B',
  license: 'unknown',              // HeartMuLa license unverified — fail-closed pending clearance
  commercialUse: 'unknown',
  genus: 'model',
  architectura: 'heartmula',
  parametri: 4_000_000_000,
  sources: [{ provenance: 'huggingface', uri: 'https://huggingface.co/HeartMuLa/HeartMuLa-oss-3B-happy-new-year',
              meta: { repo: 'HeartMuLa/HeartMuLa-oss-3B-happy-new-year', branch: 'main' } }],
  dest: 'ckpt/HeartMuLa-oss-3B',
  sizeGb: 8,
  versio: '1.0.0',
  canonica: true,
  contentRating: 'sfw',
  natum: new Date('2026-06-12'),
}

export const INTELLA_HEARTCODEC: Intella = {
  id: 'intella.heartcodec',
  nomen: 'HeartCodec (audio decoder)',
  license: 'unknown',              // HeartMuLa stack — license unverified — fail-closed pending clearance
  commercialUse: 'unknown',
  genus: 'embedding',
  architectura: 'codec',
  parametri: 0,
  sources: [{ provenance: 'huggingface', uri: 'https://huggingface.co/HeartMuLa/HeartCodec-oss-20260123',
              meta: { repo: 'HeartMuLa/HeartCodec-oss-20260123', branch: 'main' } }],
  dest: 'ckpt/HeartCodec-oss',
  sizeGb: 2,
  versio: '1.0.0',
  canonica: true,
  contentRating: 'sfw',
  natum: new Date('2026-06-12'),
}

// FLUX.2 Klein 4B (fp8) — the smaller DiT (~4.5GB), fits a 24GB 4090 with VRAM to spare for a LoRA.
// Same FLUX.2 stack as the 9B (Qwen3-8B TE + flux2 VAE shared); only the diffusion model differs.
// This is the base our `impresstation-klein` LoRA was trained on (ai-toolkit on klein-base-4B).
export const INTELLA_FLUX2_KLEIN_4B: Intella = {
  id: 'intella.flux2-klein-4b',
  nomen: 'FLUX.2 Klein 4B (fp8)',
  license: 'apache-2.0',           // FLUX.2 Klein 4B is Apache 2.0 (ADR-0012)
  commercialUse: 'yes',
  genus: 'model',
  architectura: 'dit',
  familia: 'flux2',
  parametri: 4_000_000_000,
  sources: [
    {
      provenance: 'huggingface',
      uri: 'https://huggingface.co/black-forest-labs/FLUX.2-klein-4b-fp8/resolve/main/flux-2-klein-4b-fp8.safetensors',
      format: 'safetensors',
      meta: { repo: 'black-forest-labs/FLUX.2-klein-4b-fp8', branch: 'main', filename: 'flux-2-klein-4b-fp8.safetensors' },
    },
  ],
  dest: 'diffusion_models/flux-2-klein-4b-fp8.safetensors',
  sizeGb: 4.5,
  versio: '1.0.0',
  canonica: true,
  contentRating: 'sfw',
  natum: new Date('2026-06-30'),
}

// impresstation (stationthis) — our flagship FLUX.2 Klein LoRA: a low-poly PlayStation-screenshot
// style. Trained via ai-toolkit on klein-base-4B; trigger `stationthis`. Public + canonica so the
// loraResolver always knows the slug (Pass-1 passes through an explicit `<lora:impresstation_klein:…>`
// tag). Hosted on our HF org (noema-art). defaultWeight 1.05 = the dialed-in strength.
export const INTELLA_IMPRESSTATION_KLEIN: Intella = {
  id: 'intella.impresstation-klein',
  nomen: 'stationthis (PS2 low-poly) · FLUX.2 Klein LoRA',
  license: 'apache-2.0',           // our own LoRA on Klein 4B (Apache 2.0); noema owns it
  commercialUse: 'yes',
  genus: 'lora',
  architectura: 'lora',
  familia: 'flux2',
  baseIntellaId: 'intella.flux2-klein-4b',
  parametri: 0,
  sources: [
    {
      provenance: 'huggingface',
      uri: 'https://huggingface.co/noema-art/impresstation-klein/resolve/main/impresstation_klein.safetensors',
      format: 'safetensors',
      meta: { repo: 'noema-art/impresstation-klein', branch: 'main', filename: 'impresstation_klein.safetensors' },
    },
  ],
  dest: 'loras/impresstation_klein.safetensors',
  slug: 'impresstation_klein',
  trigger: 'stationthis',
  defaultWeight: 1.05,
  sizeGb: 0.2,
  versio: '1.0.0',
  description: 'PS2-era low-poly retro game aesthetic — PlayStation-screenshot style.',
  tags: [{ tag: 'flux2', source: 'curator' }, { tag: 'lora', source: 'curator' }, { tag: 'low-poly', source: 'curator' }],
  canonica: true,
  contentRating: 'sfw',
  natum: new Date('2026-06-30'),
}

// ── LTX 2.3 · video (T2V + I2V) ───────────────────────────────────────────────
// The all-in-one bf16 transformer+VAE bundle (46.15GB) — CheckpointLoaderSimple loads it directly
// (no separate VAE Intella needed, unlike the flux/sd15 split). familia 'ltx' set per the sd15/flux
// pattern even though v1 has no LoRA path (INTELLA_LTX_23_DISTILLED_LORA is a future add) — keeps the
// compat key ready for when a LoRA lands. License: LTX-2 Community (commercial free under $10M ARR).
export const INTELLA_LTX_23_DISTILLED: Intella = {
  id: 'intella.ltx-2.3-distilled',
  nomen: 'LTX 2.3 22B distilled (bf16, transformer+VAE bundle)',
  license: 'ltx-2-community',       // LTX-2 Community License — commercial use free under $10M ARR
  commercialUse: 'conditional',
  genus: 'model',
  architectura: 'transformer',
  familia: 'ltx',
  parametri: 22_000_000_000,
  sources: [
    {
      provenance: 'huggingface',
      uri: 'https://huggingface.co/Lightricks/LTX-2.3/resolve/main/ltx-2.3-22b-distilled.safetensors',
      format: 'safetensors',
      meta: { repo: 'Lightricks/LTX-2.3', branch: 'main', filename: 'ltx-2.3-22b-distilled.safetensors' },
    },
  ],
  dest: 'checkpoints/ltx-2.3-22b-distilled.safetensors',
  sizeGb: 46.15,
  versio: '1.0.0',
  canonica: true,
  contentRating: 'sfw',
  natum: new Date('2026-07-07'),
}

// The Gemma-3-12B text encoder LTX-2.3 uses (LTXAVTextEncoderLoader, ComfyUI-native since 0.14).
// A SEPARATE weight from the checkpoint bundle above — 2 Intellae total for the LTX fundament.
export const INTELLA_GEMMA_3_12B: Intella = {
  id: 'intella.gemma-3-12b',
  nomen: 'Gemma 3 12B IT (bf16, LTX-2.3 text encoder)',
  license: 'gemma',                 // Google Gemma license (permissive, some use restrictions)
  commercialUse: 'yes',
  genus: 'embedding',
  architectura: 'transformer',
  parametri: 12_000_000_000,
  sources: [
    {
      provenance: 'huggingface',
      uri: 'https://huggingface.co/Comfy-Org/ltx-2/resolve/main/text_encoders/gemma_3_12B_it.safetensors',
      format: 'safetensors',
      meta: { repo: 'Comfy-Org/ltx-2', branch: 'main', filename: 'text_encoders/gemma_3_12B_it.safetensors' },
    },
  ],
  dest: 'text_encoders/gemma_3_12B_it.safetensors',
  sizeGb: 24.4,
  versio: '1.0.0',
  canonica: true,
  contentRating: 'sfw',
  natum: new Date('2026-07-07'),
}

// Wan2.2 · video (T2V + I2V) — MoE pair of diffusion unets per direction (high-noise steers the
// first half of the denoise trajectory, low-noise finishes it — KSamplerAdvanced split at step 10).
// Both directions share the umt5 text encoder + the Wan2.1 VAE (Wan2.2 14B reuses it). Render-proven
// on this box (both t2v and i2v produced real mp4s) — see wan-artifacts/*.api.json for the graphs.
export const INTELLA_WAN22_T2V_HIGH: Intella = {
  id: 'intella.wan22-t2v-high',
  nomen: 'Wan2.2 T2V — high-noise unet (14B, fp8 scaled)',
  license: 'apache-2.0',
  commercialUse: 'yes',
  genus: 'model',
  architectura: 'dit',
  familia: 'wan22-t2v',
  parametri: 14_000_000_000,
  sources: [
    {
      provenance: 'huggingface',
      uri: 'https://huggingface.co/Wan-AI/Wan2.2-T2V-A14B/resolve/main/wan2.2_t2v_high_noise_14B_fp8_scaled.safetensors',
      format: 'safetensors',
      meta: { repo: 'Wan-AI/Wan2.2-T2V-A14B', branch: 'main', filename: 'wan2.2_t2v_high_noise_14B_fp8_scaled.safetensors' },
    },
  ],
  dest: 'unet/wan2.2_t2v_high_noise_14B_fp8_scaled.safetensors',
  sizeGb: 15,
  versio: '1.0.0',
  canonica: true,
  contentRating: 'sfw',
  natum: new Date('2026-07-07'),
}

export const INTELLA_WAN22_T2V_LOW: Intella = {
  id: 'intella.wan22-t2v-low',
  nomen: 'Wan2.2 T2V — low-noise unet (14B, fp8 scaled)',
  license: 'apache-2.0',
  commercialUse: 'yes',
  genus: 'model',
  architectura: 'dit',
  familia: 'wan22-t2v',
  parametri: 14_000_000_000,
  sources: [
    {
      provenance: 'huggingface',
      uri: 'https://huggingface.co/Wan-AI/Wan2.2-T2V-A14B/resolve/main/wan2.2_t2v_low_noise_14B_fp8_scaled.safetensors',
      format: 'safetensors',
      meta: { repo: 'Wan-AI/Wan2.2-T2V-A14B', branch: 'main', filename: 'wan2.2_t2v_low_noise_14B_fp8_scaled.safetensors' },
    },
  ],
  dest: 'unet/wan2.2_t2v_low_noise_14B_fp8_scaled.safetensors',
  sizeGb: 15,
  versio: '1.0.0',
  canonica: true,
  contentRating: 'sfw',
  natum: new Date('2026-07-07'),
}

export const INTELLA_WAN22_I2V_HIGH: Intella = {
  id: 'intella.wan22-i2v-high',
  nomen: 'Wan2.2 I2V — high-noise unet (14B, fp8 scaled)',
  license: 'apache-2.0',
  commercialUse: 'yes',
  genus: 'model',
  architectura: 'dit',
  familia: 'wan22-i2v',
  parametri: 14_000_000_000,
  sources: [
    {
      provenance: 'huggingface',
      uri: 'https://huggingface.co/Wan-AI/Wan2.2-I2V-A14B/resolve/main/wan2.2_i2v_high_noise_14B_fp8_scaled.safetensors',
      format: 'safetensors',
      meta: { repo: 'Wan-AI/Wan2.2-I2V-A14B', branch: 'main', filename: 'wan2.2_i2v_high_noise_14B_fp8_scaled.safetensors' },
    },
  ],
  dest: 'unet/wan2.2_i2v_high_noise_14B_fp8_scaled.safetensors',
  sizeGb: 15,
  versio: '1.0.0',
  canonica: true,
  contentRating: 'sfw',
  natum: new Date('2026-07-07'),
}

export const INTELLA_WAN22_I2V_LOW: Intella = {
  id: 'intella.wan22-i2v-low',
  nomen: 'Wan2.2 I2V — low-noise unet (14B, fp8 scaled)',
  license: 'apache-2.0',
  commercialUse: 'yes',
  genus: 'model',
  architectura: 'dit',
  familia: 'wan22-i2v',
  parametri: 14_000_000_000,
  sources: [
    {
      provenance: 'huggingface',
      uri: 'https://huggingface.co/Wan-AI/Wan2.2-I2V-A14B/resolve/main/wan2.2_i2v_low_noise_14B_fp8_scaled.safetensors',
      format: 'safetensors',
      meta: { repo: 'Wan-AI/Wan2.2-I2V-A14B', branch: 'main', filename: 'wan2.2_i2v_low_noise_14B_fp8_scaled.safetensors' },
    },
  ],
  dest: 'unet/wan2.2_i2v_low_noise_14B_fp8_scaled.safetensors',
  sizeGb: 15,
  versio: '1.0.0',
  canonica: true,
  contentRating: 'sfw',
  natum: new Date('2026-07-07'),
}

export const INTELLA_UMT5_XXL: Intella = {
  id: 'intella.umt5-xxl',
  nomen: 'umT5-XXL text encoder (fp8 scaled) — shared Wan2.2 encoder',
  license: 'apache-2.0',
  commercialUse: 'yes',
  genus: 'embedding',
  architectura: 'transformer',
  familia: 'wan22',
  parametri: 0,
  sources: [
    {
      provenance: 'huggingface',
      uri: 'https://huggingface.co/Comfy-Org/Wan_2.1_ComfyUI_repackaged/resolve/main/text_encoders/umt5_xxl_fp8_e4m3fn_scaled.safetensors',
      format: 'safetensors',
      meta: { repo: 'Comfy-Org/Wan_2.1_ComfyUI_repackaged', branch: 'main', filename: 'text_encoders/umt5_xxl_fp8_e4m3fn_scaled.safetensors' },
    },
  ],
  dest: 'clip/umt5_xxl_fp8_e4m3fn_scaled.safetensors',
  sizeGb: 6,
  versio: '1.0.0',
  canonica: true,
  contentRating: 'sfw',
  natum: new Date('2026-07-07'),
}

export const INTELLA_WAN21_VAE: Intella = {
  id: 'intella.wan21-vae',
  nomen: 'Wan2.1 VAE — shared Wan2.2 14B VAE',
  license: 'apache-2.0',
  commercialUse: 'yes',
  genus: 'embedding',
  architectura: 'vae',
  familia: 'wan22',
  parametri: 0,
  sources: [
    {
      provenance: 'huggingface',
      uri: 'https://huggingface.co/Comfy-Org/Wan_2.1_ComfyUI_repackaged/resolve/main/vae/wan_2.1_vae.safetensors',
      format: 'safetensors',
      meta: { repo: 'Comfy-Org/Wan_2.1_ComfyUI_repackaged', branch: 'main', filename: 'vae/wan_2.1_vae.safetensors' },
    },
  ],
  dest: 'vae/wan_2.1_vae.safetensors',
  sizeGb: 1,
  versio: '1.0.0',
  canonica: true,
  contentRating: 'sfw',
  natum: new Date('2026-07-07'),
}


// =============================================================================
// MiniMax H3 — video+audio generation (noema-372)
//
// LICENSING. The H3 weights are NOT openly licensed and are restrictive in the
// United States. Mony Group LLC — the company that owns noema — requested and
// received a licence to operate them in the US (rth, 2026-09-01). That grant is
// why these canonical seeds carry `commercialUse: 'yes'` while the shared
// register in `modelLicense.ts` maps the bare `minimax-h3` licence id to 'no'.
// The register is right and this is not an exception to it: `licenseCommercial()`
// classifies THIRD-PARTY IMPORTS, which are not covered by our grant and must stay
// fail-closed. A canonical seed carries an explicit verdict instead — the same seam
// `Intellarum.setLicense` exists for ("one cleared after taking out a commercial
// licence"). Do not copy 'yes' onto a user-imported H3 derivative.
//
// "va" = video + audio: there is a separate audio VAE and the model emits a voice
// track, so a single mp4 carries both (CreateVideo muxes before SaveVideo).
//
// The pruned int8 "convrot" checkpoints are the whole reason this fits: ~56 GB
// total against 135 GiB at full precision. The nvfp4 text-encoder variant is
// deliberately NOT seeded — it is Blackwell-only and useless on Ada.
// =============================================================================

/** MiniMax H3 first/last-frame-to-video DiT (pruned int8 convrot). Serves t2v + fl2v. */
export const INTELLA_MINIMAX_H3_FL2VA: Intella = {
  id: 'intella.minimax-h3-fl2va-int8',
  nomen: 'MiniMax H3 — first/last-frame to video (pruned int8 convrot)',
  license: 'minimax-h3',
  commercialUse: 'yes',            // Mony Group LLC holds a US operating licence — see header
  genus: 'model',
  architectura: 'dit',
  familia: 'minimax-h3',
  parametri: 0,
  sources: [
    {
      provenance: 'miladystation',
      uri: 'https://models.miladystation2.net/diffusion_models/minimax_h3_fl2va_pruned_int8_convrot.safetensors',
      format: 'safetensors',
    },
    {
      provenance: 'huggingface',
      uri: 'https://huggingface.co/Comfy-Org/MiniMax-H3/resolve/main/diffusion_models/minimax_h3_fl2va_pruned_int8_convrot.safetensors',
      format: 'safetensors',
      meta: { repo: 'Comfy-Org/MiniMax-H3', branch: 'main', filename: 'diffusion_models/minimax_h3_fl2va_pruned_int8_convrot.safetensors' },
    },
  ],
  dest: 'diffusion_models/minimax_h3_fl2va_pruned_int8_convrot.safetensors',
  sizeGb: 21,
  versio: '1.0.0',
  canonica: true,
  contentRating: 'sfw',
  natum: new Date('2026-09-01'),
}

/** MiniMax H3 reference-to-video DiT (pruned int8 convrot). Serves ref2v. */
export const INTELLA_MINIMAX_H3_REF2VA: Intella = {
  id: 'intella.minimax-h3-ref2va-int8',
  nomen: 'MiniMax H3 — reference to video (pruned int8 convrot)',
  license: 'minimax-h3',
  commercialUse: 'yes',            // Mony Group LLC holds a US operating licence — see header
  genus: 'model',
  architectura: 'dit',
  familia: 'minimax-h3',
  parametri: 0,
  sources: [
    {
      provenance: 'miladystation',
      uri: 'https://models.miladystation2.net/diffusion_models/minimax_h3_ref2va_pruned_int8_convrot.safetensors',
      format: 'safetensors',
    },
    {
      provenance: 'huggingface',
      uri: 'https://huggingface.co/Comfy-Org/MiniMax-H3/resolve/main/diffusion_models/minimax_h3_ref2va_pruned_int8_convrot.safetensors',
      format: 'safetensors',
      meta: { repo: 'Comfy-Org/MiniMax-H3', branch: 'main', filename: 'diffusion_models/minimax_h3_ref2va_pruned_int8_convrot.safetensors' },
    },
  ],
  dest: 'diffusion_models/minimax_h3_ref2va_pruned_int8_convrot.safetensors',
  sizeGb: 21,
  versio: '1.0.0',
  canonica: true,
  contentRating: 'sfw',
  natum: new Date('2026-09-01'),
}

/**
 * MiniMax H3 text encoder — Qwen3-VL-32B, int8 convrot.
 *
 * The single largest weight in the stack at 26 GB, and the reason the three flows
 * share one Fundamentum: co-hosted, it is pulled once instead of three times.
 */
export const INTELLA_MINIMAX_H3_TEXT_ENCODER: Intella = {
  id: 'intella.qwen3vl-32b-minimax-h3-int8',
  nomen: 'Qwen3-VL-32B for MiniMax H3 (int8 convrot)',
  license: 'minimax-h3',
  commercialUse: 'yes',            // Mony Group LLC holds a US operating licence — see header
  genus: 'embedding',
  architectura: 'transformer',
  parametri: 32_000_000_000,
  sources: [
    {
      provenance: 'miladystation',
      uri: 'https://models.miladystation2.net/text_encoders/qwen3vl_32b_minimax_h3_int8_convrot.safetensors',
      format: 'safetensors',
    },
    {
      provenance: 'huggingface',
      uri: 'https://huggingface.co/Comfy-Org/MiniMax-H3/resolve/main/text_encoders/qwen3vl_32b_minimax_h3_int8_convrot.safetensors',
      format: 'safetensors',
      meta: { repo: 'Comfy-Org/MiniMax-H3', branch: 'main', filename: 'text_encoders/qwen3vl_32b_minimax_h3_int8_convrot.safetensors' },
    },
  ],
  dest: 'text_encoders/qwen3vl_32b_minimax_h3_int8_convrot.safetensors',
  sizeGb: 27,
  versio: '1.0.0',
  canonica: true,
  contentRating: 'sfw',
  natum: new Date('2026-09-01'),
}

/** MiniMax H3 video VAE (fp16) — the image half of the decode. */
export const INTELLA_MINIMAX_H3_VIDEO_VAE: Intella = {
  id: 'intella.minimax-h3-video-vae',
  nomen: 'MiniMax H3 — video VAE (fp16)',
  license: 'minimax-h3',
  commercialUse: 'yes',            // Mony Group LLC holds a US operating licence — see header
  genus: 'embedding',
  architectura: 'vae',
  parametri: 0,
  sources: [
    {
      provenance: 'miladystation',
      uri: 'https://models.miladystation2.net/vae/minimax_h3_video_vae_fp16.safetensors',
      format: 'safetensors',
    },
    {
      provenance: 'huggingface',
      uri: 'https://huggingface.co/Comfy-Org/MiniMax-H3/resolve/main/vae/minimax_h3_video_vae_fp16.safetensors',
      format: 'safetensors',
      meta: { repo: 'Comfy-Org/MiniMax-H3', branch: 'main', filename: 'vae/minimax_h3_video_vae_fp16.safetensors' },
    },
  ],
  dest: 'vae/minimax_h3_video_vae_fp16.safetensors',
  sizeGb: 5,
  versio: '1.0.0',
  canonica: true,
  contentRating: 'sfw',
  natum: new Date('2026-09-01'),
}

/**
 * MiniMax H3 audio VAE (fp32) — the voice half of the decode.
 *
 * `VAEDecodeAudio` reads this; `CreateVideo` muxes its output into the mp4. Without
 * it the flows produce silent video, so it is a base weight, not an optional extra.
 */
export const INTELLA_MINIMAX_H3_AUDIO_VAE: Intella = {
  id: 'intella.minimax-h3-audio-vae',
  nomen: 'MiniMax H3 — audio VAE (fp32)',
  license: 'minimax-h3',
  commercialUse: 'yes',            // Mony Group LLC holds a US operating licence — see header
  genus: 'embedding',
  architectura: 'vae',
  parametri: 0,
  sources: [
    {
      provenance: 'miladystation',
      uri: 'https://models.miladystation2.net/vae/minimax_h3_audio_vae_fp32.safetensors',
      format: 'safetensors',
    },
    {
      provenance: 'huggingface',
      uri: 'https://huggingface.co/Comfy-Org/MiniMax-H3/resolve/main/vae/minimax_h3_audio_vae_fp32.safetensors',
      format: 'safetensors',
      meta: { repo: 'Comfy-Org/MiniMax-H3', branch: 'main', filename: 'vae/minimax_h3_audio_vae_fp32.safetensors' },
    },
  ],
  dest: 'vae/minimax_h3_audio_vae_fp32.safetensors',
  sizeGb: 1,
  versio: '1.0.0',
  canonica: true,
  contentRating: 'sfw',
  natum: new Date('2026-09-01'),
}

/**
 * fl2v 4-step turbo LoRA (768p) — BAKED into the t2v/fl2v graphs.
 *
 * This is a flow weight, not a user-selectable LoRA: the graph names it in
 * `LoraLoaderModelOnly` at strength 1.0 and the 4-step schedule depends on it.
 * It rides `Essentia.intellae` (the weight manifest) and must never reach the
 * prompt-driven LoRA rail — hence no `familia`, so `triggerMap` cannot surface it.
 *
 * Ships in `Comfy-Org/MiniMax-H3` alongside the base checkpoints (rig's fetch-comfy-weights.sh),
 * so it carries the same licence and the same US grant — not a separate third-party clearance.
 */
export const INTELLA_MINIMAX_H3_FL2V_TURBO: Intella = {
  id: 'intella.minimax-h3-fl2v-turbo-4step',
  nomen: 'MiniMax H3 fl2v — 4-step turbo LoRA (768p, bf16)',
  license: 'minimax-h3',
  commercialUse: 'yes',            // Mony Group LLC holds a US operating licence — see header
  genus: 'lora',
  architectura: 'dit',
  parametri: 0,
  sources: [
    {
      provenance: 'miladystation',
      uri: 'https://models.miladystation2.net/loras/minimax_h3_fl2v_turbo_4step_v1.0_768p_comfyui_bf16.safetensors',
      format: 'safetensors',
    },
    {
      provenance: 'huggingface',
      uri: 'https://huggingface.co/Comfy-Org/MiniMax-H3/resolve/main/loras/minimax_h3_fl2v_turbo_4step_v1.0_768p_comfyui_bf16.safetensors',
      format: 'safetensors',
      meta: { repo: 'Comfy-Org/MiniMax-H3', branch: 'main', filename: 'loras/minimax_h3_fl2v_turbo_4step_v1.0_768p_comfyui_bf16.safetensors' },
    },
  ],
  dest: 'loras/minimax_h3_fl2v_turbo_4step_v1.0_768p_comfyui_bf16.safetensors',
  sizeGb: 2,
  versio: '1.0.0',
  canonica: true,
  contentRating: 'sfw',
  natum: new Date('2026-09-01'),
}

/** ref2v 4-step turbo LoRA — BAKED into the ref2v graph. See the fl2v turbo note. */
export const INTELLA_MINIMAX_H3_REF2V_TURBO: Intella = {
  id: 'intella.minimax-h3-ref2v-turbo-4step',
  nomen: 'MiniMax H3 ref2v — 4-step turbo LoRA (bf16)',
  license: 'minimax-h3',
  commercialUse: 'yes',            // Mony Group LLC holds a US operating licence — see header
  genus: 'lora',
  architectura: 'dit',
  parametri: 0,
  sources: [
    {
      provenance: 'miladystation',
      uri: 'https://models.miladystation2.net/loras/minimax_h3_ref2v_turbo_4step_v0.1_comfyui_bf16.safetensors',
      format: 'safetensors',
    },
    {
      provenance: 'huggingface',
      uri: 'https://huggingface.co/Comfy-Org/MiniMax-H3/resolve/main/loras/minimax_h3_ref2v_turbo_4step_v0.1_comfyui_bf16.safetensors',
      format: 'safetensors',
      meta: { repo: 'Comfy-Org/MiniMax-H3', branch: 'main', filename: 'loras/minimax_h3_ref2v_turbo_4step_v0.1_comfyui_bf16.safetensors' },
    },
  ],
  dest: 'loras/minimax_h3_ref2v_turbo_4step_v0.1_comfyui_bf16.safetensors',
  sizeGb: 2,
  versio: '1.0.0',
  canonica: true,
  contentRating: 'sfw',
  natum: new Date('2026-09-01'),
}

export const CANONICAL_INTELLAE: Intella[] = [
  INTELLA_FLUX_SCHNELL,
  INTELLA_FLUX_VAE,
  INTELLA_T5XXL,
  INTELLA_CLIP_L,
  INTELLA_SD15,
  INTELLA_SDXL_BASE,
  INTELLA_CHROMA,
  INTELLA_FLUX_KONTEXT_DEV,
  INTELLA_FLUX2_KLEIN_9B,
  INTELLA_FLUX2_KLEIN_4B,
  INTELLA_QWEN3_8B_FLUX2,
  INTELLA_QWEN3_4B_FLUX2,
  INTELLA_FLUX2_VAE_FULL,
  INTELLA_IMPRESSTATION_KLEIN,
  INTELLA_ZIMAGE_TURBO,
  INTELLA_QWEN3_4B_ZIMAGE,
  INTELLA_KREA2_TURBO,
  INTELLA_QWEN3_VL_4B_KREA,
  INTELLA_QWEN_IMAGE_VAE,
  INTELLA_UPSCALE_ULTRASHARP,
  INTELLA_SMOLLM2_135M,
  INTELLA_LORA_ARMORED_DRESS,
  INTELLA_QWEN3_VL_8B,
  INTELLA_MOSS_MUSIC_8B,
  INTELLA_SHOTVL_7B,
  INTELLA_HEARTMULA_GEN,
  INTELLA_HEARTMULA_3B,
  INTELLA_HEARTCODEC,
  INTELLA_LTX_23_DISTILLED,
  INTELLA_GEMMA_3_12B,
  INTELLA_WAN22_T2V_HIGH,
  INTELLA_WAN22_T2V_LOW,
  INTELLA_WAN22_I2V_HIGH,
  INTELLA_WAN22_I2V_LOW,
  INTELLA_UMT5_XXL,
  INTELLA_WAN21_VAE,
  INTELLA_MINIMAX_H3_FL2VA,
  INTELLA_MINIMAX_H3_REF2VA,
  INTELLA_MINIMAX_H3_TEXT_ENCODER,
  INTELLA_MINIMAX_H3_VIDEO_VAE,
  INTELLA_MINIMAX_H3_AUDIO_VAE,
  INTELLA_MINIMAX_H3_FL2V_TURBO,
  INTELLA_MINIMAX_H3_REF2V_TURBO,
]
