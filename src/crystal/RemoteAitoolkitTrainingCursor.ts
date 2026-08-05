import type { Cursor, CursorResult, Actorum } from '../types/cursus.js'
import type { Actum } from '../types/actum.js'
import type { Modus } from '../types/modus.js'
import { parseSamplePrompts } from './aitkConfig.js'

// =============================================================================
// RemoteAitoolkitTrainingCursor — training on a provisioned, billed pod (Slice E)
// =============================================================================
//
// The remote twin of AitoolkitTrainingCursor. Where the local cursor blocks on our
// own GPU and charges 0n, this dispatches the run onto a SECURE pod and returns
// `{ kind:'async', externusJobId }` — the run completes later via the shared
// execution webhook (→ findByExternusJobId → ActumCompletor), where the training
// finalizer (urlLoraReader) hosts the pod-uploaded LoRA + registers the Intella.
//
// This mirrors RunPodCursor's async tail exactly (RunPodCursor.ts:188-190): stamp
// the externusJobId + flip the actum to `agens`, then hand the run-id back for
// webhook correlation. Pod provisioning + the pod-side ai-toolkit runner live
// behind the injected `RemoteAitkLauncher` port — faked in tests; its real
// SecurePodClient-backed implementation is the GPU-gated follow-up.
//
// Cost: real pod-hours. `reserve` returns a pod-seconds cap (settled down to the
// actual run length at the completion webhook, like inference). The training
// modus omits `impetusFixum`, so this cap — not 0n — is what's used.
// =============================================================================

/**
 * The high-level training inputs the launcher needs. The modus owns the config — the user
 * brings a dataset (+ knobs), NEVER a yaml — so the LAUNCHER resolves the dataset → a manifest
 * and synthesises the training config (`buildAitkConfig`) with the pod-side dataset path, then
 * provisions + bootstraps. This mirrors the local cursor, which generates its own config too.
 */
export interface RemoteAitkLaunchSpec {
  /** The training Actum's id — the pod posts `/runner/status` + the completion webhook against it. */
  actumId: string
  /** ai-toolkit Job id (= the config `name`). */
  jobId: string
  /** Dataset reference — a corpusId or an inline manifest; the launcher resolves it. */
  dataset: string
  /** Base-model preset key (e.g. 'klein-4b'). */
  baseModel: string
  /** The LoRA trigger word. */
  triggerWord: string
  /** Total steps (additional, when resuming). */
  steps: number
  /** Weights-only resume/continue: a URL of prior LoRA weights the pod inits the network from
   *  (a rescued checkpoint for crash-recovery, or a finished LoRA to extend). */
  resumeFrom?: string
  /** End-of-run sample prompts for the card gallery (`[trigger]` substituted) — default a generic
   *  set; pass dataset-caption-derived prompts to preview what the LoRA actually learned. */
  samplePrompts?: string[]
  /** Auto-caption images that arrive without a caption (default true) — the modus does everything. */
  autocaption?: boolean
  gpuId?: string
  /** Optional JSON stored on the Job row. */
  jobConfig?: string
}

/** Provision a pod + launch the ai-toolkit run; resolves with the external run handle. */
export interface RemoteAitkLauncher {
  launch(spec: RemoteAitkLaunchSpec): Promise<{ externusJobId: string }>
}

export interface RemoteAitoolkitTrainingCursorDeps {
  launcher: RemoteAitkLauncher
  /** Stamp the externusJobId + `agens` so the completion webhook can find the run. */
  actorum: Pick<Actorum, 'update'>
  /** Reservation cap in pod-seconds (1 impetus pt ≈ 1 SECURE-second) — default 7200 (2h). */
  maxTrainingSeconds?: number
}

export class RemoteAitoolkitTrainingCursor implements Cursor {
  constructor(private readonly deps: RemoteAitoolkitTrainingCursorDeps) {}

  async reserve(modus: Modus, _aditus: Record<string, unknown>): Promise<bigint> {
    if (modus.impetusFixum !== undefined) return modus.impetusFixum   // honour a fixed price if one is declared
    return BigInt(this.deps.maxTrainingSeconds ?? 7200)               // else a pod-seconds upper bound
  }

  async run(actum: Actum): Promise<CursorResult> {
    const aditus = actum.aditus
    const jobId = String(aditus.jobId ?? actum.id)
    const dataset = String(aditus.dataset ?? '')
    if (!dataset) throw new Error('aitoolkit remote training: `dataset` is required (a corpusId or manifest)')
    const baseModel = String(aditus.baseModel ?? '')
    if (!baseModel) throw new Error('aitoolkit remote training: `baseModel` is required')
    const triggerWord = String(aditus.triggerWord ?? '')
    if (!triggerWord) throw new Error('aitoolkit remote training: `triggerWord` is required')
    const steps = asPositiveInt(aditus.steps)
    if (steps === undefined) throw new Error('aitoolkit remote training: `steps` is required (a positive integer)')
    const gpuId = aditus.gpuId !== undefined ? String(aditus.gpuId) : undefined
    const jobConfig = typeof aditus.jobConfig === 'string' ? aditus.jobConfig : undefined
    const autocaption = aditus.autocaption !== false   // default on — caption missing captions
    const resumeFrom = typeof aditus.resumeFrom === 'string' && aditus.resumeFrom.trim() ? aditus.resumeFrom.trim() : undefined
    const samplePrompts = parseSamplePrompts(aditus.samplePrompts)

    const { externusJobId } = await this.deps.launcher.launch({
      actumId: actum.id, jobId, dataset, baseModel, triggerWord, steps, autocaption,
      ...(gpuId ? { gpuId } : {}),
      ...(jobConfig ? { jobConfig } : {}),
      ...(resumeFrom ? { resumeFrom } : {}),
      ...(samplePrompts ? { samplePrompts } : {}),
    })

    // The training pod is dedicated + one-shot — flag it so the completor terminates it
    // when the run ends (success or failure), not just on failure. Without this the pod
    // leaks: complete() keeps warm pods alive, and the idle reaper only sweeps pooled pods.
    await this.deps.actorum.update(actum.id, { externusJobId, oneshotPod: true, status: 'agens' })
    return { kind: 'async', externusJobId }
  }
}

function asPositiveInt(v: unknown): number | undefined {
  const n = Number(v)
  return Number.isInteger(n) && n > 0 ? n : undefined
}
