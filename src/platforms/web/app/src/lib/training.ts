// Shared training-launch helpers. A training is just a run of the canon ai-toolkit
// modus (modus.aitoolkit-training) over an inline dataset manifest — so launching one
// is `api.createRun(...)`. Both the Space quick-train and the dedicated Train builder
// call through here so the dataset-building + launch logic lives in one place.
//
// User-facing copy must say "training" / "base model" / "credits" — never the Latin
// (modus / fundamentum / impetus). Latin stays in code only.

import { api, type Run } from './api';

/** One image headed into a dataset: a URL and (optionally) a caption. */
export interface DatasetImage { url: string; caption?: string }

/** Base models the trainer accepts. Illustrative — keep in sync with the catalogue. */
export interface BaseModelOption { id: string; label: string }
export const BASE_MODELS: BaseModelOption[] = [
  { id: 'klein-4b', label: 'Klein 4B' },
  { id: 'flux-schnell', label: 'FLUX Schnell' },
  { id: 'krea2-raw', label: 'Krea 2 (raw)' },
  { id: 'zimage', label: 'Z-Image' },
];

export interface TrainingConfig {
  images: DatasetImage[];
  triggerWord: string;
  baseModel: string;
  steps: number;
  /** When true, the trainer auto-captions and per-image captions are dropped. */
  autocaption?: boolean;
}

/**
 * Stride-sample down to `cap` images for diversity (evenly spaced, not the first N).
 * Returns the input unchanged when already at or under the cap.
 */
export function sampleImages(images: DatasetImage[], cap: number): DatasetImage[] {
  if (images.length <= cap) return images;
  const out: DatasetImage[] = [];
  const stride = images.length / cap;
  for (let k = 0; k < cap; k++) out.push(images[Math.floor(k * stride)]);
  return out;
}

/** Build the JSON dataset string the modus expects (drops captions when autocaptioning). */
export function buildDatasetManifest(images: DatasetImage[], autocaption?: boolean): string {
  return JSON.stringify(
    images.map((im) => (autocaption ? { url: im.url } : { url: im.url, caption: im.caption })),
  );
}

/** A batch caption pass over one dataset (modus.dataset-caption). */
export interface CaptionJobConfig {
  datasetId: string;
  /** Display name for the captionset the pass writes (the modus generates one when absent). */
  name?: string;
  /** Instruction handed to the captioner (the training-caption prompt when absent). */
  captionPrompt?: string;
}

/**
 * Launch a batch caption job over a whole dataset. Same shape as a training launch — a normal
 * run of a canon modus, metered like any other run, so there is no bespoke caption route. The
 * pass writes its result back onto the dataset as a captionset, so the caller re-reads the
 * dataset once the run reaches a terminal state.
 */
export async function launchCaptionJob(cfg: CaptionJobConfig): Promise<Run> {
  const name = cfg.name?.trim();
  const captionPrompt = cfg.captionPrompt?.trim();
  const { run } = await api.createRun({
    modusId: 'modus.dataset-caption',
    aditus: {
      dataset: cfg.datasetId,
      ...(name ? { name } : {}),
      ...(captionPrompt ? { captionPrompt } : {}),
    },
  });
  return run;
}

/** Launch a LoRA training run. Throws on a failed dispatch (caller surfaces the error). */
export async function launchTraining(cfg: TrainingConfig): Promise<Run> {
  const trigger = cfg.triggerWord.trim();
  const dataset = buildDatasetManifest(cfg.images, cfg.autocaption);
  const { run } = await api.createRun({
    modusId: 'modus.aitoolkit-training',
    aditus: {
      dataset,
      baseModel: cfg.baseModel,
      triggerWord: trigger,
      steps: cfg.steps,
      name: trigger,
      autocaption: !!cfg.autocaption,
    },
  });
  return run;
}
