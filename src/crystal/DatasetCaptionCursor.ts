import { randomUUID } from 'node:crypto'
import type { Cursor, CursorResult, Actorum } from '../types/cursus.js'
import type { Actum } from '../types/actum.js'
import type { Modus } from '../types/modus.js'

// =============================================================================
// DatasetCaptionCursor — batch dataset captioning on a provisioned, billed pod
// =============================================================================
//
// The dispatch half of the dataset caption job (`modus.dataset-caption`). It is the
// same shape as RemoteAitoolkitTrainingCursor — reserve a pod-seconds cap, hand the
// launch to an injected launcher port, stamp the external job handle on the actum and
// return `{ kind:'async', externusJobId }` — because a caption job IS a normal metered
// run: it appears in run history, it reserves and settles, and it costs credits. There
// is no free-upkeep lane and no second lifecycle here.
//
// One dataset in, one pod, one settlement, one captionset out. The pod captions every
// image and uploads a `{mediaId: caption}` map; the completion webhook runs the caption
// finalizer (`captionFinalizer.ts`), which validates the keys and persists the captionset.
//
// This cursor registers under the ministerium 'aitkcaption'. `Cursorum` is a flat
// Map<ministerium, Cursor> whose `register` is a bare set, so registering a caption cursor
// under 'aitoolkit' would replace the training cursor and send every training dispatch here.
// The caption arm owns its own key.
// =============================================================================

/** The high-level caption inputs the launcher needs. The modus owns the config — the user
 *  brings a DATASET id (+ optional knobs), never a yaml — so the LAUNCHER resolves the dataset
 *  → a manifest and synthesises the caption config with the pod-side dataset path. */
export interface CaptionLaunchSpec {
  /** The caption Actum's id — the pod posts `/runner/status` + the completion webhook against it. */
  actumId: string
  /** Job id (= the pod-side job name, and the R2 key prefix the harvest lands under). */
  jobId: string
  /** The dataset to caption — a dataset id, resolved against the `Datasets` store. */
  datasetId: string
  /** Instruction handed to the captioner; the config generator's default when absent. */
  captionPrompt?: string
  /** Caption length cap in tokens; the config generator's default when absent. */
  maxNewTokens?: number
  gpuId?: string
  /**
   * Per-job callback credential. When present the launcher appends it to the completion webhook
   * URL it injects into the pod, so the callback is admitted only for this run. Minted by the
   * CURSOR (not the launcher), for the same reason the training cursor mints its own: a
   * launcher-side mint would leave a pod live with a nonce the actum does not yet carry.
   */
  callbackNonce?: string
}

/** Provision a pod + launch the caption pass; resolves with the external run handle. */
export interface CaptionLauncher {
  launch(spec: CaptionLaunchSpec): Promise<{ externusJobId: string }>
}

export interface DatasetCaptionCursorDeps {
  launcher: CaptionLauncher
  /** Stamp the externusJobId + `agens` so the completion webhook can find the run. */
  actorum: Pick<Actorum, 'update'>
  /** Reservation cap in pod-seconds (1 impetus pt ≈ 1 SECURE-second) — default `DEFAULT_MAX_CAPTION_SECONDS`. */
  maxCaptionSeconds?: number
}

/**
 * Default pod-seconds cap for a caption pass — 30 minutes.
 *
 * Far below training's 7200 (2h) on purpose: a caption pass loads one VL model once and runs a
 * bounded forward pass per image, where a training run is thousands of optimizer steps. The cap
 * is only an upper bound for the balance check and the ledger lock — the completion webhook
 * settles the reservation down to the actual duration, so a cap set high mostly locks credits a
 * user could otherwise spend. Set it to something a large dataset can still finish inside.
 */
export const DEFAULT_MAX_CAPTION_SECONDS = 1800

export class DatasetCaptionCursor implements Cursor {
  constructor(private readonly deps: DatasetCaptionCursorDeps) {}

  async reserve(modus: Modus, _aditus: Record<string, unknown>): Promise<bigint> {
    if (modus.impetusFixum !== undefined) return modus.impetusFixum   // honour a fixed price if one is declared
    return BigInt(this.deps.maxCaptionSeconds ?? DEFAULT_MAX_CAPTION_SECONDS)   // else a pod-seconds upper bound
  }

  async run(actum: Actum): Promise<CursorResult> {
    const aditus = actum.aditus
    const jobId = String(aditus.jobId ?? actum.id)
    const datasetId = String(aditus.dataset ?? '')
    if (!datasetId) throw new Error('dataset caption: `dataset` is required (a dataset id)')
    const captionPrompt = typeof aditus.captionPrompt === 'string' && aditus.captionPrompt.trim()
      ? aditus.captionPrompt.trim()
      : undefined
    const maxNewTokens = asPositiveInt(aditus.maxNewTokens)
    const gpuId = aditus.gpuId !== undefined ? String(aditus.gpuId) : undefined

    // Per-job callback credential — minted before launch so the pod's webhook URL carries it, and
    // persisted below in the SAME patch as `externusJobId`, so a caption pod is never in flight
    // with a nonce the actum does not carry.
    const callbackNonce = randomUUID()

    const { externusJobId } = await this.deps.launcher.launch({
      actumId: actum.id, jobId, datasetId, callbackNonce,
      ...(captionPrompt ? { captionPrompt } : {}),
      ...(maxNewTokens !== undefined ? { maxNewTokens } : {}),
      ...(gpuId ? { gpuId } : {}),
    })

    // The caption pod is dedicated + one-shot — flag it so the completor terminates it when the
    // run ends (success or failure). Without this the pod leaks: complete() keeps warm pods alive
    // and the idle reaper only sweeps pooled pods.
    await this.deps.actorum.update(actum.id, { externusJobId, callbackNonce, oneshotPod: true, status: 'agens' })
    return { kind: 'async', externusJobId }
  }
}

function asPositiveInt(v: unknown): number | undefined {
  const n = Number(v)
  return Number.isInteger(n) && n > 0 ? n : undefined
}
