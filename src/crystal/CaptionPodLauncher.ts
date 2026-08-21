import type { R2Config } from './comfyrunnerClient.js'
import type { Datasets } from '../types/dataset.js'
import type { CaptionLauncher, CaptionLaunchSpec } from './DatasetCaptionCursor.js'
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
//   1. resolves the dataset id → a manifest ([{url,id}]) the pod pulls
//   2. assembles the pod env — the manifest plus the model, prompt and token bound the
//      captioner runs with
//   3. provisions a pod, bootstraps a caption runtime onto it, and launches `captioner.py`
//      detached, returning `{ externusJobId: podId }`.
//
// A CAPTION PASS CARRIES A CAPTION RUNTIME. It loads one vision-language model and runs a
// bounded forward pass per media item; it does not train, so it needs neither a training
// toolkit nor the system libraries and pinned framework stack that toolkit's dependency tree
// requires. The bootstrap below is one dependency install onto a base image that already
// carries the matched framework build, and the pod script is this arm's own.
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

/** Bootstrap for a caption pod. The base image already carries the matched framework build, so
 *  this is the caption runtime and the uploader and nothing else: no repository clone, no
 *  submodules, no toolkit requirements tree, no framework reinstall. */
export const CAPTION_POD_SETUP: string[] = [
  'pip install --break-system-packages -q --upgrade transformers accelerate pillow boto3',
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

  async launch(spec: CaptionLaunchSpec): Promise<{ externusJobId: string }> {
    // 1. dataset id → manifest the pod pulls. Fail loud HERE, not on the pod: a caption pass
    //    with nothing to caption would otherwise burn a pod and settle an empty captionset.
    const dataset = await this.deps.datasets.find(spec.datasetId)
    if (!dataset) throw new Error(`dataset not found: ${spec.datasetId}`)
    const manifest = datasetToManifest(dataset)
    if (manifest.length === 0) throw new Error(`dataset ${spec.datasetId} has no media to caption`)

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
    const onLaunchFailed = this.deps.onLaunchFailed
    const { podId } = await this.deps.provisioner.provision({
      image: this.deps.image ?? DEFAULT_AITK_IMAGE,
      env,
      setup: CAPTION_POD_SETUP,
      script: 'captioner',
      ...(spec.onPodId ? { onPodId: spec.onPodId } : {}),
      ...(onLaunchFailed ? { onLaunchFailed: (err: unknown) => onLaunchFailed(spec.actumId, err) } : {}),
    })
    return { externusJobId: podId }
  }
}
