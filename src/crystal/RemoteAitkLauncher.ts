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
import { buildAitkConfig } from './aitkConfig.js'

/** The pod-side dataset dir aitktrainer.py stages into — must match the generated config's
 *  `folder_path` AND the pod's `AITK_DATASET_DIR`. Single-sourced here to keep them in lockstep. */
export const POD_DATASET_DIR = '/aitk/dataset'

/**
 * Provision a pod and launch a detached pod script with `env` — the minimal provisioning the
 * launcher needs. `RUNPOD_POD_ID` is injected by the implementation (it knows the pod id), so
 * callers leave it out. Faked in tests; SecurePodClient-backed in prod.
 */
export interface TrainingPodProvisioner {
  provision(opts: { image: string; env: Record<string, string> }): Promise<{ podId: string }>
}

export interface RemoteAitkLauncherDeps {
  provisioner: TrainingPodProvisioner
  resolver: DatasetResolver
  /** The ai-toolkit training image (ai-toolkit + run.py baked, weights cached). */
  image: string
  /** R2 the pod uploads the trained LoRA to (the host re-hosts it at finality). */
  r2: R2Config
  /** Our `/runner/status` sink — the pod POSTs its Progressus here. */
  statusUrl: string
  /** Our completion webhook — the pod POSTs `{id,status,output,executionTime}` here. */
  webhookUrl: string
}

export class RemoteAitkLauncher implements RemoteAitkLauncherPort {
  constructor(private readonly deps: RemoteAitkLauncherDeps) {}

  async launch(spec: RemoteAitkLaunchSpec): Promise<{ externusJobId: string }> {
    // 1. dataset reference → manifest the pod pulls.
    const manifest = await this.deps.resolver.resolve(spec.dataset)

    // 2. synthesise the config (pod-side dataset path) — the modus owns the yaml.
    const yaml = buildAitkConfig({
      name: spec.jobId,
      datasetPath: POD_DATASET_DIR,
      triggerWord: spec.triggerWord,
      baseModel: spec.baseModel,
      steps: spec.steps,
    })

    // 3. assemble the pod env (config + manifest base64'd; RUNPOD_POD_ID injected by the provisioner).
    const r2 = this.deps.r2
    const env: Record<string, string> = {
      AITK_JOB_ID: spec.jobId,
      AITK_CONFIG_B64: Buffer.from(yaml, 'utf8').toString('base64'),
      AITK_MANIFEST_B64: Buffer.from(JSON.stringify(manifest), 'utf8').toString('base64'),
      AITK_DATASET_DIR: POD_DATASET_DIR,
      AITK_STEPS: String(spec.steps),
      AITK_GPU_IDS: spec.gpuId ?? '0',
      NOEMA_ACTUM_ID: spec.actumId,
      NOEMA_STATUS_URL: this.deps.statusUrl,
      NOEMA_WEBHOOK_URL: this.deps.webhookUrl,
      R2_ENDPOINT: r2.endpoint,
      R2_ACCESS_KEY_ID: r2.accessKeyId,
      R2_SECRET_ACCESS_KEY: r2.secretAccessKey,
      R2_BUCKET_NAME: r2.bucket,
      R2_PUBLIC_URL: r2.publicUrl ?? '',
    }

    // 4. provision + launch detached; the pod id IS the external run handle.
    const { podId } = await this.deps.provisioner.provision({ image: this.deps.image, env })
    return { externusJobId: podId }
  }
}

/** Adapt a SecurePodClient (its `launchTrainingPod`) to the `TrainingPodProvisioner` port.
 *  Typed structurally so the launcher carries no SecurePodClient import. */
export function securePodTrainingProvisioner(
  client: { launchTrainingPod(opts: { image: string; env: Record<string, string> }): Promise<{ podId: string }> },
): TrainingPodProvisioner {
  return { provision: (opts) => client.launchTrainingPod(opts) }
}
