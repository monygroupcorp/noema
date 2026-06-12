import type { Essentia } from '../../types/essendi.js'

// =============================================================================
// Canonical Essentiae — platform atomic operations
//
// Each Essentia is the crystal representation of a platform tool. It REFERENCES
// its compute substrate (`Fundamentum`, see seeds/fundamenta.ts) by id+versio —
// the substrate carries the image, runtime, and base/support weights. The
// Essentia keeps its own FORM: workflowTemplate + seedInputKey + cookFlags.
// (Decomposed from the former provider-named `runpodSpec` — ADR-0005.)
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

  // Substrate: the FLUX·ComfyUI fundament carries image + runtime + base weights.
  // Family ('flux') derives from the fundament's weights' `Intella.familia`.
  fundamentumId: 'flux-comfyui',
  fundamentumVersio: '1.0.0',

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

  // Form: which workflow graph runs on the fundament, + seed/cook defaults.
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

  // Substrate: the SD1.5·ComfyUI fundament (self-contained checkpoint).
  // Family ('sd15') derives from the fundament's weight's `Intella.familia`.
  fundamentumId: 'sd15-comfyui',
  fundamentumVersio: '1.0.0',

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

  // Form: which workflow graph runs on the fundament, + seed/cook defaults.
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

  natum: new Date('2025-01-01'),
  mutatum: new Date('2025-01-01'),
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
    prompt:      { type: 'text',  required: true,  description: 'The question or instruction' },
    image:       { type: 'image', required: false, description: 'Image to reason over (optional)' },
    max_tokens:  { type: 'int',   required: false, default: 1024, description: 'Max output tokens' },
    temperature: { type: 'float', required: false, default: 0.7,  description: 'Sampling temperature' },
  },
  exitus: {
    text: { type: 'text', description: 'The model\'s textual answer' },
  },

  natum: new Date('2026-06-11'),
  mutatum: new Date('2026-06-11'),
}

export const ESSENTIA_MOSS_MUSIC: Essentia = {
  id: 'moss-music-8b',
  nomen: 'MOSS-Music — audio to text (music understanding)',
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
  genus: 'atomicus',
  versio: '1.0.0',
  contentHash: '',
  ministerium: 'runpod',
  canonica: true,
  categoria: 'text',

  fundamentumId: 'qwen-vl-vllm',
  fundamentumVersio: '1.0.0',
  intellae: [{ id: 'intella.shotvl-7b', role: 'lm' }],

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

export const CANONICAL_ESSENTIAE: Essentia[] = [
  ESSENTIA_RUNMAKE_FLUX_SCHNELL,
  ESSENTIA_RUNMAKE_SD15,
  ESSENTIA_QWEN3_VL,
  ESSENTIA_MOSS_MUSIC,
  ESSENTIA_SHOTVL,
]
