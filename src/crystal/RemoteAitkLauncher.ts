// =============================================================================
// RemoteAitkLauncher — turn high-level training inputs into a provisioned pod job
// =============================================================================
//
// The remote runtime adapter behind RemoteAitoolkitTrainingCursor's `launch` port.
// The modus owns the config: a user brings a DATASET (+ knobs), never a yaml. So per
// run this:
//   1. resolves the dataset reference → a manifest ([{url,caption?}]) the pod pulls
//   2. synthesises the training config (`buildAitkConfig`) with the POD-SIDE dataset
//      path — the same generator the local cursor uses, just pointed at /aitk/dataset
//   3. base64s the config + manifest and assembles the pod env (AITK_*/NOEMA_*/R2_*)
//   4. provisions a pod + launches `aitktrainer.py` detached (no held stream), and
//      returns `{ externusJobId: podId }` for webhook correlation.
//
// Pod provisioning sits behind the `TrainingPodProvisioner` port — faked in tests,
// SecurePodClient-backed in prod (`securePodTrainingProvisioner`). This file is pure
// (resolve → generate → env), so the whole launch shape is hermetically testable; only
// the provisioner's actual SSH/GPU work is the live seam.
// =============================================================================

import type { R2Config } from './comfyrunnerClient.js'
import type { DatasetResolver } from './datasetManifest.js'
import type { RemoteAitkLauncher as RemoteAitkLauncherPort, RemoteAitkLaunchSpec } from './RemoteAitoolkitTrainingCursor.js'
import { buildAitkConfig, buildAitkCaptionConfig } from './aitkConfig.js'
import { withCallbackNonce } from './RunPodCursor.js'
import type { DetachedPodScript } from './SecurePodClient.js'

export type { DetachedPodScript }

/** Where the ai-toolkit clone lives on the pod (cloned at bootstrap; `aitktrainer.py`'s AITK_DIR). */
export const POD_AITK_DIR = '/aitk'

/** The pod-side dataset dir aitktrainer.py stages into — must match the generated config's
 *  `folder_path` AND the pod's `AITK_DATASET_DIR`. Single-sourced here to keep them in lockstep. */
export const POD_DATASET_DIR = `${POD_AITK_DIR}/dataset`

/** Pod path the resume weights download to — the config's `pretrained_lora_path` AND the pod's
 *  `AITK_RESUME_PATH` (default), single-sourced so they stay in lockstep. */
export const POD_RESUME_PATH = `${POD_AITK_DIR}/resume.safetensors`

/** ai-toolkit commit cloned on the pod — pinned to the SHA we live-verified locally (klein-4b). */
export const DEFAULT_AITK_REF = 'af594061ab76402eb1261a0450538fba53b41411'

/** The recommended pod base: a stock RunPod image already carrying torch 2.9.1 + CUDA 12.8.1
 *  (ai-toolkit needs torch ≥2.9) — SSH-ready, so we bootstrap ai-toolkit over SSH (no custom image). */
export const DEFAULT_AITK_IMAGE = 'runpod/pytorch:1.0.7-cu1281-torch291-ubuntu2404'

/**
 * Provision a pod, run `setup` over SSH (bootstrap ai-toolkit onto the stock base), then launch a
 * detached pod script with `env`. `RUNPOD_POD_ID` is injected by the implementation (it knows the
 * pod id), so callers leave it out. Faked in tests; SecurePodClient-backed in prod.
 *
 * `provision` resolves once the pod id exists; the SSH + bootstrap phase that follows runs in the
 * background. Two optional hooks carry what that split needs:
 *   - `onPodId` is awaited after provisioning and BEFORE any pod-side work starts — it is where the
 *     caller records the handle, so nothing pod-side can call back before the run carries it.
 *   - `onLaunchFailed` receives a failure from the background phase (the pod is already terminated
 *     by then), so the run can be failed at once instead of waiting out its deadline.
 *
 * `script` names which pod script the provisioned pod runs. It is OPTIONAL and an absent value is
 * the trainer, so every caller that predates the selector — and the training arm, which never
 * passes one — provisions and launches exactly as it did before. One provisioning path, one
 * bootstrap-and-launch flow, one place where SSH and failure handling live; the two arms differ
 * only in the bootstrap they hand in and the script they name.
 */
export interface TrainingPodProvisioner {
  provision(opts: {
    image: string
    env: Record<string, string>
    setup: string[]
    /** Pod script to launch — default `'trainer'`. */
    script?: DetachedPodScript
    onPodId?: (podId: string) => Promise<void>
    onLaunchFailed?: (err: unknown) => Promise<void>
  }): Promise<{ podId: string }>
}

export interface RemoteAitkLauncherDeps {
  provisioner: TrainingPodProvisioner
  resolver: DatasetResolver
  /** The pod base image — a stock RunPod image with torch ≥2.9 (default `DEFAULT_AITK_IMAGE`);
   *  ai-toolkit is bootstrapped onto it over SSH. */
  image?: string
  /** ai-toolkit commit to clone on the pod (default `DEFAULT_AITK_REF`). */
  aitkRef?: string
  /** R2 the pod uploads the trained LoRA to (the host re-hosts it at finality). */
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

export class RemoteAitkLauncher implements RemoteAitkLauncherPort {
  constructor(private readonly deps: RemoteAitkLauncherDeps) {}

  async launch(spec: RemoteAitkLaunchSpec): Promise<{ externusJobId: string }> {
    // 1. dataset reference → manifest the pod pulls.
    const manifest = await this.deps.resolver.resolve(spec.dataset)

    // 2. synthesise the config (pod-side dataset path) — the modus owns the yaml. On a resume,
    //    point the network at the prior weights the pod will download (pretrained_lora_path).
    const yaml = buildAitkConfig({
      name: spec.jobId,
      datasetPath: POD_DATASET_DIR,
      triggerWord: spec.triggerWord,
      baseModel: spec.baseModel,
      steps: spec.steps,
      ...(spec.resumeFrom ? { resumeFrom: POD_RESUME_PATH } : {}),
      ...(spec.samplePrompts ? { samplePrompts: spec.samplePrompts } : {}),
    })

    // 3. assemble the pod env (config + manifest base64'd; RUNPOD_POD_ID injected by the provisioner).
    const r2 = this.deps.r2
    const env: Record<string, string> = {
      AITK_DIR: POD_AITK_DIR,
      AITK_JOB_ID: spec.jobId,
      AITK_CONFIG_B64: Buffer.from(yaml, 'utf8').toString('base64'),
      AITK_MANIFEST_B64: Buffer.from(JSON.stringify(manifest), 'utf8').toString('base64'),
      AITK_DATASET_DIR: POD_DATASET_DIR,
      AITK_STEPS: String(spec.steps),
      AITK_GPU_IDS: spec.gpuId ?? '0',
      NOEMA_ACTUM_ID: spec.actumId,
      NOEMA_STATUS_URL: this.deps.statusUrl,
      // Completion sink. When the cursor minted a per-job callback nonce it rides as the last path
      // segment, so the webhook can bind this pod's callback to this run; with no nonce on the
      // spec the URL is the bare base, exactly as before.
      NOEMA_WEBHOOK_URL: spec.callbackNonce
        ? withCallbackNonce(this.deps.webhookUrl, spec.callbackNonce)
        : this.deps.webhookUrl,
      R2_ENDPOINT: r2.endpoint,
      R2_ACCESS_KEY_ID: r2.accessKeyId,
      R2_SECRET_ACCESS_KEY: r2.secretAccessKey,
      R2_BUCKET_NAME: r2.bucket,
      R2_PUBLIC_URL: r2.publicUrl ?? '',
    }

    // Resume/continue: the pod downloads these prior weights to POD_RESUME_PATH (where the
    // config's pretrained_lora_path points) before training.
    if (spec.resumeFrom) env.AITK_RESUME_URL = spec.resumeFrom

    // Auto-caption (default on): hand the pod an ai-toolkit Qwen3-VL caption config; it fills
    // captions for any staged image lacking a .txt sidecar BEFORE training (recaption:false →
    // dataset-provided captions win). The modus accepts images-only.
    if (spec.autocaption !== false) {
      const captionYaml = buildAitkCaptionConfig({ datasetPath: POD_DATASET_DIR })
      env.AITK_CAPTION_CONFIG_B64 = Buffer.from(captionYaml, 'utf8').toString('base64')
    }

    // 4. bootstrap recipe: clone ai-toolkit (pinned) onto the stock torch≥2.9 base + install its
    //    deps (torch is already present in the base) + boto3. Run over SSH before the runner starts.
    const aitkRef = this.deps.aitkRef ?? DEFAULT_AITK_REF
    const setup = [
      // system libs ai-toolkit's opencv/ffmpeg need at runtime (libGL.so.1 etc.) — the stock base
      // lacks them; without this run.py crashes on `import cv2` (the local image baked these as apt pkgs).
      'apt-get update -qq && apt-get install -y -qq libgl1 libglib2.0-0 ffmpeg',
      `rm -rf ${POD_AITK_DIR} && git clone https://github.com/ostris/ai-toolkit ${POD_AITK_DIR}`,
      `cd ${POD_AITK_DIR} && git checkout ${aitkRef} && git submodule update --init --recursive`,
      `cd ${POD_AITK_DIR} && pip install --break-system-packages -q -r requirements.txt boto3`,
      // ai-toolkit's deps disturb the base's matched torch stack → torchaudio loads against a
      // mismatched libtorch (undefined-symbol crash at `import torchaudio`). Force the proven
      // cu128 trio back as the FINAL state (the base already had it; requirements moved it).
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

/** Adapt a SecurePodClient (its `launchTrainingPod`) to the `TrainingPodProvisioner` port.
 *  Typed structurally so the launcher carries no SecurePodClient import. */
export function securePodTrainingProvisioner(
  client: {
    launchTrainingPod(opts: {
      image: string
      env: Record<string, string>
      setup: string[]
      script?: DetachedPodScript
      onPodId?: (podId: string) => Promise<void>
      onLaunchFailed?: (err: unknown) => Promise<void>
    }): Promise<{ podId: string }>
  },
): TrainingPodProvisioner {
  return { provision: (opts) => client.launchTrainingPod(opts) }
}
