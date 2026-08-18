import type { R2Config } from './comfyrunnerClient.js'
import type { Datasets } from '../types/dataset.js'
import type { CaptionLauncher, CaptionLaunchSpec } from './DatasetCaptionCursor.js'
import { datasetToManifest } from './datasetManifest.js'
import { buildAitkCaptionConfig } from './aitkConfig.js'
import { withCallbackNonce } from './RunPodCursor.js'
import {
  POD_AITK_DIR,
  POD_DATASET_DIR,
  DEFAULT_AITK_REF,
  DEFAULT_AITK_IMAGE,
  type TrainingPodProvisioner,
} from './RemoteAitkLauncher.js'

// =============================================================================
// CaptionPodLauncher — turn a dataset id into a provisioned pod running a caption pass
// =============================================================================
//
// The runtime adapter behind DatasetCaptionCursor's `launch` port, and the twin of
// RemoteAitkLauncher. Per run this:
//   1. resolves the dataset id → a manifest ([{url,id}]) the pod pulls
//   2. synthesises the caption config (`buildAitkCaptionConfig`) with the POD-SIDE dataset
//      path — the same generator the training arm's auto-caption step uses
//   3. base64s the config + manifest and assembles the pod env, with NOEMA_JOB_MODE=caption
//      so `aitktrainer.py` stops after captioning, harvests the sidecars and uploads them
//   4. provisions a pod + launches the script detached, returning `{ externusJobId: podId }`.
//
// No training config rides along: there is no training in a caption job, so AITK_CONFIG_B64
// is deliberately absent from the env.
//
// The pod paths, the pinned ai-toolkit ref, the base image and the bootstrap recipe are the
// SAME ones the training launcher uses — imported, not re-declared, so the pod's dataset dir
// and the generated config's `folder_path` cannot drift apart. Provisioning sits behind the
// `TrainingPodProvisioner` port, so the whole launch shape (resolve → generate → env) is
// hermetically testable; only the provisioner's SSH/GPU work is the live seam.
// =============================================================================

export interface CaptionPodLauncherDeps {
  provisioner: TrainingPodProvisioner
  /** The dataset store — the caption job resolves media straight off a Dataset. */
  datasets: Pick<Datasets, 'find'>
  /** The pod base image — a stock RunPod image with torch ≥2.9 (default `DEFAULT_AITK_IMAGE`);
   *  ai-toolkit is bootstrapped onto it over SSH. */
  image?: string
  /** ai-toolkit commit to clone on the pod (default `DEFAULT_AITK_REF`). */
  aitkRef?: string
  /** R2 the pod uploads the harvested caption map to (the finalizer reads it back). */
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

    // 2. synthesise the caption config, pointed at the pod-side dataset dir.
    const captionYaml = buildAitkCaptionConfig({
      datasetPath: POD_DATASET_DIR,
      ...(spec.captionPrompt ? { captionPrompt: spec.captionPrompt } : {}),
      ...(spec.maxNewTokens !== undefined ? { maxNewTokens: spec.maxNewTokens } : {}),
    })

    // 3. assemble the pod env (config + manifest base64'd; RUNPOD_POD_ID injected by the provisioner).
    const r2 = this.deps.r2
    const env: Record<string, string> = {
      AITK_DIR: POD_AITK_DIR,
      AITK_JOB_ID: spec.jobId,
      // Caption-only run: the pod writes the config, stages the manifest, captions, harvests and
      // reports. An absent NOEMA_JOB_MODE is the training path, unchanged.
      NOEMA_JOB_MODE: 'caption',
      AITK_CAPTION_CONFIG_B64: Buffer.from(captionYaml, 'utf8').toString('base64'),
      AITK_MANIFEST_B64: Buffer.from(JSON.stringify(manifest), 'utf8').toString('base64'),
      AITK_DATASET_DIR: POD_DATASET_DIR,
      AITK_GPU_IDS: spec.gpuId ?? '0',
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

    // 4. bootstrap recipe — the same one the training launcher uses. Both lines below are
    //    load-bearing: the apt line installs the system libs ai-toolkit's opencv/ffmpeg need
    //    (without them run.py crashes on `import cv2`), and the forced cu128 trio restores the
    //    matched torch stack that ai-toolkit's requirements displace (a mismatched libtorch
    //    crashes with an undefined symbol at `import torchaudio`).
    const aitkRef = this.deps.aitkRef ?? DEFAULT_AITK_REF
    const setup = [
      'apt-get update -qq && apt-get install -y -qq libgl1 libglib2.0-0 ffmpeg',
      `rm -rf ${POD_AITK_DIR} && git clone https://github.com/ostris/ai-toolkit ${POD_AITK_DIR}`,
      `cd ${POD_AITK_DIR} && git checkout ${aitkRef} && git submodule update --init --recursive`,
      `cd ${POD_AITK_DIR} && pip install --break-system-packages -q -r requirements.txt boto3`,
      'pip install --break-system-packages -q --force-reinstall --no-deps ' +
        'torch==2.9.1 torchvision==0.24.1 torchaudio==2.9.1 --index-url https://download.pytorch.org/whl/cu128',
    ]

    // 5. provision + launch detached; the pod id IS the external run handle. `provision` resolves
    //    at the pod id and finishes SSH + bootstrap in the background, so the two hooks below are
    //    how the run stays correlated: the cursor's stamp runs before any pod-side work starts,
    //    and a background failure fails the run rather than waiting out its deadline.
    const onLaunchFailed = this.deps.onLaunchFailed
    const { podId } = await this.deps.provisioner.provision({
      image: this.deps.image ?? DEFAULT_AITK_IMAGE, env, setup,
      ...(spec.onPodId ? { onPodId: spec.onPodId } : {}),
      ...(onLaunchFailed ? { onLaunchFailed: (err: unknown) => onLaunchFailed(spec.actumId, err) } : {}),
    })
    return { externusJobId: podId }
  }
}
