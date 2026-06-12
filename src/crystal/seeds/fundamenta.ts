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

/** All canonical fundamenta — seeded on boot (parity with CANONICAL_ESSENTIAE). */
export const CANONICAL_FUNDAMENTA: Fundamentum[] = [
  FUNDAMENTUM_FLUX_COMFYUI,
  FUNDAMENTUM_SD15_COMFYUI,
  FUNDAMENTUM_QWEN_VL_VLLM,
  FUNDAMENTUM_MOSS_SGLANG,
  FUNDAMENTUM_HEARTMULA_PYTORCH,
]
