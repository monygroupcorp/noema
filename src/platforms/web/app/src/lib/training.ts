// Shared training-launch helpers. A training is just a run of the canon ai-toolkit
// modus (modus.aitoolkit-training) over an inline dataset manifest — so launching one
// is `api.createRun(...)`. Both the Space quick-train and the dedicated Train builder
// call through here so the dataset-building + launch logic lives in one place.
//
// User-facing copy must say "training" / "base model" / "credits" — never the Latin
// (modus / fundamentum / impetus). Latin stays in code only.

import { api, type Run, type RunRequest } from './api';

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

// ── Decompose ───────────────────────────────────────────────────────────────
// A decompose reads one captionset and writes prompt fragments back onto the media items
// the captions came from — the step that fills a dataset's chip garden. Like a training and
// like a caption pass it is a normal metered run of a canon modus (`modus.dataset-decompose`),
// so `createRun` is the whole API and there is no bespoke route.
//
// Two properties the screens depend on and cannot express in JSX:
//  - the run carries BOTH `dataset` and `captionset`; both are required ports on the modus,
//    so a request missing either is refused before any work happens;
//  - a dataset carries many captionsets, so the one that runs is the one the user has
//    selected — never a positional pick.

/** One decompose pass over one captionset of one dataset. */
export interface DecomposeConfig {
  datasetId: string;
  captionsetId: string;
  /** Trained trigger word to strip out of the fragments, so they stay reusable. */
  trigger?: string;
}

/** The minimum shape of a dataset this module needs: its captionsets, in record order. */
export interface CaptionsetBearing { captionsets: Array<{ id: string }> }

/** The run request a decompose fires. */
export function decomposeRunRequest(cfg: DecomposeConfig): RunRequest {
  const trigger = cfg.trigger?.trim();
  return {
    modusId: 'modus.dataset-decompose',
    aditus: {
      dataset: cfg.datasetId,
      captionset: cfg.captionsetId,
      ...(trigger ? { trigger } : {}),
    },
  };
}

/**
 * Whether a decompose can be offered at all. A dataset with no captionset has nothing to
 * decompose — the path forward there is a caption job, so the action is not shown.
 */
export function canOfferDecompose(d: CaptionsetBearing): boolean {
  return d.captionsets.length > 0;
}

/**
 * Which captionset a decompose would run over. The user's selection wins whenever it is a
 * captionset this dataset actually carries; with nothing selected yet the newest one is
 * offered (the pass a caption job just wrote — CaptionJob.tsx seeds the same way).
 * Returns null when there is nothing to decompose.
 */
export function decomposeCaptionsetId(d: CaptionsetBearing, selectedId: string | null): string | null {
  const sets = d.captionsets;
  if (sets.length === 0) return null;
  if (selectedId && sets.some((cs) => cs.id === selectedId)) return selectedId;
  return sets[sets.length - 1].id;
}

/**
 * Whether the fire button is armed. A decompose is `deliveryMode: 'sync'` — the request stays
 * open until the last caption is written — and it spends one chat call per caption, so a
 * second pass cannot start while one is in flight.
 */
export function canFireDecompose(gate: { captionsetId: string | null; inFlight: boolean }): boolean {
  return gate.captionsetId !== null && gate.captionsetId !== '' && !gate.inFlight;
}

/**
 * Launch a decompose pass. The run is synchronous: this promise settles when the pass has
 * written its fragments, so the caller re-reads the dataset afterwards rather than polling.
 * Throws on a failed dispatch (caller surfaces the error).
 */
export async function launchDecomposeJob(cfg: DecomposeConfig): Promise<Run> {
  const { run } = await api.createRun(decomposeRunRequest(cfg));
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
