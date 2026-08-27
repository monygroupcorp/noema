import fs from 'node:fs'
import path from 'node:path'
import type { RunPodClient, ProvisioningContext } from './RunPodCursor.js'
import type { Procurator, StudioStageCb, StudioProvision } from './Procurator.js'
import type { Materia, MateriaStore } from '../types/materia.js'
import type { HospitiumStore } from '../types/hospitium.js'
import type { ActumExecutio } from '../types/actum.js'
import type { Progressus } from '../types/progressus.js'
import { makeLogger } from '../lib/logger.js'
import { SshTransport } from './SshTransport.js'
import { getTrace } from '../lib/trace.js'
import { bus } from '../lib/bus.js'
import { recordProgressus } from '../execution/progressusSink.js'
import { coldStartProgressus } from '../execution/progressus.js'
import { terminatePod as _terminatePodUtil } from './terminatePod.js'
import { submitToRunner, awaitViaStream, isCompiledSpec, type R2Config } from './comfyrunnerClient.js'
import { computeBootCostImpetus, impetusPerSecondFromHourly } from '../ledger/rates.js'

const COMFYRUNNER_SCRIPT_PATH = path.resolve(__dirname, '../../scripts/pod/comfyrunner.py')
// The multi-runtime runner (ADR-0007) — shipped for non-ComfyUI runtimes (vLLM). ComfyUI stays on
// comfyrunner.py until its cutover is live-verified, so the proven gen path is untouched.
const RUNNER_SCRIPT_PATH = path.resolve(__dirname, '../../scripts/pod/runner.py')
// The one-shot LoRA trainer (Slice E) — launched detached for a long single job (not the
// VRAM-scheduled runner.py, not comfyrunner's held SSE pipeline).
const AITKTRAINER_SCRIPT_PATH = path.resolve(__dirname, '../../scripts/pod/aitktrainer.py')
// The caption pass — its own pod script, so a caption pod carries a caption runtime instead of a
// training toolkit. Same detached launch, same bootstrap-and-SSH flow; only the script differs.
const CAPTIONER_SCRIPT_PATH = path.resolve(__dirname, '../../scripts/pod/captioner.py')

/**
 * Which pod script a detached launch uploads and runs. The provisioning port carries this as an
 * OPTIONAL value and an absent one is `'trainer'` — the training path predates the selector and
 * behaves exactly as it did when there was none.
 */
export type DetachedPodScript = 'trainer' | 'captioner'

const DETACHED_POD_SCRIPTS: Record<DetachedPodScript, { path: string; name: string }> = {
  trainer: { path: AITKTRAINER_SCRIPT_PATH, name: 'aitktrainer.py' },
  captioner: { path: CAPTIONER_SCRIPT_PATH, name: 'captioner.py' },
}

/**
 * Resolve the selector to the script a detached launch uploads. Exported because the DEFAULT is
 * the load-bearing half: an absent selector must resolve to the trainer, which is what keeps
 * every caller that names none launching what it always launched.
 */
export function resolveDetachedPodScript(script?: DetachedPodScript): { path: string; name: string } {
  return DETACHED_POD_SCRIPTS[script ?? 'trainer']
}

const log = makeLogger('cursor:runpod:secure')

// Pinned ComfyUI ref (2026-07-10 P0): bootstrap used to clone unpinned HEAD, which drifted onto a
// torch-2.5+-only code path (`enable_gqa` kwarg) while every fundament's image pins torch 2.4.0 —
// every ComfyUI pod broke. `Fundamentum.comfyRef` is the per-substrate source of truth (ADR-0005);
// this constant is the fallback when a caller doesn't have one to pass (submit()'s CompiledSpec
// doesn't yet carry comfyRef — a Compiler-side follow-up, out of this fix's scope). Bump both this
// and every Fundamentum.comfyRef together; never let the clone go unpinned again.
const DEFAULT_COMFYUI_REF = 'v0.26.0'

/**
 * The wall-clock budget for PROVISIONING a pod — renting the machine and building the
 * environment on it, before any of the work the run actually pays for begins.
 *
 * This file's own numbers are what define it: waiting for SSH is bounded by
 * `sshReadyTimeoutMs` (10 min), and the bootstrap that follows clones a repository and
 * installs a large dependency tree over several commands. This constant is the single place
 * that answer lives — `_bootstrapDetached` enforces it as a PHASE deadline, and the pod-rail
 * cursors import it as the first half of their `terminus`, so the provisioning code and the
 * actum's deadline are derived from one number instead of two constants kept in step by hand.
 *
 * It is a DURATION and nothing else. It never reaches `reserve()`, so it does not enter a
 * quote, a balance check, or the size of a ledger lock.
 */
export const PROVISION_BUDGET_MS = 45 * 60 * 1000  // 45 minutes

/** Per-command ceiling inside the bootstrap phase. The effective cap for any one command is
 *  min(this, time left in the phase) — the slowest legitimate step keeps its headroom, while
 *  the commands together can no longer outlast the budget. */
const BOOTSTRAP_CMD_TIMEOUT_MS = 20 * 60 * 1000  // 20 minutes

/**
 * How long a pod that has reported `RUNNING` may go on reporting no public IP before it is
 * abandoned for a fresh one.
 *
 * A direct public IP is not guaranteed on every host; when one is assigned it is present at or
 * shortly after the pod reaches `RUNNING`. A pod that has been `RUNNING` without one for this
 * long is reporting an answer rather than making us wait for it, and the remaining wall-clock of
 * `sshReadyTimeoutMs` buys nothing on that machine — another attempt on a fresh pod is what the
 * run needs. This window starts only once `RUNNING` is observed, so a pod that is legitimately
 * slow to boot still gets the full `sshReadyTimeoutMs` deadline.
 *
 * The floor here is measured, not guessed: a healthy pod probed 2026-08-25 attached its public
 * IP and port mapping at ~136s after `RUNNING`. A prior default of 2 minutes sat below that
 * observed attach time and abandoned healthy pods mid-attach. 8 minutes clears the measured
 * floor with wide margin while staying well under the 10-minute `sshReadyTimeoutMs`, so the
 * bailout still gives up on a genuinely unplaced pod with time left for a retry.
 */
export const SSH_IPLESS_BAILOUT_MS = 8 * 60 * 1000  // 8 minutes

/** Marker on the error thrown when a pod is abandoned for reporting `RUNNING` with no public IP,
 *  so callers (and logs) can tell it apart from the overall SSH-readiness timeout. */
export interface IplessHostError extends Error { iplessHost: true }

/** True when `err` is the ip-less-host bailout rather than the generic SSH-readiness timeout. */
export function isIplessHostError(err: unknown): err is IplessHostError {
  return err instanceof Error && (err as { iplessHost?: boolean }).iplessHost === true
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type { R2Config } from './comfyrunnerClient.js'

// Ordered by preference: 24GB VRAM SECURE-tier GPUs first, then fallbacks
// All GPUs with ≥24 GB VRAM — needed for the full BF16 FLUX model.
// Ordered roughly by expected speed (fastest/most available first).
//
// Every entry MUST be present in ACCEPTED_GPU_TYPE_IDS below (RunPod's current
// gpuTypeIds enum). RunPod's REST API rejects an unknown gpuTypeId with a 400 on
// POST rest.runpod.io/v1/pods — a stale/renamed SKU here silently degrades the
// SECURE tier (both SECURE attempts 400 and the run falls back to COMMUNITY, losing
// the private/TEE guarantee). `assertGpuTypeIdsAccepted` enforces this at construct
// time so a future enum drift fails loud and early instead of as a mid-provision 400.
// (noema-103, 2026-07-14: pruned the A30 SKU — absent from RunPod's accepted enum.)
export const DEFAULT_GPU_TYPE_IDS = [
  'NVIDIA GeForce RTX 4090',
  'NVIDIA GeForce RTX 3090',
  'NVIDIA GeForce RTX 3090 Ti',
  'NVIDIA RTX A5000',
  'NVIDIA A40',
  'NVIDIA L4',
  'NVIDIA L40',
  'NVIDIA L40S',
  'NVIDIA RTX A6000',
  'NVIDIA RTX 6000 Ada Generation',
  'NVIDIA A100 80GB PCIe',
  'NVIDIA A100-SXM4-80GB',
  'NVIDIA H100 PCIe',
  'NVIDIA H100 NVL',
  'NVIDIA H100 80GB HBM3',
  'NVIDIA RTX A4500',
  'NVIDIA RTX 4000 Ada Generation',
]

// RunPod's accepted `gpuTypeIds` enum, snapshotted verbatim from the staging 400 body
// (2026-07-31). This is the authoritative allow-list DEFAULT_GPU_TYPE_IDS is validated
// against at construct time. When RunPod changes its catalogue the construct-time guard
// throws naming the offending SKU — refresh this snapshot (and prune DEFAULT_GPU_TYPE_IDS
// to match) rather than suppressing the error.
export const ACCEPTED_GPU_TYPE_IDS = [
  'AMD Instinct MI300X OAM',
  'NVIDIA A100 80GB PCIe',
  'NVIDIA A100-SXM4-40GB',
  'NVIDIA A100-SXM4-80GB',
  'NVIDIA A40',
  'NVIDIA B200',
  'NVIDIA B300 SXM6 AC',
  'NVIDIA B300 SXM6 AC MIG 1g.34gb',
  'NVIDIA GeForce RTX 3070',
  'NVIDIA GeForce RTX 3080',
  'NVIDIA GeForce RTX 3080 Ti',
  'NVIDIA GeForce RTX 3090',
  'NVIDIA GeForce RTX 3090 Ti',
  'NVIDIA GeForce RTX 4070 Ti',
  'NVIDIA GeForce RTX 4080',
  'NVIDIA GeForce RTX 4080 SUPER',
  'NVIDIA GeForce RTX 4090',
  'NVIDIA GeForce RTX 5080',
  'NVIDIA GeForce RTX 5090',
  'NVIDIA H100 80GB HBM3',
  'NVIDIA H100 NVL',
  'NVIDIA H100 PCIe',
  'NVIDIA H200',
  'NVIDIA H200 NVL',
  'NVIDIA L4',
  'NVIDIA L40',
  'NVIDIA L40S',
  'NVIDIA RTX 2000 Ada Generation',
  'NVIDIA RTX 4000 Ada Generation',
  'NVIDIA RTX 4000 SFF Ada Generation',
  'NVIDIA RTX 5000 Ada Generation',
  'NVIDIA RTX 6000 Ada Generation',
  'NVIDIA RTX A2000',
  'NVIDIA RTX A4000',
  'NVIDIA RTX A4500',
  'NVIDIA RTX A5000',
  'NVIDIA RTX A6000',
  'NVIDIA RTX PRO 4000 Blackwell',
  'NVIDIA RTX PRO 4500 Blackwell',
  'NVIDIA RTX PRO 5000 Blackwell',
  'NVIDIA RTX PRO 6000 Blackwell Max-Q Workstation Edition',
  'NVIDIA RTX PRO 6000 Blackwell Server Edition',
  'NVIDIA RTX PRO 6000 Blackwell Workstation Edition',
  'Tesla V100-PCIE-16GB',
  'Tesla V100-SXM2-16GB',
]

/**
 * Construct-time guard (noema-103): assert every id in `ids` is present in RunPod's
 * accepted `gpuTypeIds` enum (`accepted`, default ACCEPTED_GPU_TYPE_IDS). Throws an Error
 * naming the specific offending SKU(s) so a RunPod enum drift fails loud and early —
 * before ever reaching a live provision POST — instead of surfacing as an opaque 400.
 */
export function assertGpuTypeIdsAccepted(
  ids: readonly string[],
  accepted: readonly string[] = ACCEPTED_GPU_TYPE_IDS,
): void {
  const offending = ids.filter(id => !accepted.includes(id))
  if (offending.length > 0) {
    throw new Error(
      `SecurePodClient: DEFAULT_GPU_TYPE_IDS contains GPU type id(s) not in RunPod's ` +
      `accepted gpuTypeIds enum: ${offending.map(s => `'${s}'`).join(', ')}. RunPod ` +
      `rejects unknown gpuTypeIds with a 400 on pod provision. Update DEFAULT_GPU_TYPE_IDS ` +
      `and/or the ACCEPTED_GPU_TYPE_IDS snapshot to match RunPod's current enum.`,
    )
  }
}

export interface SecurePodConfig {
  apiKey: string
  sshKeyPath: string
  gpuTypeIds?: string[]   // defaults to DEFAULT_GPU_TYPE_IDS
  imageName?: string      // defaults to spec.image.ociRef at runtime
  cloudType?: 'SECURE' | 'COMMUNITY'
  containerDiskGb?: number
  /** Overrideable timeouts (ms) — defaults tuned for production, inject small values in tests. */
  provisionTimeoutMs?: number    // default: 30_000 — per-request timeout for the pod creation POST
  sshInfoTimeoutMs?: number      // default: 10_000 — per-request timeout for each SSH status poll GET
  sshReadyTimeoutMs?: number     // default: 10 min  — overall deadline for SSH to become reachable
  sshPollIntervalMs?: number     // default: 8000
  /** How long a RUNNING pod may report no public IP before it is abandoned for a fresh one.
   *  Default: SSH_IPLESS_BAILOUT_MS. */
  sshIplessBailoutMs?: number
  comfyReadyTimeoutMs?: number   // default: 5 min
  comfyPollIntervalMs?: number   // default: 2000
  jobTimeoutMs?: number          // default: 15 min
  /** How many times to retry the COMPLETED webhook POST on failure (default: 3). */
  webhookRetries?: number        // default: 3
  /** Base delay between webhook retries in ms; doubles each attempt (default: 1000). */
  webhookRetryDelayMs?: number   // default: 1000
  /** When true: register pod as idle Materia instead of terminating after a successful job. */
  keepWarm?: boolean
  /** How long a pod stays warm/idle before the reaper terminates it (ms). Default 60_000. */
  warmTtlMs?: number
  /** Cost rate for the Materia record (default 0n). */
  impetusPerSecond?: bigint
  /** How many pod provision attempts before giving up (default: 3; last attempt uses COMMUNITY cloud). */
  podRetries?: number
  /** When set, output files are uploaded to R2 before posting the completion webhook. */
  r2?: R2Config
}

export interface SshTransportLike {
  exec(command: string, options?: { stdio?: string; timeout?: number }): Promise<string | undefined>
  close(): Promise<void>
}

interface SshInfo {
  host: string
  port: number
  user: string
  costPerHr?: number
  gpuType?: string
  region?: string
}

interface RunPodPodStatus {
  desiredStatus?: string
  publicIp?: string
  portMappings?: Record<string, number>
  costPerHr?: number
  gpuTypeIds?: string[]
  machine?: { gpuDisplayName?: string; dataCenterId?: string; location?: string }
}

/** A status poll that returned successfully but the pod is not SSH-ready yet — the fields
 *  that distinguish "wrong values" from "never got a reading" (see SshPollResult). */
interface SshPollObservation {
  desiredStatus?: string
  publicIp?: string
  port22?: number
}

/** _getSshInfo's result: ready with `info`, not-ready with a successful `observation`,
 *  or not-ready with no reading at all (`error`) — the fetch itself failed or returned non-2xx. */
type SshPollResult =
  | { info: SshInfo; observation?: undefined; error?: undefined }
  | { info: null; observation: SshPollObservation; error?: undefined }
  | { info: null; observation?: undefined; error: string }

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms))
}

/** Single-quote a value for a POSIX shell command line (escapes embedded single quotes). */
function shellQuote(v: string): string {
  return `'${v.replace(/'/g, `'\\''`)}'`
}

/** Name every machine a launch gave up on, each with why — so the failure a run ends on accounts
 *  for the pods it spent rather than for the last one only. `none` when a launch abandoned no pod
 *  (every attempt failed at provisioning). */
function describeAbandonedPods(abandoned: ReadonlyArray<{ podId: string; reason: string }>): string {
  if (abandoned.length === 0) return 'none'
  return abandoned.map(a => `${a.podId} (${a.reason})`).join(', ')
}

// ---------------------------------------------------------------------------
// SecurePodClient
// ---------------------------------------------------------------------------

// `StudioStageCb` (the `/arm` provisioning stage callback) is the Procurator role's
// type — re-exported here for the existing importers.
export type { StudioStageCb } from './Procurator.js'

export class SecurePodClient implements RunPodClient, Procurator {
  constructor(
    private readonly config: SecurePodConfig,
    private readonly sshFactory: (info: SshInfo) => SshTransportLike,
    private readonly fetchFn: typeof fetch = globalThis.fetch,
    private readonly materiae?: MateriaStore,
    /** Hospitium side-table — when present, a host-guest bond record is created
     *  alongside each warm-parked Materia so dispatch can find the host's anima
     *  without putting identity on the pod's row. */
    private readonly hospitia?: HospitiumStore,
    /** Injectable pod-terminate function — defaults to the RunPod REST call. The
     *  seam exists so tests can swap a spy without module-mocking gymnastics. */
    private readonly terminatePodFn: (apiKey: string, podId: string) => Promise<void> = _terminatePodUtil,
    /**
     * Liveness check for the actum a retry is about to spend a pod on — reads the actum's
     * current status and returns false once it's terminal (`completus`/`fractus`, which also
     * covers the expiry watchdog's fail path). Optional: absent means "can't check" and retries
     * proceed as before (back-compat for callers with no store wired). Bounded to the smallest
     * read surface the retry loop needs — not a full Actorum dependency.
     */
    private readonly isActumLive?: (actumId: string) => Promise<boolean>,
  ) {
    // Fail loud and early if the hardcoded SECURE-tier GPU preference list has drifted
    // out of RunPod's accepted gpuTypeIds enum — surfaces the offending SKU here rather
    // than as an opaque 400 mid-provision (noema-103).
    assertGpuTypeIdsAccepted(DEFAULT_GPU_TYPE_IDS)
  }

  /**
   * Zombie-retry guard (2026-07-13): re-checks the in-flight actum's liveness before spending
   * another pod on it. Fails OPEN (returns true) when there's no actumId in trace or no
   * `isActumLive` callback wired, and on a callback error — a liveness-check hiccup must never
   * block a legitimate retry; the guard only ever narrows the retry loop, never widens it.
   */
  private async _actumStillLive(): Promise<boolean> {
    const actumId = getTrace()?.actumId
    if (!actumId || !this.isActumLive) return true
    try {
      return await this.isActumLive(actumId)
    } catch {
      return true
    }
  }

  async submit(params: {
    input: unknown
    webhook?: string
    jobToken?: string
    provisioningContext?: ProvisioningContext
    /** Per-run object-store override — replaces the construction-time `r2` for this job only
     *  (noema-347: the private-outputs bucket plus the run's owner-scoped key prefix). */
    r2?: R2Config
    onPodActive?: (podId: string) => Promise<void>
    onMetrics?: (executio: ActumExecutio) => Promise<void>
  }): Promise<{ id: string }> {
    // Derive image from spec if available, else fall back to config
    const specOciRef = isCompiledSpec(params.input) ? params.input.image?.ociRef : undefined
    const imageName = specOciRef ?? this.config.imageName ?? 'runpod/pytorch:2.4.0-py3.11-cuda12.4.1-devel-ubuntu22.04'

    const maxAttempts = this.config.podRetries ?? 3

    // Provision with retries — synchronous so we return a real pod ID
    // Attempts 1-2: SECURE cloud. Attempt 3: ALL cloud (community fallback).
    let podId: string | undefined
    let lastProvisionErr: Error | undefined
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const isFallback = attempt >= maxAttempts
      const cloudType = isFallback ? 'COMMUNITY' : undefined
      const gpuTypeIds = isFallback ? null : undefined  // null = any GPU on final attempt
      if (attempt > 1) log.info('retrying pod provision', { attempt, cloudType: cloudType ?? 'SECURE' })
      log.info('pod provisioning', { actumId: getTrace()?.actumId, imageName, cloudType: cloudType ?? 'SECURE' })
      try {
        podId = await this._provisionPod(imageName, cloudType, gpuTypeIds)
        break
      } catch (err) {
        lastProvisionErr = err as Error
        log.warn(`provision attempt ${attempt}/${maxAttempts} failed`, { error: lastProvisionErr.message })
      }
    }
    if (!podId) throw lastProvisionErr

    const _traceCtx = getTrace()
    if (_traceCtx) {
      _traceCtx.wideFields.podId = podId
      _traceCtx.provisionMs = Date.now() - _traceCtx.startTs
    }

    let activePodId = podId
    // Tracks whether comfyrunner accepted the job. Once true, comfyrunner owns
    // the failure webhook — Crystal must not fire a second one.
    let runnerAcceptedJob = false
    const runWithRetry = async () => {
      try {
        await this._runBackground(podId!, imageName, params.input, params.webhook, undefined, (accepted) => { runnerAcceptedJob = accepted }, params.onMetrics, params.provisioningContext, params.jobToken, params.r2)
      } catch (firstErr) {
        // Once comfyrunner accepted the job it OWNS the run and the webhook. A
        // dropped SSE stream after that point means we lost visibility, not that
        // the job failed — re-provisioning would spawn a redundant pod and
        // re-download every model. Stop here and let comfyrunner fire the webhook.
        // EXCEPTION: a throttle bail is a deliberate "this pod is fleecing us" abort
        // — we DO want to re-provision on a fresh pod, so let it fall through to retry.
        if (runnerAcceptedJob && !(firstErr as { isThrottleError?: boolean }).isThrottleError) {
          log.warn('lost SSE after comfyrunner accepted job — not retrying; comfyrunner owns the webhook', { podId, error: (firstErr as Error).message })
          return
        }
        // A permanent (4xx) error is deterministic — a fresh pod hits the same rejection. Fail fast
        // instead of burning more provisions (each re-runs the heavy bootstrap + model download).
        if ((firstErr as { permanent?: boolean }).permanent) {
          log.warn('pod run failed permanently — not retrying', { podId, error: (firstErr as Error).message })
          throw firstErr
        }
        log.warn(`pod run attempt 1/${maxAttempts} failed`, { podId, error: (firstErr as Error).message })
        for (let attempt = 2; attempt <= maxAttempts; attempt++) {
          // Liveness gate — before spending a NEW pod on a retry, confirm the actum this
          // job belongs to hasn't already gone terminal (e.g. the expiry watchdog fired
          // mid-retry and refunded it). Without this, a slow retry cascade keeps
          // provisioning pods for a run nobody is paying for anymore (2026-07-13 incident).
          if (!(await this._actumStillLive())) {
            log.warn('retry aborted — actum already terminal', { actumId: getTrace()?.actumId, attempt })
            return
          }
          log.info('retrying on new pod', { attempt })
          let retryPodId: string
          try {
            retryPodId = await this._provisionPod(imageName)
          } catch (provErr) {
            log.warn(`provision retry ${attempt}/${maxAttempts} failed`, { error: (provErr as Error).message })
            if (attempt === maxAttempts) throw provErr
            continue
          }
          activePodId = retryPodId
          // Second gate — the actum could have gone terminal during provisioning itself;
          // check again before submitting the job so we don't hand comfyrunner work for a
          // dead run, and terminate the pod we just spun up instead of leaking it.
          if (!(await this._actumStillLive())) {
            log.warn('retry aborted — actum already terminal', { actumId: getTrace()?.actumId, attempt })
            await this._terminatePod(retryPodId).catch(() => {})
            return
          }
          // Update DB so the retry pod is tracked; webhook will fire with retryPodId
          await params.onPodActive?.(retryPodId).catch(() => {})
          try {
            await this._runBackground(retryPodId, imageName, params.input, params.webhook, retryPodId, (accepted) => { runnerAcceptedJob = accepted }, params.onMetrics, params.provisioningContext, params.jobToken, params.r2)
            return
          } catch (runErr) {
            if (runnerAcceptedJob && !(runErr as { isThrottleError?: boolean }).isThrottleError) {
              log.warn('lost SSE after comfyrunner accepted job — not retrying; comfyrunner owns the webhook', { podId: retryPodId, error: (runErr as Error).message })
              return
            }
            if ((runErr as { permanent?: boolean }).permanent) {
              log.warn('pod run failed permanently — not retrying', { podId: retryPodId, error: (runErr as Error).message })
              throw runErr
            }
            log.warn(`pod run attempt ${attempt}/${maxAttempts} failed`, { podId: retryPodId, error: (runErr as Error).message })
            if (attempt === maxAttempts) throw runErr
          }
        }
      }
    }

    runWithRetry().catch(async (err) => {
      log.error(`Pod ${activePodId} failed`, { podId: activePodId, error: (err as Error).message })
      // Only fire Crystal-side webhook when comfyrunner never accepted the job —
      // EXCEPT when we exhausted throttle-retries: comfyrunner accepted but we
      // deliberately bailed every pod, so no webhook is coming and the client must
      // be told (and refunded) "no good pods available".
      if (params.webhook && (!runnerAcceptedJob || (err as { isThrottleError?: boolean }).isThrottleError)) {
        // Key the failure webhook by `activePodId` — retries advance the actum's
        // externusJobId (via onPodActive) to the LAST pod, so posting the FIRST pod's
        // id 404s and the run never reaches `fractus` (incident 2026-06-19).
        await this._postWebhook(params.webhook, { id: activePodId, status: 'FAILED', error: (err as Error).message })
          .catch(() => {})
      }
    })

    return { id: podId }
  }

  /**
   * `/arm` Start — provision a warm studio with NO gen (Part A real). Provisions a pod, bootstraps
   * comfyrunner to ready, then parks it warm (an idle `Materia`) — the same record `submit` builds
   * on a successful gen, minus the job. Returns pod telemetry for the bulletin journal, or null on
   * failure (the pod is terminated). Models are applied afterward via the live-install path.
   */
  async provisionStudio(
    opts: { runtime?: string; comfyRef?: string; warmMs?: number; provisioningContext?: ProvisioningContext } = {},
    onStage?: StudioStageCb,
  ): Promise<StudioProvision | null> {
    const imageName = this.config.imageName ?? 'runpod/pytorch:2.4.0-py3.11-cuda12.4.1-devel-ubuntu22.04'
    let prov: { podId: string; sshInfo: SshInfo; provisionMs: number }
    try {
      prov = await this._provisionAndBootstrap(imageName, onStage, opts.runtime, opts.comfyRef)
    } catch (err) {
      log.warn('studio provision failed', { error: (err as Error).message })
      return null
    }
    const materia = await this._parkWarm(prov.podId, prov.sshInfo, imageName, prov.provisionMs, opts.runtime, opts.warmMs, opts.provisioningContext)
    if (!materia) { await this._terminatePod(prov.podId).catch(() => {}); return null }
    return {
      podId: prov.podId,
      ...(prov.sshInfo.gpuType ? { gpuType: prov.sshInfo.gpuType } : {}),
      ...(typeof prov.sshInfo.costPerHr === 'number' ? { costPerHr: prov.sshInfo.costPerHr } : {}),
      provisionMs: prov.provisionMs,
    }
  }

  /**
   * Provision a SECURE pod and launch a DETACHED pod script — NOT submit()'s held SSE pipeline
   * (built for short gens) and NOT runner.py's VRAM scheduler. For one long single-shot job:
   * provision (SECURE for attempts 1-2, COMMUNITY/any-GPU on the last), wait SSH, run `setup`
   * (the caller's bootstrap onto the stock base), upload the pod script named by `script`,
   * nohup-launch it with `env` (+ injected RUNPOD_POD_ID = the pod id), close SSH. Fire-and-forget
   * — the pod posts its own `/runner/status` + completion webhook. `image` is a stock RunPod base
   * (SSH-ready). GPU-gated: live-verified, not CI-covered (the launcher's logic + the setup recipe
   * are tested hermetically).
   *
   * `script` selects which pod script runs. It is OPTIONAL and absent means `'trainer'`, so a
   * caller that names none launches exactly what this method has always launched.
   *
   * RESOLVES AS SOON AS THE POD ID EXISTS. Provisioning (retries included) takes seconds and
   * produces the only value the caller needs — the pod id IS the external run handle. Everything
   * after it — the SSH wait (bounded by `sshReadyTimeoutMs`) and the bootstrap (a clone plus a
   * large dependency install, bounded by the provisioning budget) — is tens of minutes of work no
   * caller has a reason to hold a request open for, so it runs as a background continuation.
   *
   * Ordering holds by construction rather than by being fast: provision → `await onPodId(podId)` →
   * resolve → background SSH/bootstrap. `onPodId` is where the caller records the handle (and any
   * per-job callback credential) against the run; it is awaited BEFORE the continuation is
   * scheduled, so nothing pod-side can call back before the run can answer for it.
   *
   * `onLaunchFailed` is the background failure sink. Once this method has resolved there is no
   * caller left to throw to, so a failure in the SSH/bootstrap phase terminates the pod (this is
   * now the only thing that does) and reports through the sink; without it the run would stay in
   * progress until its deadline expired, waiting out an outcome already known.
   */
  async launchTrainingPod(opts: {
    image: string
    env: Record<string, string>
    setup: string[]
    /** Pod script to upload and launch — default `'trainer'`. */
    script?: DetachedPodScript
    /**
     * Awaited after provisioning and BEFORE any pod-side work is started. Called AGAIN with the
     * new pod id whenever a machine that never became SSH-reachable is replaced by a fresh one,
     * so the recorded handle always names the pod the launch is actually on.
     */
    onPodId?: (podId: string) => Promise<void>
    /** Called when the background SSH/bootstrap phase fails, after the pod has been terminated. */
    onLaunchFailed?: (err: unknown) => Promise<void>
    /**
     * Phase reports for the BACKGROUND half of the launch — the pod lock, the bootstrap, the
     * detached start. That half runs after the caller has been answered, outside its trace, so a
     * caller that wants those minutes on a run's timeline hands this in and routes them itself.
     * Absent, the background phase reports nowhere, exactly as before.
     */
    onPhase?: (progressus: Omit<Progressus, 'at'>) => void
  }): Promise<{ podId: string }> {
    const maxAttempts = this.config.podRetries ?? 3
    let podId: string | undefined
    let lastErr: Error | undefined
    // How many attempts acquiring the FIRST machine cost. An attempt covers acquiring a pod and
    // reaching SSH-readiness on it, and the second half runs in the background continuation — so
    // the count is carried across rather than restarted there.
    let attemptsSpent = 0
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      attemptsSpent = attempt
      const isFallback = attempt >= maxAttempts
      try {
        podId = await this._provisionPod(opts.image, isFallback ? 'COMMUNITY' : undefined, isFallback ? null : undefined)
        break
      } catch (err) {
        lastErr = err as Error
        log.warn(`training pod provision attempt ${attempt}/${maxAttempts} failed`, { error: lastErr.message })
      }
    }
    if (!podId) throw lastErr ?? new Error('training pod provision failed')

    // The provisioning phase clock starts HERE, before the SSH wait, and is carried into the
    // background continuation — the bootstrap deadline is the remainder of PROVISION_BUDGET_MS
    // after that wait has taken its share. Restarting it when the continuation is scheduled would
    // widen the phase past the budget the run's own deadline is derived from.
    const provisionDeadline = Date.now() + PROVISION_BUDGET_MS

    // Record the handle before anything pod-side exists that could use it.
    await opts.onPodId?.(podId)

    // Deliberately unawaited, and therefore given its own terminal `.catch`: a background
    // rejection must never escape as an unhandled rejection.
    void this._finishTrainingPodLaunch(podId, opts, provisionDeadline, attemptsSpent)
      .catch(err => log.error('training pod launch continuation failed', { podId, error: String(err) }))

    return { podId }
  }

  /**
   * The background half of `launchTrainingPod`: acquire an SSH-reachable machine (re-provisioning
   * when one never becomes reachable), bootstrap it, launch detached, close.
   *
   * On failure there is no caller left to rethrow to, so this closes SSH, terminates the pod it was
   * holding (nothing else will — this is the only exit for a pod whose job never started) and hands
   * the real error to `onLaunchFailed`. The wiring points that sink at the same failure path the
   * deadline reaper uses, which re-reads the run and no-ops on one already finished; that is why
   * a second guard against a reaper race is deliberately not added here.
   */
  private async _finishTrainingPodLaunch(
    firstPodId: string,
    opts: {
      image: string
      env: Record<string, string>
      setup: string[]
      script?: DetachedPodScript
      onPodId?: (podId: string) => Promise<void>
      onLaunchFailed?: (err: unknown) => Promise<void>
      onPhase?: (progressus: Omit<Progressus, 'at'>) => void
    },
    provisionDeadline: number,
    attemptsSpent: number,
  ): Promise<void> {
    let ssh: SshTransportLike | null = null
    // The pod this launch is holding. It stays undefined while acquisition is in progress, because
    // every machine acquisition abandons is terminated there and then — so a failure to acquire has
    // nothing left to clean up here, and terminating `firstPodId` again would be a second call on a
    // pod that is already gone.
    let holdingPodId: string | undefined
    try {
      const acquired = await this._acquireSshReadyTrainingPod(firstPodId, opts, attemptsSpent)
      holdingPodId = acquired.podId
      const { podId, sshInfo } = acquired
      const arm = opts.script ?? 'trainer'
      log.info('pod locked', { podId, arm, gpuType: sshInfo.gpuType, costPerHr: sshInfo.costPerHr })
      opts.onPhase?.(coldStartProgressus('pod-locked', {
        podId, gpuType: sshInfo.gpuType, costPerHr: sshInfo.costPerHr,
      }) ?? { phase: 'provisioning' })
      ssh = await this._waitForSshd(sshInfo)
      const pod = resolveDetachedPodScript(opts.script)
      await this._bootstrapDetached(ssh, podId, pod.path, pod.name, arm,
        { ...opts.env, RUNPOD_POD_ID: podId }, opts.setup, provisionDeadline, opts.onPhase)
      await ssh.close()
      ssh = null
    } catch (err) {
      await ssh?.close().catch(() => {})
      if (holdingPodId) await this._terminatePod(holdingPodId).catch(() => {})
      log.warn('training pod launch failed after provisioning',
        { podId: holdingPodId ?? firstPodId, error: (err as Error).message })
      await opts.onLaunchFailed?.(err)
    }
  }

  /**
   * Acquire a machine this launch can actually reach: wait for SSH on the pod already provisioned,
   * and when that pod never becomes reachable — an ip-less host abandoned at its window, or the
   * overall SSH deadline — abandon it and spend a remaining attempt on a FRESH pod, under the same
   * cloud-type ladder as the first (SECURE until the last attempt, then COMMUNITY/any GPU). This
   * is the loop the gen and studio paths already run; the detached launch reaches it here.
   *
   * Two things this owes the rest of the system:
   *  - **The recorded handle follows the machine.** `onPodId` is called again with each fresh pod
   *    id, so the reaper, the status posts and the completion webhook all name the pod that is
   *    running rather than one that was abandoned. It is awaited before any pod-side work starts
   *    on the new machine, exactly as it is for the first.
   *  - **Every abandoned pod is terminated as it is abandoned**, and named in the failure this
   *    throws when the attempts run out. That terminal error says the attempts were exhausted; a
   *    single attempt's bailout — which speaks of retrying on a fresh pod — is never what a run
   *    ends on.
   *
   * The liveness gate runs before each re-provision: a run that has already gone terminal stops
   * costing machines.
   */
  private async _acquireSshReadyTrainingPod(
    firstPodId: string,
    opts: { image: string; onPodId?: (podId: string) => Promise<void> },
    attemptsSpent: number,
  ): Promise<{ podId: string; sshInfo: SshInfo }> {
    const maxAttempts = this.config.podRetries ?? 3
    const abandoned: Array<{ podId: string; reason: string }> = []
    let podId: string | undefined = firstPodId
    let lastErr: Error | undefined

    for (let attempt = Math.max(attemptsSpent, 1); attempt <= maxAttempts; attempt++) {
      if (podId === undefined) {
        if (!(await this._actumStillLive())) {
          log.warn('training pod re-provision aborted — actum already terminal',
            { actumId: getTrace()?.actumId, attempt })
          throw new Error(
            `Training pod launch aborted before attempt ${attempt}/${maxAttempts} — the run is ` +
            `already terminal; abandoned ${describeAbandonedPods(abandoned)}`,
          )
        }
        const isFallback = attempt >= maxAttempts
        try {
          podId = await this._provisionPod(opts.image, isFallback ? 'COMMUNITY' : undefined, isFallback ? null : undefined)
        } catch (err) {
          lastErr = err as Error
          log.warn(`training pod provision attempt ${attempt}/${maxAttempts} failed`, { error: lastErr.message })
          continue
        }
        // The handle names the machine the run is on — updated before anything pod-side starts.
        // A stamp that fails leaves a pod nothing is tracking, so it is terminated here rather
        // than left to the caller, which has long since been answered.
        try {
          await opts.onPodId?.(podId)
        } catch (stampErr) {
          await this._terminatePod(podId).catch(() => {})
          throw stampErr
        }
      }
      try {
        return { podId, sshInfo: await this._waitForSsh(podId) }
      } catch (err) {
        lastErr = err as Error
        const reason = isIplessHostError(lastErr) ? 'ip-less host' : 'ssh not ready within deadline'
        abandoned.push({ podId, reason })
        log.warn(`training pod ${podId} never became SSH-ready (attempt ${attempt}/${maxAttempts})`,
          { podId, reason, error: lastErr.message, iplessHost: isIplessHostError(lastErr) })
        await this._terminatePod(podId).catch(() => {})   // don't leak the abandoned pod
        podId = undefined
      }
    }

    if (abandoned.length === 0) throw lastErr ?? new Error('training pod provision failed')
    throw new Error(
      `Training pod launch exhausted ${maxAttempts} attempts without reaching an SSH-reachable ` +
      `host — abandoned ${describeAbandonedPods(abandoned)}`,
    )
  }

  /**
   * Run the `setup` bootstrap commands over SSH (clone ai-toolkit + pip install its deps onto the
   * stock base), then upload a pod script and launch it DETACHED with `env` (nohup) — the pod owns
   * its own status + completion webhook from here. Env values are shell-quoted (base64 blobs + URLs).
   *
   * The whole setup phase runs against `deadline` — the caller's PROVISION_BUDGET_MS clock, already
   * debited by the SSH wait. Each command keeps a generous individual ceiling, because the
   * dependency install is legitimately slow, but is additionally capped at the time left in the
   * phase, so a sequence of individually-permissible commands cannot outlast the budget the actum's
   * deadline is derived from. On expiry this throws naming the command that was next and the budget
   * it ran out of, so the failure reads as "provisioning ran out of budget here" instead of
   * surfacing later as a run that never reported back.
   */
  private async _bootstrapDetached(
    ssh: SshTransportLike, podId: string, scriptPath: string, scriptName: string, arm: DetachedPodScript,
    env: Record<string, string>, setup: string[] = [], deadline?: number,
    onPhase?: (progressus: Omit<Progressus, 'at'>) => void,
  ): Promise<void> {
    log.info('bootstrapping pod', { podId, arm, script: scriptName, setupSteps: setup.length })
    // The pod exists and is being built — a distinct, minutes-long phase from acquiring it.
    onPhase?.({ phase: 'installing', message: 'preparing the pod' })
    const timeLeft = (): number => (deadline === undefined ? BOOTSTRAP_CMD_TIMEOUT_MS : deadline - Date.now())
    for (const cmd of setup) {
      const left = timeLeft()
      if (left <= 0) {
        throw new Error(
          `Pod ${podId} provisioning budget of ${PROVISION_BUDGET_MS}ms exhausted — ` +
          `bootstrap stopped before command: ${cmd}`,
        )
      }
      await ssh.exec(cmd, { timeout: Math.min(BOOTSTRAP_CMD_TIMEOUT_MS, left) })
    }
    const script = fs.readFileSync(scriptPath, 'utf8')
    const b64 = Buffer.from(script).toString('base64').replace(/\n/g, '')
    await ssh.exec(`echo '${b64}' | base64 -d > /root/${scriptName}`, { timeout: 10_000 })
    const envStr = Object.entries(env).map(([k, v]) => `${k}=${shellQuote(v)}`).join(' ')
    await ssh.exec(`${envStr} nohup python3 /root/${scriptName} >> /tmp/${scriptName}.log 2>&1 &`, { timeout: 10_000 })
    log.info('pod launched', { podId, arm })
    // Handover: the pod owns the run from here and reports its own phases on /runner/status.
    onPhase?.({ phase: 'loading', message: 'starting the job on the pod' })
  }

  // ── private ──────────────────────────────────────────────────────────────

  /**
   * Provision a pod and bring comfyrunner to ready WITHOUT submitting a job — the front half of the
   * gen path (provision-with-retries → SSH → bootstrap → /health ready). Emits the same stages.
   * Terminates the pod and rethrows on any failure so no pod leaks. (`submit` keeps its own inline
   * version because it interleaves job retry/throttle logic; this is the provision-only path.)
   */
  private async _provisionAndBootstrap(
    imageName: string,
    onStage?: StudioStageCb,
    runtime?: string,
    comfyRef?: string,
  ): Promise<{ podId: string; sshInfo: SshInfo; provisionMs: number }> {
    const startMs = Date.now()
    const signal = (stage: string, info?: import('../lib/bus.js').StageInfo) => {
      const ctx = getTrace()
      if (ctx?.actumId) {
        // Record the cold-start phase onto the owned Progressus timeline (#6a). Maps only the
        // pod-lifecycle stages; comfyrunner's own stages return undefined (it records those).
        // Fire-and-forget but .catch — a recorder DB error must never break the run (§4).
        const prog = coldStartProgressus(stage, info)
        if (prog) recordProgressus(ctx.actumId, { ...prog, at: new Date() }).catch(err => log.warn('progressus record failed', { error: (err as Error).message }))
      }
      onStage?.(stage, info)   // direct callback for the /arm bulletin (no actumId/trace in that path)
    }

    // Provision with retries — SECURE for attempts 1-2, COMMUNITY/any-GPU on the last (mirrors submit).
    // An attempt covers acquiring the pod AND reaching SSH-readiness on it: a machine that never
    // becomes reachable is a spent attempt like a provision that never returned a pod, and the next
    // attempt starts from a fresh pod under the same cloud-type rules.
    const maxAttempts = this.config.podRetries ?? 3
    let podId: string | undefined
    let sshInfo: SshInfo | undefined
    let lastErr: Error | undefined
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const isFallback = attempt >= maxAttempts
      // Liveness gate before spending a pod on a later attempt — the same guard the gen path's
      // retry loop uses, so a run that has already gone terminal stops costing machines.
      if (attempt > 1 && !(await this._actumStillLive())) {
        log.warn('studio provision aborted — actum already terminal', { actumId: getTrace()?.actumId, attempt })
        throw lastErr ?? new Error('pod provision aborted — actum already terminal')
      }
      let attemptPodId: string
      try {
        attemptPodId = await this._provisionPod(imageName, isFallback ? 'COMMUNITY' : undefined, isFallback ? null : undefined)
      } catch (err) {
        lastErr = err as Error
        log.warn(`studio provision attempt ${attempt}/${maxAttempts} failed`, { error: lastErr.message })
        continue
      }
      signal('provisioning')
      try {
        sshInfo = await this._waitForSsh(attemptPodId)
        podId = attemptPodId
        break
      } catch (err) {
        lastErr = err as Error
        log.warn(`studio pod ${attemptPodId} never became SSH-ready (attempt ${attempt}/${maxAttempts})`,
          { error: lastErr.message, iplessHost: isIplessHostError(lastErr) })
        await this._terminatePod(attemptPodId).catch(() => {})   // don't leak the abandoned pod
      }
    }
    if (!podId || !sshInfo) throw lastErr ?? new Error('pod provision failed')

    let ssh: SshTransportLike | null = null
    try {
      signal('pod-locked', { gpuType: sshInfo.gpuType, region: sshInfo.region, costPerHr: sshInfo.costPerHr, podId })
      ssh = await this._waitForSshd(sshInfo)
      signal('bootstrapping')
      await this._bootstrap(ssh, podId, runtime, comfyRef)
      await ssh.close()
      ssh = null
      await this._waitForRunner(SecurePodClient.runnerBase(podId))
      signal('comfy-ready')
      return { podId, sshInfo, provisionMs: Date.now() - startMs }
    } catch (err) {
      await ssh?.close().catch(() => {})
      await this._terminatePod(podId).catch(() => {})   // don't leak a half-provisioned pod
      throw err
    }
  }

  private async _postWebhook(url: string, body: unknown): Promise<void> {
    const retries = this.config.webhookRetries ?? 3
    const baseDelayMs = this.config.webhookRetryDelayMs ?? 1000
    let lastError: unknown
    for (let attempt = 0; attempt <= retries; attempt++) {
      if (attempt > 0) await sleep(baseDelayMs * (2 ** (attempt - 1)))
      try {
        const res = await this.fetchFn(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        })
        if (res.ok) return
        const errBody = await res.text().catch(() => '')
        log.warn('webhook POST failed', { attempt, status: res.status, body: errBody })
        lastError = new Error(`webhook POST returned ${res.status}`)
      } catch (err) {
        lastError = err
      }
    }
    throw lastError
  }

  private async _fetchWithTimeout(url: string, init: RequestInit, ms: number): Promise<Response> {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), ms)
    try {
      return await this.fetchFn(url, { ...init, signal: controller.signal })
    } finally {
      clearTimeout(timer)
    }
  }

  // gpuTypeIds=null → omit from request (let RunPod pick any available GPU)
  private async _provisionPod(imageName: string, cloudType?: string, gpuTypeIds?: string[] | null): Promise<string> {
    const resolvedGpus = gpuTypeIds !== undefined ? gpuTypeIds : (this.config.gpuTypeIds ?? DEFAULT_GPU_TYPE_IDS)
    const body: Record<string, unknown> = {
      name: `noema-${Date.now()}`,
      imageName,
      gpuCount: 1,
      cloudType: cloudType ?? this.config.cloudType ?? 'SECURE',
      containerDiskInGb: this.config.containerDiskGb ?? 40,
      ports: ['22/tcp', '8188/http', '8080/http'],
      supportPublicIp: true,
    }
    if (resolvedGpus !== null) body.gpuTypeIds = resolvedGpus
    const res = await this._fetchWithTimeout('https://rest.runpod.io/v1/pods', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.config.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    }, this.config.provisionTimeoutMs ?? 30_000)

    if (!res.ok) {
      const text = await res.text().catch(() => '')
      throw new Error(`RunPod pod provision failed: ${res.status} ${text}`)
    }

    const data = await res.json() as { id: string }
    return data.id
  }

  /**
   * Poll RunPod until the pod is SSH-reachable, or until it is clear this pod will not become
   * so. Two ways to give up, each naming itself: the overall `sshReadyTimeoutMs` deadline, and
   * the ip-less bailout — a pod that has been `RUNNING` without a public IP for
   * `sshIplessBailoutMs` is abandoned there and then, so the caller's remaining attempts are
   * spent on a fresh pod instead of on this one's clock.
   */
  private async _waitForSsh(podId: string): Promise<SshInfo> {
    const timeoutMs = this.config.sshReadyTimeoutMs ?? 10 * 60 * 1000
    const pollMs = this.config.sshPollIntervalMs ?? 8000
    const iplessBailoutMs = this.config.sshIplessBailoutMs ?? SSH_IPLESS_BAILOUT_MS
    const startedAt = Date.now()
    const deadline = startedAt + timeoutMs
    let pollCount = 0
    // Last-seen observation carried out of the loop so a give-up can name what it saw,
    // instead of discarding everything the polling learned.
    let lastObservation: SshPollObservation | undefined
    let lastError: string | undefined
    // When the pod first reported RUNNING with no public IP. Cleared whenever an IP appears or
    // the pod is not RUNNING, so the window measures an uninterrupted ip-less RUNNING stretch.
    let iplessSince: number | undefined
    /** One line per abandoned pod — what was seen, for how long, and why we stopped. */
    const abandon = (reason: string): void => {
      log.warn('abandoning pod', {
        podId, reason, polls: pollCount, elapsedMs: Date.now() - startedAt,
        desiredStatus: lastObservation?.desiredStatus, publicIp: lastObservation?.publicIp,
        port22: lastObservation?.port22,
      })
    }
    while (Date.now() < deadline) {
      pollCount++
      const result = await this._getSshInfo(podId)
      if (result.info) {
        const sshCtx = getTrace()
        log.info('pod SSH ready', {
          podId,
          elapsedMs: Date.now() - (sshCtx?.startTs ?? Date.now()),
        })
        // After SSH becomes ready — record elapsed and cursorType
        if (sshCtx) {
          sshCtx.sshReadyMs = Date.now() - sshCtx.startTs
          sshCtx.wideFields.cursorType = 'runpod:secure'
        }
        return result.info
      }
      if (result.observation) {
        lastObservation = result.observation
        lastError = undefined
        // The ip-less window only runs while the pod is RUNNING and reporting no public IP.
        if (result.observation.desiredStatus === 'RUNNING' && !result.observation.publicIp) {
          iplessSince ??= Date.now()
          const iplessMs = Date.now() - iplessSince
          if (iplessMs >= iplessBailoutMs) {
            abandon('ip-less host')
            const err = new Error(
              `Pod ${podId} abandoned after ${iplessMs}ms as an ip-less host — ` +
              `RUNNING with no publicIp across ${pollCount} polls ` +
              `(port22=${result.observation.port22 ?? '<absent>'}); ` +
              `may be UNPLACED (no SKU stock to satisfy the pin) rather than a host defect; ` +
              `retrying on a fresh pod rather than waiting out the ${timeoutMs}ms SSH deadline`,
            ) as IplessHostError
            err.iplessHost = true
            throw err
          }
        } else {
          iplessSince = undefined
        }
      } else {
        lastError = result.error
      }
      await sleep(pollMs)
    }
    abandon('ssh not ready within deadline')
    if (lastObservation) {
      throw new Error(
        `Pod ${podId} SSH not ready within ${timeoutMs}ms — last seen after ${pollCount} polls:\n` +
        `desiredStatus=${lastObservation.desiredStatus ?? '<absent>'} ` +
        `publicIp=${lastObservation.publicIp ?? '<absent>'} ` +
        `port22=${lastObservation.port22 ?? '<absent>'}`,
      )
    }
    throw new Error(
      `Pod ${podId} SSH not ready within ${timeoutMs}ms — no successful status read in ${pollCount} polls ` +
      `(last error: ${lastError ?? 'none'})`,
    )
  }

  private async _getSshInfo(podId: string): Promise<SshPollResult> {
    let res: Response
    try {
      res = await this._fetchWithTimeout(`https://rest.runpod.io/v1/pods/${podId}`, {
        headers: { 'Authorization': `Bearer ${this.config.apiKey}` },
      }, this.config.sshInfoTimeoutMs ?? 10_000)
    } catch (err) {
      // Timeout or network error on a single poll — treat as not-ready.
      // _waitForSsh deadline governs the overall give-up point.
      return { info: null, error: err instanceof Error ? err.message : String(err) }
    }
    if (!res.ok) return { info: null, error: `HTTP ${res.status}` }

    const data = await res.json() as RunPodPodStatus
    log.debug('pod status poll', {
      podId,
      desiredStatus: data.desiredStatus,
      publicIp: data.publicIp,
      portMappings: data.portMappings,
    })
    // An observation is a status read that succeeded, whether or not the pod is ready yet —
    // this is what a give-up message names, kept distinct from never getting a read at all.
    const observation: SshPollObservation = {
      desiredStatus: data.desiredStatus,
      publicIp: data.publicIp,
      port22: data.portMappings?.['22'],
    }
    if (data.desiredStatus !== 'RUNNING') return { info: null, observation }
    if (!data.publicIp) return { info: null, observation }

    const sshPort = data.portMappings?.['22']
    if (!sshPort) return { info: null, observation }

    const gpuType = data.machine?.gpuDisplayName ?? data.gpuTypeIds?.[0]
    const region  = data.machine?.dataCenterId ?? data.machine?.location
    return { info: { host: data.publicIp, port: sshPort, user: 'root', costPerHr: data.costPerHr, gpuType, region } }
  }

  private async _terminatePod(podId: string): Promise<void> {
    await this.terminatePodFn(this.config.apiKey, podId)
  }

  // externusJobId: the job ID stored on the actum (always the first pod's ID, even on retries)
  // onRunnerAccepted: called with true once comfyrunner has accepted the job (owns the webhook from that point)
  private async _runBackground(
    podId: string,
    imageName: string,
    input: unknown,
    webhook: string | undefined,
    externusJobId?: string,
    onRunnerAccepted?: (accepted: boolean) => void,
    onMetrics?: (executio: ActumExecutio) => Promise<void>,
    provisioningContext?: ProvisioningContext,
    jobToken?: string,
    /** Per-run object-store override — see submit(). Replaces `this.config.r2` for this job. */
    r2Override?: R2Config,
  ): Promise<void> {
    const startMs = Date.now()
    let ssh: SshTransportLike | null = null
    let sshInfo: SshInfo | null = null
    const signal = (stage: string, info?: import('../lib/bus.js').StageInfo) => {
      const ctx = getTrace()
      if (ctx?.actumId) {
        const prog = coldStartProgressus(stage, info)   // cold-start phases onto the owned timeline (#6a)
        if (prog) recordProgressus(ctx.actumId, { ...prog, at: new Date() }).catch(err => log.warn('progressus record failed', { error: (err as Error).message }))
      }
    }
    // Pod telemetry accumulated as the job runs and persisted onto the actum
    // (via onMetrics) before completion — the completion webhook can't see this
    // in-flight state otherwise. Each report sends the full accumulated object.
    const executio: ActumExecutio = { podId, coldStart: true }
    const reportMetrics = () => { void onMetrics?.({ ...executio }) }
    let jobSucceeded = false

    try {
      signal('provisioning')
      sshInfo = await this._waitForSsh(podId)
      executio.provisionMs = Date.now() - startMs
      executio.costPerHr = sshInfo.costPerHr
      executio.gpuType = sshInfo.gpuType
      // Pod acquired — surface GPU/region/price to the user the moment we lock on.
      log.info('pod locked', { podId, gpuType: sshInfo.gpuType, region: sshInfo.region, costPerHr: sshInfo.costPerHr })
      signal('pod-locked', { gpuType: sshInfo.gpuType, region: sshInfo.region, costPerHr: sshInfo.costPerHr, podId })
      ssh = await this._waitForSshd(sshInfo)
      executio.sshReadyMs = Date.now() - startMs
      reportMetrics()  // persist provision/ssh/podId/costPerHr — survives even if download fails
      signal('bootstrapping')
      // `comfyRef` isn't on CompiledSpecLike yet (Compiler-side follow-up); read it defensively so a
      // future compiled spec that does carry it is honored without another SecurePodClient change.
      const specComfyRef = isCompiledSpec(input) ? (input as { comfyRef?: string }).comfyRef : undefined
      await this._bootstrap(ssh, podId, isCompiledSpec(input) ? input.runtime : undefined, specComfyRef)

      // SSH only needed for bootstrap — close before HTTP phase
      await ssh.close()
      ssh = null

      const runnerBase = SecurePodClient.runnerBase(podId)
      await this._waitForRunner(runnerBase)
      signal('comfy-ready')

      const jobId = externusJobId ?? podId
      await submitToRunner(this.fetchFn, runnerBase, jobId, input, webhook, r2Override ?? this.config.r2, jobToken)
      onRunnerAccepted?.(true)  // comfyrunner now owns the failure webhook

      const submitCtx = getTrace()
      if (submitCtx) submitCtx.jobSubmitMs = Date.now() - submitCtx.startTs

      // comfyrunner fires the webhook; we subscribe to SSE only to know when done
      // (so we can terminate/warm the pod). comfyrunner records its own Progressus timeline
      // through the in-process recorder seam — no stage callback needed (#6e).
      await awaitViaStream(
        this.fetchFn, runnerBase, jobId, this.config.jobTimeoutMs ?? 45 * 60 * 1000,
        (m) => { Object.assign(executio, m); reportMetrics() },
      )
      jobSucceeded = true
    } finally {
      await ssh?.close().catch(() => {})
      if (jobSucceeded && this.config.keepWarm && this.materiae && sshInfo) {
        // Boot wall-clock — the cost we now ask future guests to amortize.
        const runtime = isCompiledSpec(input) ? input.runtime : undefined
        await this._parkWarm(podId, sshInfo, imageName, Date.now() - startMs, runtime, undefined, provisioningContext)
      } else {
        await this._terminatePod(podId)
      }
    }
  }

  /**
   * Create the warm `Materia` for a ready pod (status idle, warm window, boot-cost), pair a
   * `Hospitium` when the host is known, and emit `pod.parked`. Shared by the gen path (where
   * `bootMs` is the actual cold-start wall-clock) and the provision-only `/arm` Start path (where
   * it's the provision+bootstrap elapsed — an estimate, reconciled later). `runtime` records which
   * on-pod runtime the studio serves. Returns the Materia (or undefined on create failure).
   */
  private async _parkWarm(
    podId: string,
    sshInfo: SshInfo,
    imageName: string,
    bootMs: number,
    runtime?: string,
    warmMs?: number,
    provisioningContext?: ProvisioningContext,
  ): Promise<Materia | undefined> {
    if (!this.materiae) return undefined
    const bootCostImpetus = computeBootCostImpetus(bootMs, sshInfo.costPerHr ?? 0)
    // `costPerHr` (the pod's real hourly cost) is the source of truth for warm-time
    // billing — Census charges it per-window. `impetusPerSecond` stays a coarse
    // display/legacy-fallback figure (config override still wins, else the coarse
    // conversion, else 0 when the rate is unknown).
    const impetusPerSecond = this.config.impetusPerSecond
      ?? (sshInfo.costPerHr ? impetusPerSecondFromHourly(sshInfo.costPerHr) : 0n)
    const materia = await this.materiae.create({
      genus: 'runpod',
      externusId: podId,
      gpu: sshInfo.gpuType ?? (this.config.gpuTypeIds ?? DEFAULT_GPU_TYPE_IDS)[0] ?? '',
      vramGb: 0,
      ramGb: 0,
      imageRef: imageName,
      sshHost: sshInfo.host,
      sshPort: sshInfo.port,
      impetusPerSecond,
      ...(typeof sshInfo.costPerHr === 'number' ? { costPerHr: sshInfo.costPerHr } : {}),
      status: 'idle',
      warmUntil: new Date(Date.now() + (warmMs ?? this.config.warmTtlMs ?? 60_000)),
      bootCostImpetus,
      ...(runtime ? { runtime } : {}),
      ...(provisioningContext?.groupChatId ? { groupChatId: provisioningContext.groupChatId } : {}),
    }).catch(() => undefined)
    // Pair the Materia with a Hospitium when we know the host — identified (animaId) or
    // anonymous-arcanum (commitment). Either way, identity sits off-pod (see types/hospitium.ts).
    if (materia && this.hospitia && provisioningContext?.hostKey) {
      await this.hospitia.create({
        materiaId: materia.id,
        hostKey: provisioningContext.hostKey,
        inceptum: new Date(),
      }).catch(() => undefined)
    }
    // Late-binding hosting metadata (e.g. group admin resolution) hangs off pod.parked so the
    // crystal core stays platform-neutral; carry the source platform for adapter scoping.
    if (materia) {
      const platform = getTrace()?.platform
      bus.emit('pod.parked', {
        materiaId: materia.id,
        ...(provisioningContext?.groupChatId ? { groupChatId: provisioningContext.groupChatId } : {}),
        ...(platform ? { platform } : {}),
      })
    }
    return materia
  }

  // Port appearing in RunPod API does not mean sshd is accepting connections yet.
  // Probe with `true` until the daemon is ready or we hit the deadline.
  private async _waitForSshd(info: SshInfo): Promise<SshTransportLike> {
    const deadlineMs = Date.now() + 3 * 60_000
    while (true) {
      const ssh = this.sshFactory(info)
      try {
        await ssh.exec('true', { timeout: 8_000 })
        return ssh
      } catch (err) {
        await ssh.close().catch(() => {})
        if (Date.now() >= deadlineMs) throw new Error('sshd did not become ready within 3 min')
        log.debug('sshd not ready, retrying in 5s')
        await new Promise(r => setTimeout(r, 5_000))
      }
    }
  }

  /** Returns the comfyrunner HTTP base URL for a given pod ID. */
  static runnerBase(podId: string): string {
    return `https://${podId}-8080.proxy.runpod.net`
  }

  /** Poll comfyrunner /health until it reports 'ready' or 'busy'. */
  private async _waitForRunner(runnerBase: string): Promise<void> {
    const timeoutMs = this.config.comfyReadyTimeoutMs ?? 5 * 60 * 1000
    const pollMs    = this.config.comfyPollIntervalMs ?? 2000
    const deadline  = Date.now() + timeoutMs
    while (Date.now() < deadline) {
      try {
        const res = await this.fetchFn(`${runnerBase}/health`, { signal: AbortSignal.timeout(5000) })
        if (res.ok) {
          const body = await res.json() as { status?: string }
          if (body.status === 'ready' || body.status === 'busy') return
        }
      } catch (_) {
        // not ready yet
      }
      await sleep(pollMs)
    }
    throw new Error('comfyrunner did not become ready within timeout')
  }

  /** Bootstrap dispatches on the pod's runtime (ADR-0007). ComfyUI keeps the proven comfyrunner.py
   *  path byte-for-byte; vLLM/llm pods get the multi-runtime runner.py. */
  private async _bootstrap(ssh: SshTransportLike, podId: string, runtime?: string, comfyRef?: string): Promise<void> {
    if (runtime === 'vLLM' || runtime === 'llm') {
      return this._bootstrapRunner(ssh, podId, 'vLLM', 'vllm huggingface_hub boto3')
    }
    if (runtime === 'sglang' || runtime === 'transformers') {
      // SGLang serves custom-arch models (MOSS) vLLM can't. sglang[all] pulls a CUDA-13 torch whose
      // bundled libs (nvidia/cu13/lib) aren't on the linker path, and sgl_kernel needs libnuma.so.1
      // — without both, sglang crashes at startup on the CUDA-12.4 base. Fix: apt install libnuma1
      // here; the runner prepends nvidia/cu13/lib to LD_LIBRARY_PATH at launch (SGLangExecutor.
      // _serve_env). Verified-live-local 2026-06-12.
      return this._bootstrapRunner(ssh, podId, 'sglang', '"sglang[all]" huggingface_hub boto3',
        ['apt-get update -qq && apt-get install -y -qq libnuma1'])
    }
    if (runtime === 'python-modelcard') {
      // The modelcard repo brings its own deps (the runner `pip install -e .`s it at load); the pod
      // just needs the download + R2 tooling. git is ensured inside _bootstrapRunner.
      return this._bootstrapRunner(ssh, podId, 'python-modelcard', 'huggingface_hub boto3')
    }
    return this._bootstrapComfyUI(ssh, podId, comfyRef)
  }

  private async _bootstrapComfyUI(ssh: SshTransportLike, podId: string, comfyRef?: string): Promise<void> {
    const ref = comfyRef ?? DEFAULT_COMFYUI_REF
    log.info('bootstrapping pod', { podId, runtime: 'ComfyUI', comfyRef: ref })

    // Install deps, clone a PINNED ComfyUI ref — never HEAD (2026-07-10 P0: unpinned HEAD drifted
    // torch-incompatible and broke every ComfyUI pod). `--branch` works for both tags and branches.
    await ssh.exec('which git || (apt-get update -qq && apt-get install -y -qq git)', { timeout: 120_000 })
    await ssh.exec(`cd /root && rm -rf ComfyUI && git clone --depth 1 --branch ${shellQuote(ref)} https://github.com/comfyanonymous/ComfyUI.git`, { timeout: 120_000 })
    await ssh.exec('cd /root/ComfyUI && pip install -r requirements.txt websocket-client boto3 -q', { timeout: 600_000 })

    // Upload comfyrunner.py and start it — comfyrunner owns ComfyUI startup internally
    const script = fs.readFileSync(COMFYRUNNER_SCRIPT_PATH, 'utf8')
    const b64 = Buffer.from(script).toString('base64').replace(/\n/g, '')
    await ssh.exec(`echo '${b64}' | base64 -d > /root/comfyrunner.py`, { timeout: 10_000 })
    await ssh.exec(
      `RUNPOD_POD_ID=${podId} COMFYUI_DIR=/root/ComfyUI nohup python3 /root/comfyrunner.py >> /tmp/comfyrunner.log 2>&1 &`,
      { timeout: 5_000 },
    )
    log.info('comfyrunner started', { podId })
  }

  /**
   * Serving-runtime bootstrap (ADR-0007): pip-install the given serving stack + upload runner.py —
   * the multi-harness manager. The runner holds an `Executor` per runtime and lazily loads each
   * (download repo → launch server → wait) on first job, bounded by a VRAM budget. We install only
   * the one stack this pod needs (`pipPkgs`), so in practice the pod runs that one harness; a job
   * for another runtime would fail to load (its lib absent). True co-residency (multiple stacks on
   * one pod) is a later provisioning mode.
   *
   * NOTE: serving flags/versions are tuned live on a real pod (vLLM is verified; SGLang/MOSS is
   * wired but the exact sglang version + audio request format need a live pass).
   */
  private async _bootstrapRunner(ssh: SshTransportLike, podId: string, runtime: string, pipPkgs: string, postInstall: string[] = []): Promise<void> {
    log.info('bootstrapping pod', { podId, runtime })

    await ssh.exec('which git || (apt-get update -qq && apt-get install -y -qq git)', { timeout: 120_000 })
    await ssh.exec(`pip install ${pipPkgs} -q`, { timeout: 1_200_000 })
    for (const cmd of postInstall) {
      await ssh.exec(cmd, { timeout: 120_000 })
    }

    const script = fs.readFileSync(RUNNER_SCRIPT_PATH, 'utf8')
    const b64 = Buffer.from(script).toString('base64').replace(/\n/g, '')
    await ssh.exec(`echo '${b64}' | base64 -d > /root/runner.py`, { timeout: 10_000 })
    await ssh.exec(
      `RUNPOD_POD_ID=${podId} MODEL_ROOT=/root/models nohup python3 /root/runner.py >> /tmp/runner.log 2>&1 &`,
      { timeout: 5_000 },
    )
    log.info('runner started', { podId, runtime })
  }
}

// ---------------------------------------------------------------------------
// Default SSH factory — uses the system ssh binary via the crystal SshTransport.
// ---------------------------------------------------------------------------

export function makeSecurePodSshFactory(sshKeyPath: string): (info: SshInfo) => SshTransportLike {
  const sshLog = makeLogger('ssh:transport')
  return (info: SshInfo) =>
    new SshTransport({ host: info.host, port: info.port, username: info.user, privateKeyPath: sshKeyPath, logger: sshLog })
}
