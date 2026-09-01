import type { Fundamentum } from '../../types/fundamentum.js'

// =============================================================================
// Canonical Fundamenta — the platform's compute-substrate specs (ADR-0005).
//
// A Fundamentum is the provider-neutral environment a family of flows runs on:
// image + runtime + the shared base/support weights + a capacity hint. Essentiae
// reference one by id+versio (see seeds/essentiae.ts). The decomposition of the
// former `Essentia.runpodSpec`: the environment half lives here; each flow keeps
// its own form (workflowTemplate, seedInputKey, genFlags).
//
// contentHash is omitted — computed/set on first registration (parity with modi).
// =============================================================================

/** FLUX · ComfyUI — the FLUX.1 base stack (unet + vae + dual CLIP). */
export const FUNDAMENTUM_FLUX_COMFYUI: Fundamentum = {
  id: 'flux-comfyui',
  nomen: 'FLUX · ComfyUI',
  versio: '1.1.0',
  contentHash: '',
  imageId: 'runpod/pytorch',
  imageVersion: '2.4.0-py3.11-cuda12.4.1-devel-ubuntu22.04',
  runtime: 'ComfyUI',
  comfyRef: 'v0.26.0',
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
  mutatum: new Date('2026-07-10'),
}

/** SD1.5 · ComfyUI — the self-contained Stable Diffusion 1.5 checkpoint. */
export const FUNDAMENTUM_SD15_COMFYUI: Fundamentum = {
  id: 'sd15-comfyui',
  nomen: 'SD1.5 · ComfyUI',
  versio: '1.1.0',
  contentHash: '',
  imageId: 'runpod/pytorch',
  imageVersion: '2.4.0-py3.11-cuda12.4.1-devel-ubuntu22.04',
  runtime: 'ComfyUI',
  comfyRef: 'v0.26.0',
  intellae: [
    { id: 'intella.sd15-v1-5', role: 'checkpoint' },
  ],
  vramGb: 8,
  canonica: true,
  natum: new Date('2025-01-01'),
  mutatum: new Date('2026-07-10'),
}

/** SDXL · ComfyUI — the self-contained SDXL base checkpoint (model + CLIP + VAE in one file). */
export const FUNDAMENTUM_SDXL_COMFYUI: Fundamentum = {
  id: 'sdxl-comfyui',
  nomen: 'SDXL · ComfyUI',
  versio: '1.1.0',
  contentHash: '',
  imageId: 'runpod/pytorch',
  imageVersion: '2.4.0-py3.11-cuda12.4.1-devel-ubuntu22.04',
  runtime: 'ComfyUI',
  comfyRef: 'v0.26.0',
  intellae: [
    { id: 'intella.sdxl-base-1-0', role: 'checkpoint' },
  ],
  vramGb: 12,
  canonica: true,
  natum: new Date('2025-01-01'),
  mutatum: new Date('2026-07-10'),
}

/**
 * Chroma · ComfyUI — the Chroma DiT stack. FLUX-adjacent: the new Chroma unet sits on the SHARED
 * FLUX support weights (T5-XXL text encoder + FLUX VAE), so it reuses intella.t5xxl-fp16 +
 * intella.flux-vae rather than minting its own. Family ('chroma') derives from the unet's `familia`.
 */
export const FUNDAMENTUM_CHROMA_COMFYUI: Fundamentum = {
  id: 'chroma-comfyui',
  nomen: 'Chroma · ComfyUI',
  versio: '1.1.0',
  contentHash: '',
  imageId: 'runpod/pytorch',
  imageVersion: '2.4.0-py3.11-cuda12.4.1-devel-ubuntu22.04',
  runtime: 'ComfyUI',
  comfyRef: 'v0.26.0',
  intellae: [
    { id: 'intella.chroma-unlocked-v35', role: 'unet' },
    { id: 'intella.t5xxl-fp16',          role: 'clip' },
    { id: 'intella.flux-vae',            role: 'vae' },
  ],
  vramGb: 24,
  canonica: true,
  natum: new Date('2025-01-01'),
  mutatum: new Date('2026-07-10'),
}

/**
 * FLUX Kontext · ComfyUI — the FLUX.1 Kontext [dev] edit stack. FLUX-adjacent: the Kontext unet sits on
 * the SHARED FLUX support weights (T5-XXL + CLIP-L + FLUX VAE), so it reuses those intellae; only the
 * unet differs from `flux-comfyui`. Family ('flux') derives from the unet's `familia` (so old flux LoRAs
 * apply — the user's note that Kontext works with our existing LoRAs).
 *
 * Acceptance is DIRECTED, so it is declared rather than derived from `familia`: this stack consumes LoRAs
 * trained for `flux` AND ones trained for `kontext`, while a plain `flux` stack consumes only `flux`. The
 * declaration sits on the EXISTING `versio` deliberately — `MongoFundamentorum.register` upserts on
 * `{id, versio}`, and `ESSENTIA_KONTEXTEDIT` pins this exact versio with no fallback to latest, so a bump
 * would add a second canonical document for one fundament id and leave the declaration unreachable.
 */
export const FUNDAMENTUM_FLUX_KONTEXT_COMFYUI: Fundamentum = {
  id: 'flux-kontext-comfyui',
  nomen: 'FLUX Kontext · ComfyUI',
  versio: '1.1.0',
  contentHash: '',
  imageId: 'runpod/pytorch',
  imageVersion: '2.4.0-py3.11-cuda12.4.1-devel-ubuntu22.04',
  runtime: 'ComfyUI',
  comfyRef: 'v0.26.0',
  intellae: [
    { id: 'intella.flux-kontext-dev', role: 'unet' },
    { id: 'intella.t5xxl-fp16',       role: 'clip' },
    { id: 'intella.clip-l',           role: 'clip' },
    { id: 'intella.flux-vae',         role: 'vae' },
  ],
  acceptsFamiliae: ['flux', 'kontext'],
  vramGb: 24,
  canonica: true,
  natum: new Date('2025-01-01'),
  mutatum: new Date('2026-07-10'),
}

/**
 * Z-Image Turbo · ComfyUI — Alibaba Tongyi's 6B S3-DiT, 8-step distilled turbo. The new Z-Image unet
 * + its Qwen3-4B text encoder, reusing the SHARED FLUX VAE (intella.flux-vae). family 'zimage' (its
 * own LoRA-compat key — flux/sdxl LoRAs don't apply). LoRA-capable via the Coziness MultiLoraLoader.
 */
export const FUNDAMENTUM_ZIMAGE_TURBO_COMFYUI: Fundamentum = {
  id: 'z-image-turbo-comfyui',
  nomen: 'Z-Image Turbo · ComfyUI',
  versio: '1.1.0',
  contentHash: '',
  imageId: 'runpod/pytorch',
  imageVersion: '2.4.0-py3.11-cuda12.4.1-devel-ubuntu22.04',
  runtime: 'ComfyUI',
  comfyRef: 'v0.26.0',
  intellae: [
    { id: 'intella.z-image-turbo', role: 'unet' },
    { id: 'intella.qwen3-4b',      role: 'clip' },
    { id: 'intella.flux-vae',      role: 'vae' },
  ],
  vramGb: 24,
  canonica: true,
  natum: new Date('2026-06-26'),
  mutatum: new Date('2026-07-10'),
}

/**
 * Krea 2 Turbo · ComfyUI — the 12.9B single_mmdit_large_wide DiT, 8-step distilled turbo. Carries the
 * Krea 2 Turbo unet + its Qwen3-VL-4B text encoder + the Qwen-Image VAE (none shared with the flux
 * stacks). family 'krea2' (its own LoRA-compat key). LoRA-capable via the Coziness MultiLoraLoader.
 * License: Krea 2 Community License (commercial use under $1M annual revenue).
 */
export const FUNDAMENTUM_KREA2_TURBO_COMFYUI: Fundamentum = {
  id: 'krea-turbo-comfyui',
  nomen: 'Krea 2 Turbo · ComfyUI',
  versio: '1.1.0',
  contentHash: '',
  imageId: 'runpod/pytorch',
  imageVersion: '2.4.0-py3.11-cuda12.4.1-devel-ubuntu22.04',
  runtime: 'ComfyUI',
  comfyRef: 'v0.26.0',
  intellae: [
    { id: 'intella.krea-2-turbo',  role: 'unet' },
    { id: 'intella.qwen3-vl-4b',   role: 'clip' },
    { id: 'intella.qwen-image-vae', role: 'vae' },
  ],
  vramGb: 24,
  canonica: true,
  natum: new Date('2026-06-26'),
  mutatum: new Date('2026-07-10'),
}

/**
 * ComfyUI base — a weightless ComfyUI substrate for pack-only flows whose custom node self-downloads
 * its own model (e.g. InspyrenetRembg pulls the transparent-background ckpt on first use). No pinned
 * intellae; the flow's template names its customNodes. Light pod.
 */
export const FUNDAMENTUM_COMFYUI_BASE: Fundamentum = {
  id: 'comfyui-base',
  nomen: 'ComfyUI base (weightless)',
  versio: '1.1.0',
  contentHash: '',
  imageId: 'runpod/pytorch',
  imageVersion: '2.4.0-py3.11-cuda12.4.1-devel-ubuntu22.04',
  runtime: 'ComfyUI',
  comfyRef: 'v0.26.0',
  intellae: [],
  vramGb: 8,
  canonica: true,
  natum: new Date('2025-01-01'),
  mutatum: new Date('2026-07-10'),
}

/**
 * FLUX.2 Klein · ComfyUI — the FLUX.2 Klein 9B stack (a NEW family, not FLUX.1). Distinct architecture:
 * a Qwen3-8B text encoder (CLIPLoader type 'flux2') + the FLUX.2 full-encoder VAE + the Klein 9B DiT.
 * Carries all three (none shared with the flux.1 fundamenta). family 'flux2' — flux.1 LoRAs don't apply.
 */
export const FUNDAMENTUM_FLUX2_KLEIN_COMFYUI: Fundamentum = {
  id: 'flux2-klein-comfyui',
  nomen: 'FLUX.2 Klein · ComfyUI',
  versio: '1.1.0',
  contentHash: '',
  imageId: 'runpod/pytorch',
  imageVersion: '2.4.0-py3.11-cuda12.4.1-devel-ubuntu22.04',
  runtime: 'ComfyUI',
  comfyRef: 'v0.26.0',
  intellae: [
    { id: 'intella.flux2-klein-9b',          role: 'unet' },
    { id: 'intella.qwen3-8b-flux2',          role: 'clip' },
    { id: 'intella.flux2-vae-full-encoder',  role: 'vae' },
  ],
  vramGb: 24,
  canonica: true,
  natum: new Date('2025-01-01'),
  mutatum: new Date('2026-07-10'),
}

/**
 * FLUX.2 Klein 4B · ComfyUI — the 4B DiT variant of the Klein stack (vs the 9B above). Same Qwen3-8B
 * TE + flux2 VAE; only the diffusion model is the smaller 4B fp8, which leaves a 24GB 4090 ample VRAM
 * for a LoRA. This is the LoRA-capable Klein substrate (the kleinedit4b workflow carries the Coziness
 * MultiLoraLoader stack) — the base our `stationthis` flagship custom modus forks from.
 */
export const FUNDAMENTUM_FLUX2_KLEIN_4B_COMFYUI: Fundamentum = {
  id: 'flux2-klein-4b-comfyui',
  nomen: 'FLUX.2 Klein 4B · ComfyUI',
  versio: '1.1.0',
  contentHash: '',
  imageId: 'runpod/pytorch',
  imageVersion: '2.4.0-py3.11-cuda12.4.1-devel-ubuntu22.04',
  runtime: 'ComfyUI',
  comfyRef: 'v0.26.0',
  intellae: [
    { id: 'intella.flux2-klein-4b',          role: 'unet' },
    { id: 'intella.qwen3-4b-flux2',          role: 'clip' },
    { id: 'intella.flux2-vae-full-encoder',  role: 'vae' },
  ],
  vramGb: 24,
  canonica: true,
  natum: new Date('2026-06-30'),
  mutatum: new Date('2026-07-10'),
}

/**
 * Upscale · ComfyUI — the lightest image substrate: an ESRGAN upscaler only, no checkpoint. The
 * model-only upscale flow (UpscaleModelLoader + ImageUpscaleWithModel) needs no diffusion model, so
 * this fundament carries just the 4x-UltraSharp weight and runs on a small pod.
 */
export const FUNDAMENTUM_UPSCALE_COMFYUI: Fundamentum = {
  id: 'upscale-comfyui',
  nomen: 'Upscale · ComfyUI',
  versio: '1.1.0',
  contentHash: '',
  imageId: 'runpod/pytorch',
  imageVersion: '2.4.0-py3.11-cuda12.4.1-devel-ubuntu22.04',
  runtime: 'ComfyUI',
  comfyRef: 'v0.26.0',
  intellae: [
    { id: 'intella.upscale-4x-ultrasharp', role: 'upscale_model' },
  ],
  vramGb: 6,
  canonica: true,
  natum: new Date('2025-01-01'),
  mutatum: new Date('2026-07-10'),
}

/**
 * Qwen-VL · vLLM — the SHARED understanding substrate (ADR-0007).
 *
 * One environment (a vLLM/SGLang serving image) for the whole understanding track —
 * Qwen3-VL, MOSS-Music, ShotVL all sit on it. Unlike the image fundamenta, it pins NO
 * base weights: the three flows use DIFFERENT checkpoints, so each Essentia carries its
 * own LM in `Essentia.intellae` (the Compiler merges fundamentum.intellae ∪ essentia.intellae,
 * Compiler.ts:160). "Shared substrate, weights swapped per flow" = shared image+runtime,
 * per-flow weight — not a shared weight manifest.
 *
 * runtime 'vLLM' selects the TransformersVllmExecutor on the pod (ADR-0007 Part A).
 *
 * IMAGE: a RunPod SSH-ready base (the same `runpod/pytorch` ComfyUI uses), NOT a prebuilt
 * `vllm/vllm-openai` image. SecurePodClient bootstraps every pod over SSH; the bare vLLM serving
 * image ships no sshd, so `_waitForSshd` fails ("sshd did not become ready") — verified live
 * 2026-06-11 (run cede4cce, 3/3 attempts). The bootstrap `pip install vllm` brings vLLM onto the
 * SSH-capable base instead. (Live-iterate the CUDA/torch tag if vLLM needs a newer one.)
 */
export const FUNDAMENTUM_QWEN_VL_VLLM: Fundamentum = {
  id: 'qwen-vl-vllm',
  nomen: 'Qwen-VL · vLLM',
  versio: '1.0.0',
  contentHash: '',
  imageId: 'runpod/pytorch',
  imageVersion: '2.4.0-py3.11-cuda12.4.1-devel-ubuntu22.04',
  runtime: 'vLLM',
  intellae: [],             // none shared — the LM is per-Essentia (see note above)
  vramGb: 24,
  canonica: true,
  natum: new Date('2026-06-11'),
  mutatum: new Date('2026-06-11'),
}

/**
 * MOSS · SGLang — the substrate for custom-architecture audio/LM models that vLLM can't serve.
 *
 * MOSS-Music is a bespoke arch (Qwen3-8B + audio encoder) that needs `trust_remote_code`; vLLM has
 * no native impl for it, but SGLang (MOSS's own recommended serving path) loads it with
 * `--trust-remote-code` and exposes the SAME OpenAI-compatible API — so it reuses the inference
 * compile path (runtime 'sglang' → _compileInference). The bootstrap pip-installs sglang.
 */
export const FUNDAMENTUM_MOSS_SGLANG: Fundamentum = {
  id: 'moss-sglang',
  nomen: 'MOSS · SGLang',
  versio: '1.0.0',
  contentHash: '',
  imageId: 'runpod/pytorch',
  imageVersion: '2.4.0-py3.11-cuda12.4.1-devel-ubuntu22.04',
  runtime: 'sglang',
  intellae: [],   // per-Essentia LM (like the vLLM substrate)
  vramGb: 24,
  canonica: true,
  natum: new Date('2026-06-11'),
  mutatum: new Date('2026-06-11'),
}

/**
 * HeartMuLa · PyTorch — the python-modelcard substrate (ADR-0007 generation track). A model whose
 * inference is a cloned repo's one-shot CLI (no ComfyUI graph, no OpenAI server). runtime
 * 'python-modelcard' → the PythonModelcardExecutor (clone repo + pip install -e . + download the
 * ckpt weights + run the CLI + collect the .mp3). Carries the 3 HeartMuLa weight repos.
 */
export const FUNDAMENTUM_HEARTMULA_PYTORCH: Fundamentum = {
  id: 'heartmula-pytorch',
  nomen: 'HeartMuLa · PyTorch',
  versio: '1.0.0',
  contentHash: '',
  imageId: 'runpod/pytorch',
  imageVersion: '2.4.0-py3.11-cuda12.4.1-devel-ubuntu22.04',
  runtime: 'python-modelcard',
  intellae: [
    { id: 'intella.heartmula-gen', role: 'config' },
    { id: 'intella.heartmula-3b',  role: 'generator' },
    { id: 'intella.heartcodec',    role: 'codec' },
  ],
  vramGb: 24,
  canonica: true,
  natum: new Date('2026-06-12'),
  mutatum: new Date('2026-06-12'),
}

/**
 * Hunyuan3D · PyTorch — python-modelcard substrate for image→3D (shape-only). Same runtime as
 * HeartMuLa; the Essentia's `script` form drops a thin wrapper (Hunyuan3D has no CLI) that runs the
 * shape pipeline + exports a .glb. SHAPE-ONLY (~10GB, fits a 24GB pod); texture needs ~29GB + a
 * custom CUDA build (deferred). The pipeline self-downloads `tencent/Hunyuan3D-2.1` (cached via
 * HF_HOME on the model volume), so no `intellae` here.
 */
export const FUNDAMENTUM_HUNYUAN3D_PYTORCH: Fundamentum = {
  id: 'hunyuan3d-pytorch',
  nomen: 'Hunyuan3D · PyTorch',
  versio: '1.0.0',
  contentHash: '',
  imageId: 'runpod/pytorch',
  imageVersion: '2.4.0-py3.11-cuda12.4.1-devel-ubuntu22.04',
  runtime: 'python-modelcard',
  intellae: [],   // self-downloads via from_pretrained
  vramGb: 12,
  canonica: true,
  natum: new Date('2026-06-12'),
  mutatum: new Date('2026-06-12'),
}

/**
 * ai-toolkit Training — the crystal-native LoRA-training substrate (runtime 'aitoolkit',
 * build #5). Drives ostris/ai-toolkit LOCALLY on our GPU (the `AitoolkitTrainingCursor`,
 * ministerium 'aitoolkit'), reading its SQLite `Job` row for status. Canonical target is
 * FLUX.2 Klein-4B (`black-forest-labs/FLUX.2-klein-base-4B`, arch `flux2_klein_4b`, TE
 * Qwen/Qwen3-4B — all Apache, ungated), which trains on a 24GB 4090 where FLUX.1's 12B OOMs.
 * ai-toolkit self-downloads the base/TE/VAE via `from_pretrained` (so no `intellae`). The
 * image is the locally-built `stationthis-klein:1` (ai-toolkit deps baked); the cursor owns
 * the `docker run` launch, so no generic `launchTemplate`.
 */
export const FUNDAMENTUM_AITOOLKIT_TRAINING: Fundamentum = {
  id: 'aitoolkit-training',
  nomen: 'ai-toolkit · Training',
  versio: '1.0.0',
  contentHash: '',
  imageId: 'stationthis-klein',
  imageVersion: '1',
  runtime: 'aitoolkit',
  intellae: [],   // ai-toolkit self-downloads klein-4b + Qwen3-4B + VAE via from_pretrained
  vramGb: 24,
  canonica: true,
  natum: new Date('2026-06-23'),
  mutatum: new Date('2026-06-23'),
}

/**
 * LTX 2.3 · ComfyUI — the LTX-2.3 22B distilled video (T2V + I2V) substrate. The all-in-one
 * transformer+VAE bundle + its separate Gemma-3-12B text encoder (LTXAVTextEncoderLoader).
 * Both T2V and I2V share this one fundament (image conditioning is a graph-level swap, not a
 * substrate difference). No LoRA path in v1 (family 'ltx' derives from the checkpoint's `familia`,
 * ready for a future LoRA). Targets a RunPod pod (32GB+), NOT the local 4090 — vramGb: 48
 * (46GB bf16 checkpoint + Gemma headroom).
 */
export const FUNDAMENTUM_LTX_COMFYUI: Fundamentum = {
  id: 'ltx-comfyui',
  nomen: 'LTX 2.3 · ComfyUI',
  versio: '1.1.0',
  contentHash: '',
  imageId: 'runpod/pytorch',
  imageVersion: '2.4.0-py3.11-cuda12.4.1-devel-ubuntu22.04',
  runtime: 'ComfyUI',
  comfyRef: 'v0.26.0',
  intellae: [
    { id: 'intella.ltx-2.3-distilled', role: 'checkpoint' },
    { id: 'intella.gemma-3-12b',       role: 'text_encoder' },
  ],
  vramGb: 48,
  canonica: true,
  natum: new Date('2026-07-07'),
  mutatum: new Date('2026-07-10'),
}

/**
 * Wan2.2 T2V · ComfyUI — the two-model MoE stack (high-noise + low-noise unets) plus the shared
 * umt5 text encoder + Wan2.1 VAE. Render-proven at 480x480x33f under --lowvram (21.5GB); house-res
 * 832x544x81 spills past that, hence vramGb:48 for the production pod.
 */
export const FUNDAMENTUM_WAN22_T2V_COMFYUI: Fundamentum = {
  id: 'wan22-t2v-comfyui',
  nomen: 'Wan2.2 T2V · ComfyUI',
  versio: '1.1.0',
  contentHash: '',
  imageId: 'runpod/pytorch',
  imageVersion: '2.4.0-py3.11-cuda12.4.1-devel-ubuntu22.04',
  runtime: 'ComfyUI',
  comfyRef: 'v0.26.0',
  intellae: [
    { id: 'intella.wan22-t2v-high', role: 'unet_high' },
    { id: 'intella.wan22-t2v-low',  role: 'unet_low' },
    { id: 'intella.umt5-xxl',       role: 'text_encoder' },
    { id: 'intella.wan21-vae',      role: 'vae' },
  ],
  // Proven 21.5GB at 480x480x33f under --lowvram; house-res 832x544x81 will spill past that.
  vramGb: 48,
  canonica: true,
  natum: new Date('2026-07-07'),
  mutatum: new Date('2026-07-10'),
}

/**
 * Wan2.2 I2V · ComfyUI — same two-model MoE shape as T2V, but the low-VRAM latent is seeded via
 * `WanImageToVideo` from a `LoadImage` start frame instead of an empty latent.
 */
export const FUNDAMENTUM_WAN22_I2V_COMFYUI: Fundamentum = {
  id: 'wan22-i2v-comfyui',
  nomen: 'Wan2.2 I2V · ComfyUI',
  versio: '1.1.0',
  contentHash: '',
  imageId: 'runpod/pytorch',
  imageVersion: '2.4.0-py3.11-cuda12.4.1-devel-ubuntu22.04',
  runtime: 'ComfyUI',
  comfyRef: 'v0.26.0',
  intellae: [
    { id: 'intella.wan22-i2v-high', role: 'unet_high' },
    { id: 'intella.wan22-i2v-low',  role: 'unet_low' },
    { id: 'intella.umt5-xxl',       role: 'text_encoder' },
    { id: 'intella.wan21-vae',      role: 'vae' },
  ],
  // Proven 21.5GB at 480x480x33f under --lowvram; house-res 832x544x81 will spill past that.
  vramGb: 48,
  canonica: true,
  natum: new Date('2026-07-07'),
  mutatum: new Date('2026-07-10'),
}

/**
 * MiniMax H3 · ComfyUI — the video+audio substrate shared by t2v, fl2v and ref2v (noema-372).
 *
 * WHY A DIFFERENT BASE IMAGE than every other ComfyUI fundament. H3 needs ComfyUI >= 0.30.0
 * (native support merged 2026-08-03) and is acutely torch-sensitive: the rig measured a ~2x
 * throughput swing traced purely to the bundled PyTorch build. `runpod/pytorch:2.4.0-cu124`,
 * which the flux/sd/wan fundamenta ride, is far too old. This pins the exact base the
 * head-to-head was measured on (57.5 s/shot warm, 24.0 GB peak VRAM, 77 GB peak host RAM).
 *
 * `comfyRef` IS LOAD-BEARING. `SecurePodClient`'s DEFAULT_COMFYUI_REF is v0.26.0 — under
 * 0.30.0. If this field is ever dropped, the pod boots healthy with no H3 nodes in it and the
 * failure looks like a bad graph rather than a bad substrate.
 *
 * `install` covers what that base needs and the stock bootstrap does not do on its own:
 * PEP 668 makes the 2.13 image's Python externally-managed, so a bare `pip install` refuses;
 * and comfy-kitchen supplies the int8 convrot kernels the pruned checkpoints are built on.
 *
 * WEIGHT SPLIT. Only the SHARED weights live here — text encoder + both VAEs, ~32 GB. Each
 * flow adds its own DiT + baked turbo LoRA via `Essentia.intellae`. Co-host key is fundament-id
 * equality, so all three flows land on one pod and pull the 26 GB encoder ONCE.
 *
 * vramGb is 48, not the 24.0 GB measured: that measurement is the peak on a 24 GB card, i.e.
 * the ceiling with nothing to spare, so it is a bad capacity floor for pod selection.
 */
export const FUNDAMENTUM_MINIMAX_H3_COMFYUI: Fundamentum = {
  id: 'minimax-h3-comfyui',
  nomen: 'MiniMax H3 · ComfyUI',
  versio: '1.0.0',
  contentHash: '',
  imageId: 'pytorch/pytorch',
  imageVersion: '2.13.0-cuda13.0-cudnn9-runtime',
  runtime: 'ComfyUI',
  // TODO(noema-372): pin to the ref recovered from the rig image
  // (`docker run --rm minimax-comfy:local git -C /opt/ComfyUI rev-parse HEAD`). The tag below is
  // the floor H3 needs, not the ref the measurements were taken on.
  comfyRef: 'v0.30.0',
  install: [
    // Each bootstrap command runs in its OWN shell, so `export` would not survive to the
    // bootstrap's `pip install -r requirements.txt`. Write pip's real config instead.
    'pip config set global.break-system-packages true',
    'pip install --no-cache-dir comfy-kitchen',
  ],
  intellae: [
    { id: 'intella.qwen3vl-32b-minimax-h3-int8', role: 'clip' },
    { id: 'intella.minimax-h3-video-vae',        role: 'vae' },
    { id: 'intella.minimax-h3-audio-vae',        role: 'audio_vae' },
  ],
  vramGb: 48,
  canonica: true,
  natum: new Date('2026-09-01'),
  mutatum: new Date('2026-09-01'),
}

/** All canonical fundamenta — seeded on boot (parity with CANONICAL_ESSENTIAE). */
export const CANONICAL_FUNDAMENTA: Fundamentum[] = [
  FUNDAMENTUM_FLUX_COMFYUI,
  FUNDAMENTUM_SD15_COMFYUI,
  FUNDAMENTUM_SDXL_COMFYUI,
  FUNDAMENTUM_CHROMA_COMFYUI,
  FUNDAMENTUM_FLUX_KONTEXT_COMFYUI,
  FUNDAMENTUM_FLUX2_KLEIN_COMFYUI,
  FUNDAMENTUM_FLUX2_KLEIN_4B_COMFYUI,
  FUNDAMENTUM_ZIMAGE_TURBO_COMFYUI,
  FUNDAMENTUM_KREA2_TURBO_COMFYUI,
  FUNDAMENTUM_COMFYUI_BASE,
  FUNDAMENTUM_UPSCALE_COMFYUI,
  FUNDAMENTUM_QWEN_VL_VLLM,
  FUNDAMENTUM_MOSS_SGLANG,
  FUNDAMENTUM_HEARTMULA_PYTORCH,
  FUNDAMENTUM_HUNYUAN3D_PYTORCH,
  FUNDAMENTUM_AITOOLKIT_TRAINING,
  FUNDAMENTUM_LTX_COMFYUI,
  FUNDAMENTUM_WAN22_T2V_COMFYUI,
  FUNDAMENTUM_WAN22_I2V_COMFYUI,
  FUNDAMENTUM_MINIMAX_H3_COMFYUI,
]
