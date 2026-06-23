import type { Cursor, CursorResult, Actorum } from '../types/cursus.js'
import type { Actum } from '../types/actum.js'
import type { Modus } from '../types/modus.js'

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

/** What the pod needs to run one training job. The launcher provisions + bootstraps from this. */
export interface RemoteAitkLaunchSpec {
  /** The training Actum's id — the pod posts `/runner/status` + the completion webhook against it. */
  actumId: string
  /** ai-toolkit Job id (= the config `name`). */
  jobId: string
  /** Container-relative training yaml. */
  configPath: string
  /** Total steps (for the pod-side progress projection). */
  steps?: number
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
    const configPath = String(aditus.configPath ?? '')
    if (!configPath) throw new Error('aitoolkit remote training: `configPath` is required (the container-relative training yaml)')
    const steps = asPositiveInt(aditus.steps)
    const gpuId = aditus.gpuId !== undefined ? String(aditus.gpuId) : undefined
    const jobConfig = typeof aditus.jobConfig === 'string' ? aditus.jobConfig : undefined

    const { externusJobId } = await this.deps.launcher.launch({
      actumId: actum.id, jobId, configPath,
      ...(steps !== undefined ? { steps } : {}),
      ...(gpuId ? { gpuId } : {}),
      ...(jobConfig ? { jobConfig } : {}),
    })

    await this.deps.actorum.update(actum.id, { externusJobId, status: 'agens' })
    return { kind: 'async', externusJobId }
  }
}

function asPositiveInt(v: unknown): number | undefined {
  const n = Number(v)
  return Number.isInteger(n) && n > 0 ? n : undefined
}
