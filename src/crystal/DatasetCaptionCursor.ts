import { randomUUID } from 'node:crypto'
import type { Cursor, CursorResult, Actorum } from '../types/cursus.js'
import type { Actum } from '../types/actum.js'
import type { Modus } from '../types/modus.js'
import type { Datasets } from '../types/dataset.js'
import { uncoveredMedia } from './datasetManifest.js'
import { PROVISION_BUDGET_MS } from './SecurePodClient.js'
import { FIRST_HEARTBEAT_DEADLINE_MS } from './expiryReaper.js'

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
// One dataset in, one pod, one settlement, one captionset out. The pod captions the images
// it is staged and uploads a `{mediaId: caption}` map; the completion webhook runs the caption
// finalizer (`captionFinalizer.ts`), which validates the keys and persists the captionset.
//
// A pass EXTENDS by default. Given a captionset in `aditus.captionset` it stages only the media
// that captionset does not cover and the harvest lands back in it; given none it captions the
// whole working set and mints one. Because the extending pass can turn out to have no work at
// all, the emptiness check belongs in `reserve()` — see the note there.
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
  /**
   * The captionset this pass EXTENDS, when it was given one. Present → only the media that
   * captionset does not already cover is staged, and the harvest lands back in it. Absent →
   * the pass captions the whole working set and mints a captionset of its own.
   */
  captionsetId?: string
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
  /**
   * Called with the pod id the moment provisioning yields one, and awaited before the launcher
   * starts any pod-side work. The cursor stamps the actum here so the run carries the handle and
   * the nonce before a pod exists that could call back with them.
   */
  onPodId?: (podId: string) => Promise<void>
}

/** Provision a pod + launch the caption pass; resolves with the external run handle. */
export interface CaptionLauncher {
  launch(spec: CaptionLaunchSpec): Promise<{ externusJobId: string }>
}

export interface DatasetCaptionCursorDeps {
  launcher: CaptionLauncher
  /**
   * The dataset store — read in `reserve()` to find out whether an extending pass has any
   * uncaptioned media left. REQUIRED, not optional: a guard that a deployment can leave unwired
   * is a guard that does not run where the money is spent.
   */
  datasets: Pick<Datasets, 'find'>
  /** Stamp the externusJobId + `agens` so the completion webhook can find the run. */
  actorum: Pick<Actorum, 'update'>
  /** Reservation cap in pod-seconds (1 impetus pt ≈ 1 SECURE-second) — default `DEFAULT_MAX_CAPTION_SECONDS`. */
  maxCaptionSeconds?: number
  /**
   * How long the caption pod has to say its first word once the host has locked a machine for
   * it — default `FIRST_HEARTBEAT_DEADLINE_MS`. Stamped onto the actum at dispatch, enforced by
   * the first-heartbeat sweep in `expiryReaper`.
   *
   * The knob exists because the right value is a property of THIS pod's startup — a caption pod
   * installs a small runtime and then loads one vision-language model — and a deployment that
   * moves either should be able to move the window with it rather than editing the reaper.
   */
  firstHeartbeatDeadlineMs?: number
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

  /**
   * Price the pass — and refuse one that has nothing to do, BEFORE anything is locked.
   *
   * A caption pass reserves a pod-seconds cap and then provisions real hardware, and both the
   * provisioning and the runtime bootstrap are billed before the first caption exists. A pass
   * over a captionset that already covers every live image would spend all of that to hand back
   * what it was given, so the refusal lives here rather than in `run()`: a guard that reserves
   * first and refuses second still freezes the payer's credits for the length of the run's
   * expiry window. Same placement, and the same reason, as the decompose cursor's own up-front
   * refusals.
   *
   * Only an EXTENDING pass can be empty. A pass given no captionset captions the whole working
   * set, and the launcher already fails a dataset with no media at all.
   */
  async reserve(modus: Modus, aditus: Record<string, unknown>): Promise<bigint> {
    await this.assertWork(aditus)
    if (modus.impetusFixum !== undefined) return modus.impetusFixum   // honour a fixed price if one is declared
    return BigInt(this.deps.maxCaptionSeconds ?? DEFAULT_MAX_CAPTION_SECONDS)   // else a pod-seconds upper bound
  }

  /** Throw when the pass this aditus describes has no image left to caption. No-op for a pass
   *  that was given no captionset — that one captions everything. */
  private async assertWork(aditus: Record<string, unknown>): Promise<void> {
    const captionsetId = typeof aditus.captionset === 'string' ? aditus.captionset.trim() : ''
    if (!captionsetId) return

    const datasetId = typeof aditus.dataset === 'string' ? aditus.dataset.trim() : ''
    if (!datasetId) throw new Error('dataset caption: `dataset` is required (a dataset id)')

    const dataset = await this.deps.datasets.find(datasetId)
    if (!dataset) throw new Error(`dataset caption: dataset '${datasetId}' does not exist`)

    const captionset = dataset.captionsets.find((c) => c.id === captionsetId)
    if (!captionset) {
      throw new Error(`dataset caption: captionset '${captionsetId}' is not on dataset '${datasetId}'`)
    }

    if (uncoveredMedia(dataset, captionset).length === 0) {
      throw new Error(
        `dataset caption: captionset '${captionsetId}' already covers every image on dataset '${datasetId}' — nothing to caption`,
      )
    }
  }

  /**
   * Wall-clock budget for a caption run: the pod provisioning budget PLUS the caption window the
   * reservation pays for. Two different clocks, added rather than maxed — provisioning is renting a
   * machine and building an environment on it; the caption window is the work itself, which cannot
   * start until provisioning has finished.
   *
   * Deliberately NOT derived from `reserve()`: `reserve()` short-circuits to `modus.impetusFixum`
   * when the modus declares a fixed price, and a price read as a duration would hand a flat-priced
   * caption modus a deadline of a few seconds.
   *
   * The cost of the number: the actum's `expirat` is what releases its locked reserve, so a run
   * that stops reporting holds the payer's credits locked for this long before the reaper frees
   * them (clamped by MAX_TERMINUS_MS). Nothing is charged — a reaped run is failed, not settled.
   *
   * This is the OUTER bound only. A pod that is locked and then never speaks at all is caught far
   * sooner by the first-heartbeat deadline (`firstHeartbeatDeadlineMs`, armed in `run()`), which
   * is what keeps a pod that dies in its first second off this clock.
   */
  async terminus(_modus: Modus, _aditus: Record<string, unknown>): Promise<number> {
    return PROVISION_BUDGET_MS + (this.deps.maxCaptionSeconds ?? DEFAULT_MAX_CAPTION_SECONDS) * 1000
  }

  async run(actum: Actum): Promise<CursorResult> {
    const aditus = actum.aditus
    const jobId = String(aditus.jobId ?? actum.id)
    const datasetId = String(aditus.dataset ?? '')
    if (!datasetId) throw new Error('dataset caption: `dataset` is required (a dataset id)')
    // The captionset this pass extends, when it was given one — the same `aditus` key the
    // decompose modus uses, and the one the finalizer reads to know where the harvest lands.
    const captionsetId = typeof aditus.captionset === 'string' && aditus.captionset.trim()
      ? aditus.captionset.trim()
      : undefined
    const captionPrompt = typeof aditus.captionPrompt === 'string' && aditus.captionPrompt.trim()
      ? aditus.captionPrompt.trim()
      : undefined
    const maxNewTokens = asPositiveInt(aditus.maxNewTokens)
    const gpuId = aditus.gpuId !== undefined ? String(aditus.gpuId) : undefined

    // Per-job callback credential — minted before launch so the pod's webhook URL carries it, and
    // persisted below in the SAME patch as `externusJobId`, so a caption pod is never in flight
    // with a nonce the actum does not carry.
    const callbackNonce = randomUUID()

    // The stamp: the external handle, the nonce, and `oneshotPod` — the caption pod is dedicated,
    // so the flag is what has the completor terminate it when the run ends (success or failure).
    // Without it the pod leaks: complete() keeps warm pods alive and the idle reaper only sweeps
    // pooled pods.
    //
    // Handed to the launcher as `onPodId` so it lands the moment the pod id exists and BEFORE the
    // pod is bootstrapped — the launch resolves at provisioning and does the rest in the
    // background, so "after launch resolves" is no longer early enough on its own. A launcher that
    // does not call the hook still gets the stamp, below, exactly as before.
    //
    // `firstHeartbeatDeadlineMs` rides in the same patch — this is a DETACHED pod, whose only
    // channel back is its own status posts, so the run opts into the first-heartbeat deadline
    // that bounds a pod which is locked and then never speaks. It has to be on the actum before
    // the pod lock, because the lock report is what starts the clock.
    const firstHeartbeatDeadlineMs = this.deps.firstHeartbeatDeadlineMs ?? FIRST_HEARTBEAT_DEADLINE_MS
    let stamped = false
    const stamp = async (externusJobId: string): Promise<void> => {
      stamped = true
      await this.deps.actorum.update(actum.id, {
        externusJobId, callbackNonce, oneshotPod: true, status: 'agens', firstHeartbeatDeadlineMs,
      })
    }

    const { externusJobId } = await this.deps.launcher.launch({
      actumId: actum.id, jobId, datasetId, callbackNonce, onPodId: stamp,
      ...(captionsetId ? { captionsetId } : {}),
      ...(captionPrompt ? { captionPrompt } : {}),
      ...(maxNewTokens !== undefined ? { maxNewTokens } : {}),
      ...(gpuId ? { gpuId } : {}),
    })

    if (!stamped) await stamp(externusJobId)
    return { kind: 'async', externusJobId }
  }
}

function asPositiveInt(v: unknown): number | undefined {
  const n = Number(v)
  return Number.isInteger(n) && n > 0 ? n : undefined
}
