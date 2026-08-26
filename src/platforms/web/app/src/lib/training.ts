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

/** The modus a training run fires, and the key its per-caller form defaults live under. */
export const TRAINING_MODUS_ID = 'modus.aitoolkit-training';

/** Default step count for a fresh training form (no stored preference yet). */
const DEFAULT_TRAINING_STEPS = 1000;

/** The caller's per-caller training defaults, as stored in `/v1/me/affines/:modusId` — shape
 * unenforced server-side, so every field is read defensively before use. */
export interface TrainingAffines {
  baseModel?: unknown;
  steps?: unknown;
  trigger?: unknown;
}

/** The training form's persisted fields (everything BUT `chosenSet`, which is dataset-contextual
 * rather than a preference and is never written back). */
export interface TrainingFormValues {
  baseModel: string;
  steps: number;
  trigger: string;
}

/**
 * Map stored training affines onto form values, tolerating garbage field-by-field: a
 * `baseModel` that isn't one of `BASE_MODELS`, or a `steps` that isn't a positive finite
 * number, falls back to today's default rather than failing the whole hydrate. Absent affines
 * (a caller who has never trained) hydrate to the same defaults the form already had.
 */
export function hydrateTrainingAffines(affines: TrainingAffines | null | undefined): TrainingFormValues {
  const baseModel = typeof affines?.baseModel === 'string' && BASE_MODELS.some((b) => b.id === affines.baseModel)
    ? affines.baseModel
    : BASE_MODELS[0].id;
  const steps = typeof affines?.steps === 'number' && Number.isFinite(affines.steps) && affines.steps > 0
    ? affines.steps
    : DEFAULT_TRAINING_STEPS;
  const trigger = typeof affines?.trigger === 'string' ? affines.trigger : '';
  return { baseModel, steps, trigger };
}

/**
 * Build the affines record to PUT after a form change. `setAffines` replaces the caller's whole
 * per-modus map rather than merging (see MongoConsuetudinum/MemoryConsuetudinum), so this reads
 * the caller's last-known affines and merges the training fields onto them — any other key a
 * future surface stores under this modus survives instead of being clobbered.
 */
export function buildTrainingAffinesPayload(
  current: Record<string, unknown> | null | undefined,
  values: TrainingFormValues,
): Record<string, unknown> {
  return { ...(current ?? {}), baseModel: values.baseModel, steps: values.steps, trigger: values.trigger };
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
  /**
   * Decompose every captioned item again, including the ones that already carry fragments.
   *
   * Off by default and never implied: a decompose costs one model call per item it runs, so
   * the default pass is the new work only. This is the whole-set path — a better extractor, a
   * changed trigger, a pass worth rebuilding — and it is the caller's explicit ask.
   */
  redo?: boolean;
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
      // Sent only when it is asked for. The server's default is the incremental pass, so an
      // absent key is the cheap path; a `redo: false` riding along on every request would put
      // the expensive one one typo away.
      ...(cfg.redo ? { redo: true } : {}),
    },
  };
}

/**
 * The minimum shape of a dataset the workload rules need: the captionsets with their caption
 * maps, and the media items with whatever fragments a past decompose left on them.
 */
export interface DecomposableDataset {
  captionsets: Array<{ id: string; captions?: Record<string, string> }>;
  media: Array<{ id: string; fragments?: unknown[] }>;
}

/** What a decompose over one captionset would actually run. */
export interface DecomposeWorkload {
  /** Items this pass would send to the model — captioned, and not yet decomposed. */
  pending: number;
  /** Captioned items that already carry fragments, so an incremental pass skips them. */
  already: number;
  /** Captioned items in the chosen pass — `pending + already`. */
  captioned: number;
}

/**
 * How much work a decompose over this captionset has left.
 *
 * An item that already carries fragments has been decomposed; the server skips it, so the
 * control must not quote it as work about to happen. The count is derived from the dataset
 * the server last returned — this reads state, it never writes any.
 *
 * The one place it can read high: archived media is not carried on the client record, so an
 * archived-but-captioned item is counted here and dropped by the server. The refusal for a
 * pass with nothing to do is the server's, and it arrives as a status either way.
 *
 * Non-vacuity: counting every caption instead of the undecomposed ones must fail "the
 * control counts only the items a decompose would actually run".
 */
export function decomposeWorkload(
  d: DecomposableDataset,
  captionsetId: string | null,
): DecomposeWorkload {
  const set = captionsetId ? d.captionsets.find((cs) => cs.id === captionsetId) : undefined;
  const captioned = Object.entries(set?.captions ?? {})
    .filter(([, text]) => String(text ?? '').trim() !== '')
    .map(([mediaId]) => mediaId);
  const decomposed = new Set(
    d.media.filter((m) => (m.fragments?.length ?? 0) > 0).map((m) => m.id),
  );
  const already = captioned.filter((id) => decomposed.has(id)).length;
  return { pending: captioned.length - already, already, captioned: captioned.length };
}

/**
 * What the control is about to do, in words — the count of items it would run, or that there
 * are none left, plus what the whole-set path would cost instead.
 *
 * A decompose spends one model call per item it runs, so the number of items IS the price;
 * saying it before the press is what keeps the expensive path from being the accidental one.
 */
export function decomposePlanNote(w: DecomposeWorkload, redo: boolean): string {
  const items = (n: number) => `${n} ${n === 1 ? 'image' : 'images'}`;
  if (redo) {
    return `re-decomposing all ${items(w.captioned)} in this pass — one model call each, and it replaces the fragments they carry now.`;
  }
  if (w.pending === 0) {
    return w.captioned === 0
      ? 'nothing in this pass is captioned yet, so there is nothing to decompose.'
      : `every image in this pass is already decomposed — nothing to run. Ask for a re-decompose to rebuild all ${items(w.captioned)}.`;
  }
  const skipped = w.already > 0 ? ` ${items(w.already)} are already decomposed and are skipped.` : '';
  return `${items(w.pending)} left to decompose — one model call each.${skipped}`;
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
export function canFireDecompose(gate: {
  captionsetId: string | null;
  inFlight: boolean;
  /** Items the pass would run. `0` disarms the control — the server refuses that pass, and
   *  firing it anyway is a press that can only come back as a refusal. Omitted where the
   *  caller has no workload to hand (the gate then rests on the two rules above). */
  pending?: number;
}): boolean {
  if (gate.pending === 0) return false;
  return gate.captionsetId !== null && gate.captionsetId !== '' && !gate.inFlight;
}

/**
 * The wire code the server answers with when the dataset already has a decompose running.
 *
 * This screen's `inFlight` is one tab's own memory of the pass it started: a second tab, a
 * reload, or a phone that went to sleep all arm the control again while the first pass is
 * still going. The server is the one that knows, and it refuses the second pass before any
 * reservation is taken — so this code is the readout's real source, not the local flag.
 */
export const DECOMPOSE_IN_FLIGHT_CODE = 'conflict.run_in_flight';

/**
 * The wire code the server answers with when the pass has nothing left to decompose.
 *
 * The server holds the authoritative record — it knows about archived media this app does
 * not carry, and it is the one that refuses BEFORE a reservation is taken. A control armed
 * from a stale copy of the dataset lands here, and this is what turns that into a status.
 */
export const DECOMPOSE_NOTHING_TO_DO_CODE = 'conflict.nothing_to_decompose';

/**
 * The note to show when a decompose could not be launched.
 *
 * A refusal because one is ALREADY running is not an error the user did anything about — it
 * is the status they were missing, so it is worded as the status. Everything else is
 * surfaced as it arrives, trimmed.
 *
 * Non-vacuity: dropping the in-flight branch makes "a refused second pass reads as a
 * running first pass, not as a failure" fail.
 */
export function decomposeFailureNote(message: string): string {
  if (message.includes(DECOMPOSE_IN_FLIGHT_CODE)) {
    return 'a decompose is already running on this dataset — it holds a reservation until it finishes, and the chips appear when it does.';
  }
  if (message.includes(DECOMPOSE_NOTHING_TO_DO_CODE)) {
    return 'everything in this pass is already decomposed, so nothing was run and nothing was spent — ask for a re-decompose to rebuild it.';
  }
  return `couldn't decompose: ${message.slice(0, 160)}`;
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
    modusId: TRAINING_MODUS_ID,
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
