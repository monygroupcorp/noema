// =============================================================================
// aitkConfig — generate an ai-toolkit training yaml from high-level inputs
// =============================================================================
//
// The modus owns the config. A user brings a DATASET (images, and sometimes
// captions) + a few knobs (trigger word, base model, steps) — never a hand-authored
// training yaml. `buildAitkConfig` turns those into the full ostris/ai-toolkit
// `ui_trainer` config (the proven klein-4b low-VRAM shape), keyed by a per-base-model
// PRESET (the model block + quantization + sensible defaults). New base models = new
// presets; the user-facing contract stays {dataset, triggerWord, baseModel, steps}.
//
// Pure + deterministic (a fixed-shape template — no yaml dep, hash-stable). The
// filesystem write is the shell (`fsConfigWriter`), like DockerAitkSpawner.
// =============================================================================

/** Per-base-model knobs that the user never sets — the model block + its tuned defaults. */
export interface AitkBasePreset {
  /** HuggingFace repo / path for `model.name_or_path`. */
  nameOrPath: string
  /** ai-toolkit `model.arch`. */
  arch: string
  /** Default multi-res bucketing for this base. */
  resolution: number[]
  /** Default LoRA rank (`network.linear` + `linear_alpha`). */
  rank: number
  /** Default learning rate. */
  lr: number
  /** Low-VRAM quantization block (klein-4b on a 24GB card). */
  quantize: boolean
  quantizeTe: boolean
  lowVram: boolean
  qtype: string
}

/** Base-model presets. Aliases map to the canonical key. */
export const AITK_BASE_PRESETS: Record<string, AitkBasePreset> = {
  'flux2-klein-4b': {
    nameOrPath: 'black-forest-labs/FLUX.2-klein-base-4B',
    arch: 'flux2_klein_4b',
    resolution: [512, 768, 1024],
    rank: 32,
    lr: 1e-4,
    quantize: true,
    quantizeTe: true,
    lowVram: true,
    qtype: 'qfloat8',
  },
}

/** Common aliases → canonical preset key. */
const PRESET_ALIASES: Record<string, string> = {
  'klein-4b': 'flux2-klein-4b',
  'klein': 'flux2-klein-4b',
  'flux2-klein': 'flux2-klein-4b',
}

export function resolveBasePreset(baseModel: string): AitkBasePreset {
  const key = AITK_BASE_PRESETS[baseModel] ? baseModel : PRESET_ALIASES[baseModel]
  const preset = key ? AITK_BASE_PRESETS[key] : undefined
  if (!preset) {
    throw new Error(`aitkConfig: unknown baseModel '${baseModel}' (known: ${[...Object.keys(AITK_BASE_PRESETS), ...Object.keys(PRESET_ALIASES)].join(', ')})`)
  }
  return preset
}

export interface AitkConfigParams {
  /** Run name = the Job id; output lands in `<trainingFolder>/<name>/<name>.safetensors`. */
  name: string
  /** Container-visible dataset folder (images + optional captions). */
  datasetPath: string
  triggerWord: string
  /** Base-model preset key (e.g. 'flux2-klein-4b' / 'klein-4b'). */
  baseModel: string
  steps: number
  /** Checkpoint cadence — default min(steps, 250) so a run always saves at least once. */
  saveEvery?: number
  /** Sample cadence — default = steps (one preview set at the final step, for the model card). */
  sampleEvery?: number
  /** Sample prompts (`[trigger]` is substituted) — default a small varied set for the card gallery. */
  samplePrompts?: string[]
  /** LoRA rank override (else the preset default). */
  rank?: number
  /**
   * Weights-only resume/continue: a container path to a prior LoRA's `.safetensors`. Emitted as
   * `network.pretrained_lora_path` — ai-toolkit initialises the network from it (fresh optimizer,
   * step counter starts at 0, so `steps` is purely additional). Covers both crash-recovery
   * (point at the rescued checkpoint, steps = remaining) and extend (point at a finished LoRA).
   */
  resumeFrom?: string
  /** Multi-res bucketing override (else the preset default). */
  resolution?: number[]
  /** Caption file extension — default 'txt'. */
  captionExt?: string
  /** SQLite Job db path INSIDE the container — default '/aitk/aitk_db.db'. */
  sqliteDbPath?: string
  /** Checkpoint output dir INSIDE the container — default '/aitk/output'. */
  trainingFolder?: string
}

/**
 * Default sample prompts for the end-of-run preview gallery — `[trigger]` is substituted
 * by ai-toolkit with the run's trigger word. A small varied set (portrait / full body /
 * close-up / bare trigger) so the model card shows the LoRA across a few framings.
 */
export const DEFAULT_SAMPLE_PROMPTS: string[] = [
  '[trigger], a character portrait',
  '[trigger], full body, detailed',
  '[trigger], close-up portrait, studio lighting',
  '[trigger]',
]

/**
 * Build the end-of-run sample prompts from the dataset's own captions — so the card gallery shows
 * what the LoRA actually learned, not a generic framing set. Takes the first `n` non-empty captions
 * and prefixes `[trigger], ` (ai-toolkit substitutes the trigger at sample time; the finalizer does
 * for the card). Falls back to DEFAULT_SAMPLE_PROMPTS when the dataset carries no captions.
 */
export function deriveSamplePrompts(captions: Array<string | undefined>, n = 4): string[] {
  const picked = captions.map((c) => (typeof c === 'string' ? c.trim() : '')).filter((c) => c.length > 0).slice(0, n)
  if (picked.length === 0) return DEFAULT_SAMPLE_PROMPTS
  return picked.map((c) => (/\[trigger\]/i.test(c) ? c : `[trigger], ${c}`))
}

/** Parse a `samplePrompts` aditus value (JSON array of strings) → the prompt list, or undefined. */
export function parseSamplePrompts(raw: unknown): string[] | undefined {
  if (typeof raw !== 'string' || !raw.trim()) return undefined
  try {
    const a = JSON.parse(raw)
    return Array.isArray(a) && a.length > 0 && a.every((x) => typeof x === 'string') ? (a as string[]) : undefined
  } catch { return undefined }
}

/** Render the ai-toolkit `ui_trainer` training yaml for a run. Deterministic. */
export function buildAitkConfig(p: AitkConfigParams): string {
  const preset = resolveBasePreset(p.baseModel)
  const steps = p.steps
  const saveEvery = p.saveEvery ?? Math.min(steps, 250)
  const sampleEvery = p.sampleEvery ?? steps         // = steps → one preview set at the end (model-card gallery)
  const samplePrompts = p.samplePrompts ?? DEFAULT_SAMPLE_PROMPTS
  const rank = p.rank ?? preset.rank
  const resolution = p.resolution ?? preset.resolution
  const captionExt = p.captionExt ?? 'txt'
  const sqliteDbPath = p.sqliteDbPath ?? '/aitk/aitk_db.db'
  const trainingFolder = p.trainingFolder ?? '/aitk/output'

  return `# ai-toolkit ${preset.arch} LoRA — generated by the crystal training modus.
# name=${p.name} trigger=${p.triggerWord} dataset=${p.datasetPath} steps=${steps}
---
job: extension
config:
  name: "${p.name}"
  process:
    - type: 'ui_trainer'
      sqlite_db_path: "${sqliteDbPath}"
      training_folder: "${trainingFolder}"
      device: cuda:0
      trigger_word: "${p.triggerWord}"
      network:
        type: "lora"
        linear: ${rank}
        linear_alpha: ${rank}${p.resumeFrom ? `\n        pretrained_lora_path: "${p.resumeFrom}"` : ''}
      save:
        dtype: float16
        save_every: ${saveEvery}
        max_step_saves_to_keep: 4
        push_to_hub: false
      datasets:
        - folder_path: "${p.datasetPath}"
          caption_ext: "${captionExt}"
          caption_dropout_rate: 0.05
          resolution: [ ${resolution.join(', ')} ]
      train:
        batch_size: 1
        steps: ${steps}
        gradient_accumulation: 1
        train_unet: true
        train_text_encoder: false
        gradient_checkpointing: true
        noise_scheduler: "flowmatch"
        timestep_type: "weighted"
        optimizer: "adamw8bit"
        lr: ${preset.lr}
        optimizer_params:
          weight_decay: 1e-5
        ema_config:
          use_ema: false
          ema_decay: 0.99
        dtype: bf16
      model:
        name_or_path: "${preset.nameOrPath}"
        arch: "${preset.arch}"
        quantize: ${preset.quantize}
        quantize_te: ${preset.quantizeTe}
        low_vram: ${preset.lowVram}
        qtype: "${preset.qtype}"
        model_kwargs:
          match_target_res: false
      sample:
        sampler: "flowmatch"
        sample_every: ${sampleEvery}
        width: 1024
        height: 1024
        prompts:
${samplePrompts.map(s => `          - "${s.replace(/"/g, '\\"')}"`).join('\n')}
        neg: ""
        seed: 42
        walk_seed: true
        guidance_scale: 4
        sample_steps: 25
meta:
  name: "[name]"
  version: '1.0'
`
}

/**
 * The default training-caption instruction — mirrors `ESSENTIA_QWEN3_VL_CAPTION`'s intent
 * (one dense, comma-separated caption) so the on-pod captioner and the crystal caption arm
 * speak with one voice. ai-toolkit's captioner takes a single user prompt (no system split).
 */
export const DEFAULT_CAPTION_PROMPT =
  'Describe this image in one dense, comma-separated caption — subject, attributes, style, and ' +
  'composition. No preamble, no markdown, no quotes.'

export interface AitkCaptionParams {
  /** Container-visible dataset folder — the captioner writes `<stem>.txt` next to each image. */
  datasetPath: string
  /** Qwen3-VL captioner model (HF repo) — default the 8B instruct ai-toolkit recommends. */
  model?: string
  /** The caption instruction — default `DEFAULT_CAPTION_PROMPT`. */
  captionPrompt?: string
  /** Max caption tokens — default 256 (denser than ai-toolkit's 128 default). */
  maxNewTokens?: number
  /** SQLite db path INSIDE the container — default '/aitk/aitk_db.db'. */
  sqliteDbPath?: string
}

/**
 * Render an ai-toolkit `Qwen3VLCaptioner` extension-job yaml — run BEFORE training over the
 * dataset dir to fill captions for images that lack a `.txt` sidecar. `recaption: false` makes
 * it skip images that already have one, so dataset-provided captions always win and only the
 * gaps are filled. Same `job: extension` shape as the trainer; the captioner loads Qwen3-VL via
 * transformers in-process (no extra runtime), quantized low-VRAM for the 24GB card. Deterministic.
 */
export function buildAitkCaptionConfig(p: AitkCaptionParams): string {
  const model = p.model ?? 'Qwen/Qwen3-VL-8B-Instruct'
  const prompt = (p.captionPrompt ?? DEFAULT_CAPTION_PROMPT).replace(/"/g, '\\"')
  const maxNewTokens = p.maxNewTokens ?? 256
  const sqliteDbPath = p.sqliteDbPath ?? '/aitk/aitk_db.db'

  return `# ai-toolkit Qwen3-VL captioner — generated by the crystal training modus (fills missing captions).
---
job: extension
config:
  name: "caption"
  process:
    - type: Qwen3VLCaptioner
      sqlite_db_path: "${sqliteDbPath}"
      device: cuda
      caption:
        model_name_or_path: "${model}"
        dtype: bf16
        quantize: true
        qtype: float8
        low_vram: true
        extensions: [ "jpg", "jpeg", "png", "bmp", "webp" ]
        path_to_caption: "${p.datasetPath}"
        recaption: false
        caption_extension: "txt"
        caption_prompt: "${prompt}"
        max_new_tokens: ${maxNewTokens}
meta:
  name: "[name]"
  version: '1.0'
`
}

/** What the cursor needs to materialise a generated config: write it, return the
 *  container-relative path the spawner runs (`run.py '<path>'`). */
export type AitkConfigWriter = (jobId: string, yaml: string) => Promise<string>

/**
 * Production `AitkConfigWriter`: write `<hostConfigDir>/<jobId>.yaml` and return the
 * container-relative `<containerConfigDir>/<jobId>.yaml`. The two dirs are the same
 * mounted location seen from host vs container. Untested filesystem shell.
 */
export function fsConfigWriter(hostConfigDir: string, containerConfigDir = 'config'): AitkConfigWriter {
  return async (jobId, yaml) => {
    const { writeFile, mkdir } = await import('node:fs/promises')
    const { join } = await import('node:path')
    await mkdir(hostConfigDir, { recursive: true })
    await writeFile(join(hostConfigDir, `${jobId}.yaml`), yaml, 'utf8')
    return `${containerConfigDir}/${jobId}.yaml`
  }
}
