import type { R2Config } from './comfyrunnerClient.js'
import type { Captionset, Datasets } from '../types/dataset.js'
import type { CaptionLauncher, CaptionLaunchSpec } from './DatasetCaptionCursor.js'
import type { Progressus } from '../types/progressus.js'
import { recordProgressus } from '../execution/progressusSink.js'
import { datasetToManifest } from './datasetManifest.js'
import { DEFAULT_CAPTION_PROMPT } from './aitkConfig.js'
import { withCallbackNonce } from './RunPodCursor.js'
import { DEFAULT_AITK_IMAGE, type TrainingPodProvisioner } from './RemoteAitkLauncher.js'

// =============================================================================
// CaptionPodLauncher — turn a dataset id into a provisioned pod running a caption pass
// =============================================================================
//
// The runtime adapter behind DatasetCaptionCursor's `launch` port, and the twin of
// RemoteAitkLauncher. Per run this:
//   1. resolves the dataset id → a manifest ([{url,id}]) the pod pulls — narrowed to the media
//      the captionset being extended does not already cover, when the run was given one
//   2. assembles the pod env — the manifest plus the model, prompt and token bound the
//      captioner runs with
//   3. provisions a pod, bootstraps a caption runtime onto it, and launches `captioner.py`
//      detached, returning `{ externusJobId: podId }`.
//
// A CAPTION PASS CARRIES A CAPTION RUNTIME. It loads one vision-language model and runs a
// bounded forward pass per media item; it does not train, so it needs neither a training
// toolkit nor the system libraries and pinned framework stack that toolkit's dependency tree
// requires. The bootstrap below installs that runtime onto the base image, and the pod script
// is this arm's own.
//
// WHAT THE BASE IMAGE CARRIES IS TORCH, NOT A FRAMEWORK STACK. This comment previously said the
// image "already carries the matched framework build", and the bootstrap was written to that
// belief: it installed no framework at all. The image ships torch 2.9.1+cu128 and no
// torchvision, which the vision-language processor imports unconditionally — so the caption arm
// failed at processor load on every run from the day it shipped (2026-08-21) until this fix,
// nine seconds into each pod, having captioned nothing. The old toolkit bootstrap had been
// carrying torchvision incidentally, as a side effect of the framework reinstall this arm
// deliberately dropped. State what the image provides; never infer it from what used to work.
//
// CONFIG RIDES AS ENVIRONMENT VARIABLES. The captioner takes its model, prompt and token bound
// straight off the env this launcher emits — there is no config file format between the two
// arms, so the caption arm cannot re-acquire the training arm's config coupling by parsing one.
// `buildAitkCaptionConfig` is untouched and stays the training arm's own auto-caption generator.
//
// Provisioning sits behind the shared `TrainingPodProvisioner` port, which the caption arm uses
// with its own `script`; the whole launch shape (resolve → env → setup) is hermetically
// testable, and only the provisioner's SSH/GPU work is the live seam.
// =============================================================================

/** The captioner model the pod loads when the launcher is not configured otherwise. */
export const DEFAULT_CAPTION_MODEL = 'Qwen/Qwen3-VL-8B-Instruct'

/** Working dir on the caption pod — staged media plus the harvested map. Deliberately not the
 *  training arm's pod dir: nothing on this pod is shared with a training run. */
export const POD_CAPTION_DIR = '/caption'

/** The wheel index carrying builds matched to the base image's CUDA. Plain PyPI serves a
 *  torchvision built against a different torch, and installing that displaces the image's
 *  CUDA-matched build. */
export const POD_TORCH_INDEX_URL = 'https://download.pytorch.org/whl/cu128'

/** The torchvision release paired with the base image's torch 2.9.1+cu128. The image ships torch
 *  and NOT torchvision, and the Qwen3-VL processor imports torchvision unconditionally even though
 *  this arm only ever hands it stills — so without this a pod dies at processor load, before
 *  reading a single image. Bump in lockstep with the image's torch, never alone. */
export const POD_TORCHVISION_PIN = 'torchvision==0.24.1'

/** The captioner's Python runtime, pinned. Unpinned, every pod installed whatever was newest on
 *  PyPI at boot against a fixed torch — so a release could break every caption pod at once with no
 *  change on our side, and the failure would not be reproducible from this repo. There is already
 *  a floor (`captioner.py` passes the newer `dtype=` kwarg, which older releases do not accept),
 *  so the version wants walling on both sides rather than on neither. */
export const POD_TRANSFORMERS_PIN = 'transformers==5.15.1'
export const POD_ACCELERATE_PIN = 'accelerate>=1.14,<2'

/** Bootstrap for a caption pod: the caption runtime and the uploader and nothing else — no
 *  repository clone, no submodules, no toolkit requirements tree.
 *
 *  Two commands, and the split is load-bearing. torchvision installs `--no-deps` from the CUDA
 *  index so pip cannot pull torch in behind it: torchvision declares an exact torch, and letting
 *  pip resolve that is how an already-satisfied requirement still gets reinstalled from a
 *  different index. Its remaining deps are numpy (on the torch image already) and pillow (the
 *  second command). The property this protects is that the pod's torch version and CUDA build are
 *  the same after the bootstrap as before it. */
export const CAPTION_POD_SETUP: string[] = [
  `pip install --break-system-packages -q --no-deps --index-url ${POD_TORCH_INDEX_URL} ${POD_TORCHVISION_PIN}`,
  `pip install --break-system-packages -q ${POD_TRANSFORMERS_PIN} "${POD_ACCELERATE_PIN}" pillow boto3`,
]

export interface CaptionPodLauncherDeps {
  provisioner: TrainingPodProvisioner
  /** The dataset store — the caption job resolves media straight off a Dataset. */
  datasets: Pick<Datasets, 'find'>
  /** The pod base image — a stock RunPod image already carrying torch ≥2.9 + CUDA
   *  (default `DEFAULT_AITK_IMAGE`); the caption runtime is installed onto it over SSH. */
  image?: string
  /**
   * Accepted for compatibility with the shared pod-rail wiring, and unused: a caption pod clones
   * no toolkit, so there is no ref to pin.
   */
  aitkRef?: string
  /** Vision-language model the captioner loads (default `DEFAULT_CAPTION_MODEL`). */
  captionModel?: string
  /** R2 the pod uploads the caption map to (the finalizer reads it back). */
  r2: R2Config
  /** Our `/runner/status` sink — the pod POSTs its Progressus here. */
  statusUrl: string
  /** Our completion webhook — the pod POSTs `{id,status,output,executionTime}` here. */
  webhookUrl: string
  /**
   * Fail the run when the background SSH/bootstrap phase fails. The launcher holds the actum id
   * (the pod's own status posts are keyed by it); the wiring points this at the same failure path
   * the deadline reaper uses. Absent, a failed launch is only observed when the run's deadline
   * expires.
   */
  onLaunchFailed?: (actumId: string, err: unknown) => Promise<void>
}

export class CaptionPodLauncher implements CaptionLauncher {
  constructor(private readonly deps: CaptionPodLauncherDeps) {}

  /**
   * Put one phase report on the caption run's timeline. Fire-and-forget with a terminal catch:
   * the sink is a database write and a status report must never be able to fail a launch.
   */
  private _report(actumId: string, progressus: Omit<Progressus, 'at'>): void {
    void recordProgressus(actumId, { ...progressus, at: new Date() }).catch(() => {})
  }

  async launch(spec: CaptionLaunchSpec): Promise<{ externusJobId: string }> {
    // 1. dataset id → manifest the pod pulls. Fail loud HERE, not on the pod: a caption pass
    //    with nothing to caption would otherwise burn a pod and settle an empty captionset.
    //
    //    An EXTENDING pass resolves the captionset it was given and stages only what that pass
    //    does not already cover, so the images it is not captioning are never downloaded. An id
    //    naming no captionset on this dataset fails the run rather than quietly widening the
    //    pass back out to the whole set.
    const dataset = await this.deps.datasets.find(spec.datasetId)
    if (!dataset) throw new Error(`dataset not found: ${spec.datasetId}`)
    let extending: Captionset | undefined
    if (spec.captionsetId) {
      extending = dataset.captionsets.find((c) => c.id === spec.captionsetId)
      if (!extending) {
        throw new Error(`captionset ${spec.captionsetId} is not on dataset ${spec.datasetId}`)
      }
    }
    const manifest = datasetToManifest(dataset, extending)
    if (manifest.length === 0) {
      throw new Error(extending
        ? `dataset ${spec.datasetId} has no media left to caption in captionset ${extending.id}`
        : `dataset ${spec.datasetId} has no media to caption`)
    }

    // 2. assemble the pod env (manifest base64'd; RUNPOD_POD_ID injected by the provisioner).
    //    The captioner's knobs ride as plain values — the pod reads them, it parses no config.
    const r2 = this.deps.r2
    const env: Record<string, string> = {
      NOEMA_JOB_ID: spec.jobId,
      NOEMA_WORK_DIR: POD_CAPTION_DIR,
      NOEMA_MANIFEST_B64: Buffer.from(JSON.stringify(manifest), 'utf8').toString('base64'),
      NOEMA_CAPTION_MODEL: this.deps.captionModel ?? DEFAULT_CAPTION_MODEL,
      NOEMA_CAPTION_PROMPT: spec.captionPrompt ?? DEFAULT_CAPTION_PROMPT,
      NOEMA_ACTUM_ID: spec.actumId,
      NOEMA_STATUS_URL: this.deps.statusUrl,
      // Completion sink. When the cursor minted a per-job callback nonce it rides as the last path
      // segment, so the webhook can bind this pod's callback to this run.
      NOEMA_WEBHOOK_URL: spec.callbackNonce
        ? withCallbackNonce(this.deps.webhookUrl, spec.callbackNonce)
        : this.deps.webhookUrl,
      R2_ENDPOINT: r2.endpoint,
      R2_ACCESS_KEY_ID: r2.accessKeyId,
      R2_SECRET_ACCESS_KEY: r2.secretAccessKey,
      R2_BUCKET_NAME: r2.bucket,
      R2_PUBLIC_URL: r2.publicUrl ?? '',
    }
    if (spec.maxNewTokens !== undefined) env.NOEMA_CAPTION_MAX_NEW_TOKENS = String(spec.maxNewTokens)

    // 3. provision + launch detached; the pod id IS the external run handle. `provision` resolves
    //    at the pod id and finishes SSH + bootstrap in the background, so the two hooks below are
    //    how the run stays correlated: the cursor's stamp runs before any pod-side work starts,
    //    and a background failure fails the run rather than waiting out its deadline. `script` is
    //    what puts the caption pass — rather than the trainer — on this pod.
    //
    //    The run is reported from here on. A caption pass spends its first minutes acquiring a pod
    //    and building an environment on it, before a single caption can exist; those phases are
    //    what `onPhase` carries onto the timeline, so the wait is legible while it happens instead
    //    of being inferred from a run that has not finished yet.
    const onLaunchFailed = this.deps.onLaunchFailed
    this._report(spec.actumId, { phase: 'provisioning', target: 'pod', message: 'acquiring a GPU pod' })
    const { podId } = await this.deps.provisioner.provision({
      image: this.deps.image ?? DEFAULT_AITK_IMAGE,
      env,
      setup: CAPTION_POD_SETUP,
      script: 'captioner',
      onPhase: (progressus) => this._report(spec.actumId, progressus),
      ...(spec.onPodId ? { onPodId: spec.onPodId } : {}),
      ...(onLaunchFailed ? { onLaunchFailed: (err: unknown) => onLaunchFailed(spec.actumId, err) } : {}),
    })
    return { externusJobId: podId }
  }
}
