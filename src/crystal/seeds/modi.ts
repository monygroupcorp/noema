import type { Modus } from '../../types/modus.js'
import { hashModus } from '../hashModus.js'
import { lintOwnedDeclarations } from '../../execution/ownedResources.js'

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

// Retained for historical actus only — its contentHash is referenced by past runs.
// Superseded by modus.openrouter-chat, which reaches the same OpenAI models plus everything
// else OpenRouter routes to, with an actual model picker (noema-144).
export const MODUS_CHATGPT: Modus = make({
  id: 'modus.chatgpt',
  nomen: 'ChatGPT — text generation',
  descriptio: 'ChatGPT text generation via OpenAI — a prompt in, a text response out. Pick it for OpenAI-hosted chat/completion; use OpenRouter to reach non-OpenAI models through one endpoint.',
  genus: 'atomicus',
  versio: '1.0.0',
  ministerium: 'openai',
  deliveryMode: 'sync',
  canonica: false,
  impetusFixum: 10n,

  aditus: {
    prompt:      { type: 'text',  required: true,  description: 'The user message or prompt' },
    // The conversation-threading port. `ApiCursor.runChat` reads it (`Array.isArray(aditus.messages)`)
    // and sends it as the chat body's `messages`, falling back to a single user turn built from
    // `prompt` when it is absent; `ExecuteFlow.enter` routes on it too (a modusId plus a
    // `messages[]` already in state skips the form and submits). `validateAditus` iterates the
    // SCHEMA, so an undeclared key is not copied forward — declared, so a threaded reply keeps its
    // history on the routes that validate. Typed 'text' because that is the one declared type whose
    // coercion passes an Array through untouched, which is the shape both readers expect.
    messages:    { type: 'text',  required: false, description: 'Conversation history as an array of { role, content } turns. Present, it is sent as-is and `prompt` is unused; absent, the chat is a single turn built from `prompt`.' },
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

// Retained for historical actus only — its contentHash is referenced by past runs.
// Superseded by modus.gpt-image, the same hosted OpenAI text-to-image lane on the current image
// model; DALL·E 3 is deprecated upstream.
export const MODUS_DALLE_III: Modus = make({
  id: 'modus.dalle-iii',
  nomen: 'DALL·E 3 — image generation',
  descriptio: 'DALL·E 3 text-to-image via OpenAI — a hosted API image generator (no GPU, fixed cost). Superseded by GPT Image; use the pod flows (FLUX/SDXL) for LoRAs and local control.',
  genus: 'atomicus',
  versio: '1.0.0',
  ministerium: 'openai',
  deliveryMode: 'sync',
  canonica: false,
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

// OpenAI image generation (gpt-image): prompt → image. The canon hosted text-to-image lane —
// the option that runs for any account with no pod and no setup. No `model` port: the model
// comes from the provider's image-capability `defaultModel`, so the lane moves with the provider
// rather than with a seeded string.
export const MODUS_GPT_IMAGE: Modus = make({
  id: 'modus.gpt-image',
  nomen: 'GPT Image — image generation',
  descriptio: 'GPT Image text-to-image via OpenAI — a hosted API image generator (no GPU, fixed cost). Pick it for quick hosted image gen; use the pod flows (FLUX/SDXL) for LoRAs and local control.',
  genus: 'atomicus',
  versio: '1.0.0',
  ministerium: 'openai',
  deliveryMode: 'sync',
  canonica: true,
  impetusFixum: 50n,

  aditus: {
    prompt:  { type: 'text', required: true,  description: 'Image description' },
    size:    { type: 'text', required: false, default: '1024x1024', description: 'Image dimensions (1024x1024, 1536x1024, 1024x1536, or auto)' },
    quality: { type: 'text', required: false, default: 'auto',      description: 'Render quality — low, medium, high, or auto' },
    __capability: { type: 'text', required: false, default: 'image', description: 'ApiCursor capability (internal)' },
  },

  exitus: {
    image: { type: 'image', description: 'The generated image' },
  },

  natum:   new Date('2026-08-25'),
  mutatum: new Date('2026-08-25'),
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
  descriptio: 'OpenRouter text generation — one endpoint that routes to many providers/models. OpenAI models are reachable through it directly, alongside everything else OpenRouter carries.',
  genus: 'atomicus',
  versio: '1.0.0',
  ministerium: 'openrouter',
  deliveryMode: 'sync',
  canonica: true,
  impetusFixum: 10n,

  aditus: {
    prompt:      { type: 'text',  required: true,  description: 'The user message or prompt' },
    // Same port, same reason as on `modus.chatgpt` above — every chat modus reaches the one
    // `ApiCursor.runChat`, so each must declare the threading port that path reads.
    messages:    { type: 'text',  required: false, description: 'Conversation history as an array of { role, content } turns. Present, it is sent as-is and `prompt` is unused; absent, the chat is a single turn built from `prompt`.' },
    model:       {
      type: 'text', required: false, default: 'openai/gpt-4o', description: 'OpenRouter model ID (provider/model)',
      optiones: [
        { value: 'openai/gpt-4o',                       label: 'OpenAI — GPT-4o' },
        { value: 'anthropic/claude-sonnet-4.5',         label: 'Anthropic — Claude Sonnet 4.5' },
        { value: 'google/gemini-2.5-flash',             label: 'Google — Gemini 2.5 Flash' },
        { value: 'meta-llama/llama-3.3-70b-instruct',   label: 'Meta — Llama 3.3 70B (open-weights)' },
      ],
    },
    temperature: { type: 'float', required: false, default: 0.7,       description: 'Sampling temperature' },
    __capability: { type: 'text', required: false, default: 'chat',    description: 'ApiCursor capability (internal)' },
  },

  exitus: {
    response: { type: 'text', description: 'Generated text response' },
  },

  natum:   new Date('2026-07-02'),
  mutatum: new Date('2026-07-02'),
})

// Venice chat — a second OpenAI-compatible provider seeded to prove the descriptor
// abstraction holds for a real third-party addition, not just the reference pair (noema-144).
export const MODUS_VENICE_CHAT: Modus = make({
  id: 'modus.venice-chat',
  nomen: 'Venice — text generation',
  descriptio: 'Venice text generation — an OpenAI-compatible endpoint with its own model roster. Pick it to reach Venice-hosted models directly rather than through OpenRouter.',
  genus: 'atomicus',
  versio: '1.0.0',
  ministerium: 'venice',
  deliveryMode: 'sync',
  canonica: true,
  impetusFixum: 10n,

  aditus: {
    prompt:      { type: 'text',  required: true,  description: 'The user message or prompt' },
    // Same port, same reason as on `modus.chatgpt` above — every chat modus reaches the one
    // `ApiCursor.runChat`, so each must declare the threading port that path reads.
    messages:    { type: 'text',  required: false, description: 'Conversation history as an array of { role, content } turns. Present, it is sent as-is and `prompt` is unused; absent, the chat is a single turn built from `prompt`.' },
    model:       {
      type: 'text', required: false, default: 'llama-3.3-70b', description: 'Venice model ID',
      optiones: [
        { value: 'llama-3.3-70b',                 label: 'Llama 3.3 70B' },
        { value: 'venice-uncensored',              label: 'Venice Uncensored' },
        { value: 'mistral-31-24b',                 label: 'Mistral 3.1 24B' },
        { value: 'qwen3-235b-a22b-instruct-2507',  label: 'Qwen3 235B Instruct' },
      ],
    },
    temperature: { type: 'float', required: false, default: 0.7,       description: 'Sampling temperature' },
    __capability: { type: 'text', required: false, default: 'chat',    description: 'ApiCursor capability (internal)' },
  },

  exitus: {
    response: { type: 'text', description: 'Generated text response' },
  },

  natum:   new Date('2026-08-06'),
  mutatum: new Date('2026-08-06'),
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
    // A CORPUS reference, or an inline image manifest. Declared owned so the run entry point
    // resolves the reference for the calling anima before a pod is provisioned: the resolved
    // manifest is what gets staged onto the pod, so this port decides whose images the run
    // reads. An inline manifest is the caller's own input and names no stored record — the
    // check passes it through.
    dataset:       { type: 'text', required: true,  owned: { genus: 'corpus' }, description: 'Image folder to train on (with optional .txt captions)' },
    triggerWord:   { type: 'text', required: true,  description: 'The LoRA trigger word — becomes its trigger, and its slug unless `slug` overrides' },
    slug:          { type: 'text', required: false, description: 'Published repo name + dest stem, when it must differ from the trigger (e.g. a `<name>-klein` backlog repo whose /make trigger stays the original word)' },
    samplePrompts: { type: 'text', required: false, description: 'JSON array of end-of-run sample prompts for the card gallery (`[trigger]` substituted) — pass dataset-caption-derived prompts to preview what the LoRA actually learned; defaults to a generic framing set' },
    baseModel:     { type: 'text', required: true,  description: 'Base model preset (e.g. klein-4b) — also the familia /make resolves on' },
    steps:         { type: 'int',  required: true,  description: 'Training steps — additional steps when resuming (drives the config + step/ETA progress)' },
    resumeFrom:    { type: 'text', required: false, description: 'Resume/continue weights-only: a prior LoRA weights URL (a rescued checkpoint to recover a crashed run, or a finished LoRA to extend)' },
    // The caption opt-out. `RemoteAitoolkitTrainingCursor` reads it as `aditus.autocaption !== false`
    // and passes the result to the launcher, so the port is default-ON and only an explicit `false`
    // turns it off. Declared because `validateAditus` iterates the SCHEMA — undeclared, the key is
    // not copied forward and the opt-out cannot be expressed on any route that validates.
    //
    // Typed 'bool', deliberately, and this is the whole reason that type exists: a 'text'
    // declaration would coerce `false` with `String(value)` into 'false', which is `!== false` and
    // therefore reads as ON — an opt-out that validates cleanly and does the opposite of what was
    // asked. 'bool' passes a real boolean through and maps the 'true'/'false' strings a form
    // produces onto the matching boolean.
    autocaption:   { type: 'bool', required: false, description: 'Caption the dataset images that carry no caption before training. Default on; pass false to train on the captions as they are.' },
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

export const MODUS_DATASET_CAPTION: Modus = make({
  id: 'modus.dataset-caption',
  nomen: 'Dataset Captioning — batch',
  descriptio: 'Dataset Captioning (batch) — captions a dataset\'s images in one pod pass and stores the result as a captionset on that dataset. Given a captionset it EXTENDS it, captioning only the images that captionset does not already cover; given none it captions the whole working set and mints one. Pick it to prepare a dataset for LoRA training; use the single-image caption spell for one-off captions.',
  genus: 'atomicus',
  versio: '1.0.0',

  // A ministerium of its OWN, distinct from the training modus'. `Cursorum` is a flat
  // Map<ministerium, Cursor> and `register` is a bare set, so a second cursor registered under
  // 'aitoolkit' would take over every training dispatch. The caption cursor gets its own key and
  // the training registration is left exactly as it is.
  ministerium: 'aitkcaption',

  // The pod runs the captioner and reports at the completion webhook, like the remote training
  // arm — the run is dispatched, not awaited.
  deliveryMode: 'async',
  canonica: true,
  // No impetusFixum: this is a pod tool billed on runtime duration, like the training modus. The
  // cursor reserves a pod-seconds cap and the completion webhook settles it down to the real
  // duration, so a caption job is metered exactly like any other run — no separate lifecycle.

  // Explicit override (the convention noema-087 established, and the same call
  // COMPOSITUS_IMAGE_CAPTION makes): every port here is 'text'/'int' — the images are reached
  // through a dataset id, not a media port — so the cascade's text rule fires and lands on a
  // chat-ish verb. This is image→text captioning: `describe`.
  verbum: 'describe',

  // The user-facing contract: a DATASET id plus optional captioner knobs. The modus synthesises
  // the ai-toolkit caption yaml (buildAitkCaptionConfig) — users never author a config.
  aditus: {
    // Declared owned: the pass writes a captionset ONTO the dataset this names, so the
    // reference decides whose dataset gains content the caller chose.
    dataset:        { type: 'text', required: true,  owned: { genus: 'dataset' }, description: 'Id of the dataset to caption' },
    // The EXTEND port. Declared because the cursor and the finalizer both read it: present, the
    // pass stages only the media this captionset does not cover and the harvest is written back
    // into it; absent, the pass captions the whole working set and mints a fresh captionset.
    // Typed 'text' because that is what both readers parse — a trimmed captionset id string.
    // A sub-resource of the dataset above (`parens: 'dataset'`): the id is checked against the
    // captionsets that dataset actually carries, so a captionset id cannot ride in from
    // somewhere else beside a dataset the caller does own.
    captionset:     { type: 'text', required: false, owned: { genus: 'captionset', parens: 'dataset' }, description: 'Id of the captionset on that dataset to EXTEND — only the images it does not already cover are captioned. Absent: caption the whole working set into a fresh captionset.' },
    name:           { type: 'text', required: false, description: 'Display name for the resulting captionset (defaults to a generated one)' },
    captionPrompt:  { type: 'text', required: false, description: 'Instruction handed to the captioner (defaults to the training-caption prompt)' },
    maxNewTokens:   { type: 'int',  required: false, description: 'Caption length cap in tokens (captioner default when absent)' },
    // The two run knobs `DatasetCaptionCursor` reads alongside the ports above — declared here for
    // the same reason, and with the same shape and defaults, as their counterparts on
    // `modus.aitoolkit-training`: the cursor reads them, so the schema must carry them.
    gpuId:          { type: 'text', required: false, description: 'GPU device id (default 0)' },
    jobId:          { type: 'text', required: false, description: 'Run id — defaults to the actum id; becomes the caption config name' },
  },

  // Matches the finalizer's return: the captionset it wrote, and what that pass actually covered.
  exitus: {
    captionsetId: { type: 'text', description: 'Id of the captionset written onto the dataset' },
    captioned:    { type: 'int',  description: 'How many media items this pass captioned' },
    coverage:     { type: 'text', description: 'Coverage of the dataset this pass reached, e.g. "12/12"' },
  },

  natum:   new Date('2026-08-14'),
  mutatum: new Date('2026-08-21'),
})

export const MODUS_DATASET_DECOMPOSE: Modus = make({
  id: 'modus.dataset-decompose',
  nomen: 'Dataset Decompose — captions into prompt fragments',
  descriptio: 'Dataset Decompose — runs captions from one captionset through the Muse decomposer and stores the resulting prompt fragments on the media items they came from. INCREMENTAL by default: only the media items that carry no fragments yet are decomposed, and a pass with nothing left to do is refused. Pass `redo` to decompose the whole captionset again. Pick it to fill a dataset\'s chip garden after captioning; caption the dataset first if it has no captionset yet.',
  genus: 'atomicus',
  versio: '1.0.0',

  // A ministerium of its OWN. `Cursorum` is a flat Map<ministerium, Cursor> whose `register` is a
  // bare set, so registering this on 'openai' (or any provider id) would replace the ApiCursor
  // bound to that key and send every hosted-API chat/image/image-edit dispatch into the
  // decomposer. The provider registrations stay exactly as they are; this arm owns its own key.
  ministerium: 'musegarden',

  // The cursor dispatches, then keeps running off-request; it settles its own run at the end
  // of the pass rather than on the dispatching call's return path (noema-338).
  deliveryMode: 'async',
  canonica: true,
  // No impetusFixum: cost is the summed real token cost of one chat call per caption. The cursor
  // reserves a ceiling from the caption count and settles down to actual usage, so a decompose is
  // metered exactly like any other run — no separate lifecycle and no free lane.

  // Explicit override (the convention noema-087 established): every port here is text, so the
  // cascade's text rule fires and lands on `chat`, which this is not. Caption text in, categorized
  // fragments out is an extraction over existing content: `describe`.
  verbum: 'describe',

  aditus: {
    // Both declared owned, for the reason the caption modus states: the pass READS the
    // captions on this dataset and WRITES fragments back onto its media items, so the pair
    // decides whose content the run reads and whose record it changes. The captionset is a
    // sub-resource of the dataset port beside it (`parens: 'dataset'`).
    dataset:    { type: 'text', required: true,  owned: { genus: 'dataset' }, description: 'Id of the dataset whose media items the fragments land on' },
    captionset: { type: 'text', required: true,  owned: { genus: 'captionset', parens: 'dataset' }, description: 'Id of the captionset on that dataset to decompose' },
    // The whole-set rebuild opt-in. Declared because the cursor reads it, and typed 'text' to
    // match what the cursor already parses: `isRedo` accepts a real `true` or one of the strings
    // a form control produces for it ('true' | '1' | 'yes', case- and space-insensitive), and
    // nothing else. 'text' is the only declared type that preserves that — `validateAditus`
    // coerces a declared 'text' port with `String(value)`, which maps `true` to 'true' and
    // `false` to 'false', both of which `isRedo` reads the same way it reads the raw value. No
    // declared type here turns an otherwise-incremental value truthy.
    redo:       { type: 'text', required: false, description: 'Decompose the WHOLE captionset again, including media items that already carry fragments — the expensive path, never the default. On: true | \'true\' | \'1\' | \'yes\'. Anything else leaves the pass incremental.' },
    trigger:    { type: 'text', required: false, description: 'Trigger word to strip from fragments, so they stay reusable rather than branded to one model' },
    model:      { type: 'text', required: false, description: 'Chat model id for the decomposer (the provider default when absent)' },
    provider:   { type: 'text', required: false, description: 'Hosted-API provider id to decompose on (the deployment default when absent)' },
  },

  // Matches the cursor's return exactly. Both counts are over the work THIS pass did, never over
  // the captionset it read — the same basis the settlement uses. The cursor does not compute or
  // return a skipped count, so none is declared: a declared exitus key nothing writes is as
  // misleading as an undeclared port.
  exitus: {
    decomposed: { type: 'int', description: 'How many media items this pass wrote fragments onto' },
    fragments:  { type: 'int', description: 'How many fragments were written in total' },
  },

  natum:   new Date('2026-08-18'),
  mutatum: new Date('2026-08-21'),
})

export const MODUS_MUSE_STEER: Modus = make({
  id: 'modus.muse-steer',
  nomen: 'Muse Steer — an instruction into a proposal',
  descriptio: 'Muse Steer — reads a short instruction against a Muse session\'s floor of prompt fragments and PROPOSES which to take off and which to add. It proposes only: the proposal is shown for approval, and the floor moves when the user confirms it and not before.',
  genus: 'atomicus',
  versio: '1.0.0',

  // A ministerium of its OWN, for the reason the decompose modus states above: `Cursorum` is a
  // flat Map<ministerium, Cursor> whose `register` is a bare set, so sharing a key with a
  // hosted-API provider would replace that provider's ApiCursor, and sharing 'musegarden' would
  // take over the decomposer. This arm owns its own key.
  ministerium: 'musesteer',

  // One chat call, in process, returning when the proposal is validated — no pod, no webhook.
  deliveryMode: 'sync',
  canonica: true,
  // No impetusFixum: the cursor reserves a ceiling from the floor size and settles the real token
  // cost of that one call — metered like any other run, with no free lane.

  // Explicit override (the noema-087 convention: the cascade decides and an override is argued).
  // The exitus is counts, so the cascade finds no output modality to key a row on and falls
  // through to its `enhance` catch-all; an instruction in and a proposal out is text in, text
  // out, and that is `chat`.
  verbum: 'chat',

  aditus: {
    instruction: { type: 'text', required: true,  description: 'What the user wants changed, in their own words. Bounded server-side — a steer is a short push, not a prompt.' },
    // The floor travels INLINE as an array of `{ category, text }` identities, never as a session
    // id: a cursor cannot resolve an owner (an Actum is identity-blind), so a cursor reading a
    // resource named in its aditus would be unscoped by construction. The API layer resolves the
    // session for the authenticated caller and passes the floor it read.
    floor:       { type: 'text', required: true,  description: 'The fragments to steer, as an array of { category, text } identities passed inline' },
    model:       { type: 'text', required: false, description: 'Chat model id for the interpreter (the provider default when absent)' },
    provider:    { type: 'text', required: false, description: 'Hosted-API provider id to steer on (the deployment default when absent)' },
  },

  exitus: {
    eliminations: { type: 'int', description: 'How many fragments the proposal offers to take off the floor' },
    additions:    { type: 'int', description: 'How many fragments the proposal offers to put on the floor' },
    dropped:      { type: 'int', description: 'How many proposed changes were dropped in validation' },
  },

  natum:   new Date('2026-08-20'),
  mutatum: new Date('2026-08-20'),
})

export const CANONICAL_MODI: Modus[] = [
  MODUS_CHATGPT,
  MODUS_DALLE_III,
  MODUS_GPT_IMAGE,
  MODUS_GPT_IMAGE_EDIT,
  MODUS_OPENROUTER_CHAT,
  MODUS_VENICE_CHAT,
  MODUS_LAYER_COMPOSITE,
  MODUS_FRAMES_TO_VIDEO,
  MODUS_AITOOLKIT_TRAINING,
  MODUS_DATASET_CAPTION,
  MODUS_DATASET_DECOMPOSE,
  MODUS_MUSE_STEER,
]

// A modus whose aditus carries a resource-shaped port must say what that port references
// (`Porta.owned`), because that declaration is what the run entry point resolves against the
// calling anima before anything is reserved or dispatched. Undeclared, the port would reach a
// cursor unscoped — a cursor has no caller to check it against (an Actum is identity-blind).
// Checked HERE, at definition time, so the answer arrives when the seed is written rather
// than on the first run that names a record.
lintOwnedDeclarations(CANONICAL_MODI)
