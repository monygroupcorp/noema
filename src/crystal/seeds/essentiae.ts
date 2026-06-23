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

  natum: new Date('2025-01-01'),
  mutatum: new Date('2025-01-01'),
}

export const ESSENTIA_RUNMAKE_SDXL: Essentia = {
  id: 'sdxl',
  nomen: 'Stable Diffusion XL — text to image',
  genus: 'atomicus',
  versio: '1.0.0',
  contentHash: '',        // set on registration via hashModus()
  ministerium: 'runpod',
  canonica: true,
  categoria: 'image',

  // Substrate: the SDXL·ComfyUI fundament (self-contained checkpoint).
  // Family ('sdxl') derives from the fundament's weight's `Intella.familia`.
  fundamentumId: 'sdxl-comfyui',
  fundamentumVersio: '1.0.0',

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
  genus: 'atomicus',
  versio: '1.0.0',
  contentHash: '',        // set on registration via hashModus()
  ministerium: 'runpod',
  canonica: true,
  categoria: 'image',

  // Substrate: the Chroma·ComfyUI fundament (Chroma unet + shared FLUX T5/VAE).
  // Family ('chroma') derives from the unet weight's `Intella.familia`.
  fundamentumId: 'chroma-comfyui',
  fundamentumVersio: '1.0.0',

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

// FLUX img2img / restyle — i2i (effect). The input image is VAE-encoded to a latent and partially
// denoised (`strength`), so the output keeps the source composition and restyles per the prompt. Reuses
// the shared flux-comfyui substrate (schnell unet + flux VAE + T5/CLIP — all seeded). The `image` aditus
// rides the i2i primitive into a LoadImage node feeding VAEEncode. categoria 'image'.
export const ESSENTIA_FLUXI2I: Essentia = {
  id: 'flux-i2i',
  nomen: 'FLUX — image to image (restyle)',
  genus: 'atomicus',
  versio: '1.0.0',
  contentHash: '',
  ministerium: 'runpod',
  canonica: true,
  categoria: 'image',

  fundamentumId: 'flux-comfyui',
  fundamentumVersio: '1.0.0',

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
  genus: 'atomicus',
  versio: '1.0.0',
  contentHash: '',
  ministerium: 'runpod',
  canonica: true,
  categoria: 'image',

  fundamentumId: 'flux-kontext-comfyui',
  fundamentumVersio: '1.0.0',

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
  genus: 'atomicus',
  versio: '1.0.0',
  contentHash: '',
  ministerium: 'runpod',
  canonica: true,
  categoria: 'image',

  fundamentumId: 'flux2-klein-comfyui',
  fundamentumVersio: '1.0.0',

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

// Background removal — i2i (enhance). InspyrenetRembg pack (self-downloads its ckpt) on the weightless
// comfyui-base substrate. The `image` aditus rides the i2i primitive into a LoadImage feeding the rembg
// node; output is the cut-out (transparent PNG). categoria 'image'.
export const ESSENTIA_RMBG: Essentia = {
  id: 'rmbg',
  nomen: 'Remove background',
  genus: 'atomicus',
  versio: '1.0.0',
  contentHash: '',
  ministerium: 'runpod',
  canonica: true,
  categoria: 'image',

  fundamentumId: 'comfyui-base',
  fundamentumVersio: '1.0.0',

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
  genus: 'atomicus',
  versio: '1.0.0',
  contentHash: '',        // set on registration via hashModus()
  ministerium: 'runpod',
  canonica: true,
  categoria: 'image',

  fundamentumId: 'upscale-comfyui',
  fundamentumVersio: '1.0.0',

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
  genus: 'atomicus',
  versio: '1.0.0',
  contentHash: '',
  ministerium: 'runpod',
  canonica: true,
  categoria: '3d',

  fundamentumId: 'hunyuan3d-pytorch',
  fundamentumVersio: '1.0.0',

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

export const CANONICAL_ESSENTIAE: Essentia[] = [
  ESSENTIA_RUNMAKE_FLUX_SCHNELL,
  ESSENTIA_RUNMAKE_SD15,
  ESSENTIA_RUNMAKE_SDXL,
  ESSENTIA_RUNMAKE_CHROMA,
  ESSENTIA_FLUXI2I,
  ESSENTIA_KONTEXTEDIT,
  ESSENTIA_KLEINEDIT,
  ESSENTIA_RMBG,
  ESSENTIA_UPSCALE,
  ESSENTIA_QWEN3_VL,
  ESSENTIA_QWEN3_VL_CAPTION,
  ESSENTIA_MOSS_MUSIC,
  ESSENTIA_SHOTVL,
  ESSENTIA_HEARTMULA,
  ESSENTIA_HUNYUAN3D,
]
