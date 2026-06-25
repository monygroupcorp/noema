import type { Modus } from '../../types/modus.js'
import { hashModus } from '../hashModus.js'

// =============================================================================
// Canonical Third-Party Tool Modi
//
// These seed the noema.modi collection so they are available for the
// FlowEngine's ExecuteFlow to browse and launch.
//
// contentHash is computed via hashModus() — excludes natum/mutatum/contentHash
// itself so the hash covers only the functional definition.
// =============================================================================

function make(def: Omit<Modus, 'contentHash'>): Modus {
  const withPlaceholder = { ...def, contentHash: '' }
  return { ...withPlaceholder, contentHash: hashModus(withPlaceholder) }
}

export const MODUS_CHATGPT: Modus = make({
  id: 'modus.chatgpt',
  nomen: 'ChatGPT — text generation',
  genus: 'atomicus',
  versio: '1.0.0',
  ministerium: 'openai',
  deliveryMode: 'sync',
  canonica: true,
  impetusFixum: 10n,

  aditus: {
    prompt:      { type: 'text',  required: true,  description: 'The user message or prompt' },
    model:       { type: 'text',  required: false, default: 'gpt-4o',  description: 'OpenAI model ID' },
    temperature: { type: 'float', required: false, default: 0.7,       description: 'Sampling temperature' },
  },

  exitus: {
    response: { type: 'text', description: 'Generated text response' },
  },

  natum:   new Date('2025-01-01'),
  mutatum: new Date('2025-01-01'),
})

export const MODUS_DALLE_III: Modus = make({
  id: 'modus.dalle-iii',
  nomen: 'DALL·E 3 — image generation',
  genus: 'atomicus',
  versio: '1.0.0',
  ministerium: 'openai',
  deliveryMode: 'sync',
  canonica: true,
  impetusFixum: 50n,

  aditus: {
    prompt:  { type: 'text', required: true,  description: 'Image description' },
    size:    { type: 'text', required: false, default: '1024x1024', description: 'Image dimensions' },
    quality: { type: 'text', required: false, default: 'standard',  description: 'standard or hd' },
  },

  exitus: {
    image: { type: 'image', description: 'The generated image (URL)' },
  },

  natum:   new Date('2025-01-01'),
  mutatum: new Date('2025-01-01'),
})

export const MODUS_JOYCAPTION: Modus = make({
  id: 'modus.joycaption',
  nomen: 'JoyCaption — image captioning',
  genus: 'atomicus',
  versio: '1.0.0',
  ministerium: 'huggingface',
  deliveryMode: 'sync',
  canonica: true,
  impetusFixum: 5n,

  aditus: {
    __spaceUrl:   { type: 'text',  required: true,  default: 'fancyfeast/joy-caption-pre-alpha', description: 'HuggingFace space URL' },
    image:        { type: 'image', required: true,  description: 'Image to caption' },
    caption_type: { type: 'text',  required: false, default: 'Descriptive', description: 'Caption style' },
  },

  exitus: {
    caption: { type: 'text', description: 'Generated caption' },
  },

  natum:   new Date('2025-01-01'),
  mutatum: new Date('2025-01-01'),
})

export const MODUS_LAYER_COMPOSITE: Modus = make({
  id: 'modus.layer-composite',
  nomen: 'Layer Composite — z-order image compositing',
  genus: 'atomicus',
  versio: '1.0.0',
  ministerium: 'composite',
  deliveryMode: 'sync',
  canonica: true,
  // Host-side deterministic processing — no GPU, no per-second pod cost.

  aditus: {
    // Declared `text` so an array of URLs passes validateAditus intact (arrays
    // pass through for text ports). Bottom→top z-order.
    layers: { type: 'text', required: true,  description: 'Ordered image layer URLs, bottom→top (array or single URL)' },
    width:  { type: 'int',  required: false, description: 'Canvas width in px (default: widest layer)' },
    height: { type: 'int',  required: false, description: 'Canvas height in px (default: tallest layer)' },
  },

  exitus: {
    image: { type: 'image', description: 'The flattened composite PNG' },
  },

  natum:   new Date('2026-06-19'),
  mutatum: new Date('2026-06-19'),
})

export const MODUS_FRAMES_TO_VIDEO: Modus = make({
  id: 'modus.frames-to-video',
  nomen: 'Frames → Video — assemble frames into an animation',
  genus: 'atomicus',
  versio: '1.0.0',
  ministerium: 'ffmpeg',
  deliveryMode: 'sync',
  canonica: true,
  // Host-side deterministic processing — no GPU, no per-second pod cost.

  aditus: {
    // `text` so an array of frame URLs passes validateAditus intact. Playback order.
    frames: { type: 'text', required: true,  description: 'Ordered frame image URLs (array or single URL)' },
    fps:    { type: 'int',  required: false, default: 12,    description: 'Frames per second (1–60)' },
    format: { type: 'text', required: false, default: 'mp4', description: 'Output container: mp4 or webm' },
  },

  exitus: {
    video: { type: 'video', description: 'The assembled animation' },
  },

  natum:   new Date('2026-06-19'),
  mutatum: new Date('2026-06-19'),
})

export const MODUS_AITOOLKIT_TRAINING: Modus = make({
  id: 'modus.aitoolkit-training',
  nomen: 'LoRA Training — ai-toolkit',
  genus: 'atomicus',
  versio: '1.0.0',
  ministerium: 'aitoolkit',
  deliveryMode: 'sync',   // the local cursor blocks for the run; the remote variant (Slice E) is async
  canonica: true,
  // No impetusFixum: cost is runtime-duration based (the Modus convention for pod tools). The
  // LOCAL cursor still charges `impetusFixum ?? 0n` = 0n (self-hosted); the REMOTE cursor (Slice E)
  // reserves a pod-seconds cap, settled to the actual run length at the completion webhook.

  // The user-facing contract: a DATASET + a few knobs. The modus SYNTHESISES the
  // ai-toolkit training yaml from these (buildAitkConfig, per base-model preset) — users
  // never author a config. Captions are optional (.txt beside the images); when absent the
  // caption arm (Slice D) fills them in upstream.
  aditus: {
    dataset:       { type: 'text', required: true,  description: 'Image folder to train on (with optional .txt captions)' },
    triggerWord:   { type: 'text', required: true,  description: 'The LoRA trigger word — becomes its trigger, and its slug unless `slug` overrides' },
    slug:          { type: 'text', required: false, description: 'Published repo name + dest stem, when it must differ from the trigger (e.g. a `<name>-klein` backlog repo whose /make trigger stays the original word)' },
    baseModel:     { type: 'text', required: true,  description: 'Base model preset (e.g. klein-4b) — also the familia /make resolves on' },
    steps:         { type: 'int',  required: true,  description: 'Training steps — additional steps when resuming (drives the config + step/ETA progress)' },
    resumeFrom:    { type: 'text', required: false, description: 'Resume/continue weights-only: a prior LoRA weights URL (a rescued checkpoint to recover a crashed run, or a finished LoRA to extend)' },
    saveEvery:     { type: 'int',  required: false, description: 'Checkpoint cadence (default min(steps, 250))' },
    rank:          { type: 'int',  required: false, description: 'LoRA rank (default per base model)' },
    gpuId:         { type: 'text', required: false, description: 'GPU device id (default 0)' },
    jobId:         { type: 'text', required: false, description: 'Run id — defaults to the actum id; becomes the config name' },
    jobConfig:     { type: 'text', required: false, description: 'Optional JSON stored on the Job row' },
    baseIntellaId: { type: 'text', required: false, description: 'The exact base Intella trained against (provenance)' },
    ownerAnimaId:  { type: 'text', required: false, description: 'Owner of the resulting private LoRA (scopes /make resolution)' },
    name:          { type: 'text', required: false, description: 'Display name for the trained LoRA (defaults to the trigger)' },
    description:    { type: 'text', required: false, description: 'Human description for the published model card' },
    provenanceRepo:{ type: 'text', required: false, description: 'Source registry repo this was retrained from (model-card backlink, e.g. ms2stationthis/drifella)' },
    provenanceBase:{ type: 'text', required: false, description: 'Base the source model came off (e.g. FLUX.1-dev)' },
  },

  exitus: {
    trained: { type: 'text', description: 'Completion flag — true when the run finished and the LoRA was registered' },
    steps:   { type: 'int',  description: 'The last training step reached' },
    loraId:  { type: 'text', description: 'Id of the registered LoRA Intella' },
    loraUrl: { type: 'text', description: 'Our-bucket (R2) download URL for the trained weights' },
  },

  natum:   new Date('2026-06-23'),
  mutatum: new Date('2026-06-23'),
})

export const CANONICAL_MODI: Modus[] = [
  MODUS_CHATGPT,
  MODUS_DALLE_III,
  MODUS_JOYCAPTION,
  MODUS_LAYER_COMPOSITE,
  MODUS_FRAMES_TO_VIDEO,
  MODUS_AITOOLKIT_TRAINING,
]
