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

  defaultCookFlags: { vramGb: 24 },

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

  defaultCookFlags: { vramGb: 12 },

  natum: new Date('2026-06-12'),
  mutatum: new Date('2026-06-12'),
}

export const CANONICAL_ESSENTIAE: Essentia[] = [
  ESSENTIA_RUNMAKE_FLUX_SCHNELL,
  ESSENTIA_RUNMAKE_SD15,
  ESSENTIA_QWEN3_VL,
  ESSENTIA_MOSS_MUSIC,
  ESSENTIA_SHOTVL,
  ESSENTIA_HEARTMULA,
  ESSENTIA_HUNYUAN3D,
]
