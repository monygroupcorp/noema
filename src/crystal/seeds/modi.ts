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
  descriptio: 'ChatGPT text generation via OpenAI — a prompt in, a text response out. Pick it for OpenAI-hosted chat/completion; use OpenRouter to reach non-OpenAI models through one endpoint.',
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
    // Routing key (mirrors __spaceUrl): declares the ApiCursor capability. Hidden internal port.
    __capability: { type: 'text', required: false, default: 'chat',    description: 'ApiCursor capability (internal)' },
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
  descriptio: 'DALL·E 3 text-to-image via OpenAI — a hosted API image generator (no GPU, fixed cost). Pick it for quick OpenAI image gen; use the pod flows (FLUX/SDXL) for LoRAs and local control.',
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
    __capability: { type: 'text', required: false, default: 'image', description: 'ApiCursor capability (internal)' },
  },

  exitus: {
    image: { type: 'image', description: 'The generated image (URL)' },
  },

  natum:   new Date('2025-01-01'),
  mutatum: new Date('2025-01-01'),
})

// OpenAI image editing (gpt-image edit): input image (+ optional mask) + prompt → edited image.
// Closes the imageEdit / gpt-image-compose VERIFY seam. Same `ministerium: 'openai'`, capability 'imageEdit'.
export const MODUS_GPT_IMAGE_EDIT: Modus = make({
  id: 'modus.gpt-image-edit',
  nomen: 'GPT Image — image editing',
  descriptio: 'GPT Image editing via OpenAI — edits a source image from a text instruction, with an optional mask for local edits. Pick it for hosted OpenAI edits; use FLUX Kontext/Klein for pod-side, LoRA-capable edits.',
  genus: 'atomicus',
  versio: '1.0.0',
  ministerium: 'openai',
  deliveryMode: 'sync',
  canonica: true,
  impetusFixum: 50n,

  aditus: {
    image:  { type: 'image', required: true,  description: 'The source image to edit' },
    prompt: { type: 'text',  required: true,  description: 'What to change / the edit instruction' },
    mask:   { type: 'image', required: false, description: 'Optional mask — transparent areas are edited' },
    model:  { type: 'text',  required: false, default: 'gpt-image-1', description: 'OpenAI image model ID' },
    __capability: { type: 'text', required: false, default: 'imageEdit', description: 'ApiCursor capability (internal)' },
  },

  exitus: {
    image: { type: 'image', description: 'The edited image (URL)' },
  },

  natum:   new Date('2026-07-02'),
  mutatum: new Date('2026-07-02'),
})

// OpenRouter chat — proves the descriptor generalizes: a new provider is a
// descriptor + env key + this one seed, with ZERO new cursor code.
export const MODUS_OPENROUTER_CHAT: Modus = make({
  id: 'modus.openrouter-chat',
  nomen: 'OpenRouter — text generation',
  descriptio: 'OpenRouter text generation — one endpoint that routes to many providers/models (provider/model id). Pick it to reach non-OpenAI LLMs; use the ChatGPT flow when you specifically want OpenAI.',
  genus: 'atomicus',
  versio: '1.0.0',
  ministerium: 'openrouter',
  deliveryMode: 'sync',
  canonica: true,
  impetusFixum: 10n,

  aditus: {
    prompt:      { type: 'text',  required: true,  description: 'The user message or prompt' },
    model:       { type: 'text',  required: false, default: 'openai/gpt-4o', description: 'OpenRouter model ID (provider/model)' },
    temperature: { type: 'float', required: false, default: 0.7,       description: 'Sampling temperature' },
    __capability: { type: 'text', required: false, default: 'chat',    description: 'ApiCursor capability (internal)' },
  },

  exitus: {
    response: { type: 'text', description: 'Generated text response' },
  },

  natum:   new Date('2026-07-02'),
  mutatum: new Date('2026-07-02'),
})

export const MODUS_LAYER_COMPOSITE: Modus = make({
  id: 'modus.layer-composite',
  nomen: 'Layer Composite — z-order image compositing',
  descriptio: 'Layer Composite — flattens ordered image layers (bottom→top) into one PNG, host-side and deterministic (no GPU). Pick it to stack/merge images; use Remove Background first to cut out subjects.',
  genus: 'atomicus',
  versio: '1.0.0',
  ministerium: 'composite',
  deliveryMode: 'sync',
  canonica: true,
  // Host-side deterministic processing — no GPU, no per-second pod cost.

  // Explicit override (noema-087): the URL-array `layers` port is typed 'text' (a
  // validateAditus smuggling workaround), making this structurally invisible to the
  // cascade — it resolves off `exitus` alone instead of its true image->image shape.
  // Best-fit existing verb: `effect` (i2i — image transform; z-order compositing is
  // a same-modality image transform, the closest of the 14 canon verbs).
  verbum: 'effect',

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
  descriptio: 'Frames → Video — stitches ordered frame images into an mp4/webm at a chosen fps, host-side (no GPU). Pick it to assemble existing frames; use a t2v/i2v flow (Wan2.2, LTX) to generate motion.',
  genus: 'atomicus',
  versio: '1.0.0',
  ministerium: 'ffmpeg',
  deliveryMode: 'sync',
  canonica: true,
  // Host-side deterministic processing — no GPU, no per-second pod cost.

  // Explicit override (noema-087): the URL-array `frames` port is typed 'text' (a
  // validateAditus smuggling workaround), making this structurally invisible to the
  // cascade — it resolves off `exitus` alone instead of its true image(s)->video
  // shape. Best-fit existing verb: `animate` (i2v — video from a still; assembling
  // frames into an animation is the same image-to-video family).
  verbum: 'animate',

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
  descriptio: 'LoRA Training (ai-toolkit) — trains a custom LoRA from an image dataset + trigger word on a chosen base model. Pick it to create a new LoRA; then run the LoRA-capable make/edit flows to use it.',
  genus: 'atomicus',
  versio: '1.0.0',
  ministerium: 'aitoolkit',
  deliveryMode: 'sync',   // the local cursor blocks for the run; the remote variant (Slice E) is async
  canonica: true,
  // No impetusFixum: cost is runtime-duration based (the Modus convention for pod tools). The
  // LOCAL cursor still charges `impetusFixum ?? 0n` = 0n (self-hosted); the REMOTE cursor (Slice E)
  // reserves a pod-seconds cap, settled to the actual run length at the completion webhook.

  // Explicit override (noema-087): all aditus ports are typed 'text'/'int' (no media
  // port at all — `dataset` is a folder path string), so the cascade's text rule
  // fires and falls to `chat` on the (text-typed) `trained` exitus. No canon verb for
  // "trains a LoRA" exists in the 14-verb list; least-wrong fallback: `compose`
  // (t2a·music's generic "assemble/create a new artifact from inputs" sense is the
  // closest existing intent to synthesizing a trained weights artifact from a
  // dataset). FLAGGED for operator review — this is a fallback, not an exact fit.
  verbum: 'compose',

  // The user-facing contract: a DATASET + a few knobs. The modus SYNTHESISES the
  // ai-toolkit training yaml from these (buildAitkConfig, per base-model preset) — users
  // never author a config. Captions are optional (.txt beside the images); when absent the
  // caption arm (Slice D) fills them in upstream.
  aditus: {
    dataset:       { type: 'text', required: true,  description: 'Image folder to train on (with optional .txt captions)' },
    triggerWord:   { type: 'text', required: true,  description: 'The LoRA trigger word — becomes its trigger, and its slug unless `slug` overrides' },
    slug:          { type: 'text', required: false, description: 'Published repo name + dest stem, when it must differ from the trigger (e.g. a `<name>-klein` backlog repo whose /make trigger stays the original word)' },
    samplePrompts: { type: 'text', required: false, description: 'JSON array of end-of-run sample prompts for the card gallery (`[trigger]` substituted) — pass dataset-caption-derived prompts to preview what the LoRA actually learned; defaults to a generic framing set' },
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
  MODUS_GPT_IMAGE_EDIT,
  MODUS_OPENROUTER_CHAT,
  MODUS_LAYER_COMPOSITE,
  MODUS_FRAMES_TO_VIDEO,
  MODUS_AITOOLKIT_TRAINING,
]
