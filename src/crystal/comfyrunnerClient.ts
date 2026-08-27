import { makeLogger } from '../lib/logger.js'
import { getTrace } from '../lib/trace.js'
import { recordProgressus } from '../execution/progressusSink.js'
import type { Progressus } from '../types/progressus.js'
import type { ModelRef } from '../types/actum.js'

export interface R2Config {
  /** Full R2 endpoint URL: https://<accountId>.r2.cloudflarestorage.com */
  endpoint: string
  accessKeyId: string
  secretAccessKey: string
  bucket: string
  /** Public base URL this bucket is bound to. ABSENT = the bucket has no public binding, so the
   *  runner returns the object KEY for each upload instead of synthesising a URL nobody serves. */
  publicUrl?: string
  /** Key prefix for this job's uploads — e.g. an owner-scoped private namespace. Absent → the
   *  runner's default `outputs/<epoch_ms>-<filename>` naming. */
  keyPrefix?: string
}

const log = makeLogger('cursor:comfyrunner')

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms))
}

// Marks a terminal job failure (error event from comfyrunner) — must not be retried.
class JobError extends Error {
  readonly isJobError = true
}

// Marks a deliberately-bailed run: the pod's download was throttled below a usable
// rate. Unlike JobError this SHOULD be retried on a fresh pod (provider throttling
// is per-pod). SecurePodClient lets this bypass the "don't retry after accept" guard.
export class ThrottleError extends Error {
  readonly isThrottleError = true
}

// Aggregate download must sustain at least this rate, else the pod is considered
// throttled and the run is bailed to a fresh pod. Tunable without redeploy.
const THROTTLE_MIN_MBPS  = Number(process.env.THROTTLE_MIN_MBPS ?? 20)
const THROTTLE_WINDOW_MS = Number(process.env.THROTTLE_WINDOW_MS ?? 45_000)

/**
 * The runner's view of a CompiledSpec — either runtime kind (ADR-0007). A spec carries
 * resolved `models` + one form: `workflow` (ComfyUI graph) or `inference` (LLM call).
 * `repo` rides on a model when the runtime downloads a whole HF repo (vLLM).
 */
export interface CompiledSpecLike {
  image?: { ociRef?: string }
  runtime?: string
  models: Array<{ id?: string; url: string; dest: string; sizeBytes?: number; repo?: string }>
  workflow?: { inputTemplate: Record<string, unknown> }
  inference?: Record<string, unknown>
  customNodes?: Array<{ url: string; name?: string }>
  /** Image/video/audio inputs the runner fetches into ComfyUI's input/ dir before queueing. */
  mediaInputs?: Array<{ destFilename: string; url: string }>
}

/** A compiled ComfyUI graph spec — has a `workflow` template. */
export function isComfyUISpec(
  v: unknown,
): v is CompiledSpecLike & { workflow: { inputTemplate: Record<string, unknown> } } {
  if (!v || typeof v !== 'object') return false
  const o = v as Record<string, unknown>
  const wf = o.workflow as Record<string, unknown> | undefined
  return !!wf && typeof wf === 'object' && typeof wf.inputTemplate === 'object' && Array.isArray(o.models)
}

/** A compiled LLM inference spec — has an `inference` call (ADR-0007). */
export function isInferenceSpec(
  v: unknown,
): v is CompiledSpecLike & { inference: Record<string, unknown> } {
  if (!v || typeof v !== 'object') return false
  const o = v as Record<string, unknown>
  return !!o.inference && typeof o.inference === 'object' && Array.isArray(o.models)
}

/**
 * A compiled spec of EITHER runtime kind (resolved models + a form). Use this when the concern
 * is runtime-agnostic — reading `image`/`runtime`, or warm-pod model admission. For the
 * submission/transport path, branch on the narrow `isComfyUISpec`/`isInferenceSpec` instead.
 */
export function isCompiledSpec(v: unknown): v is CompiledSpecLike {
  return isComfyUISpec(v) || isInferenceSpec(v)
}

/**
 * POST a job to the runner. Sends the model manifest (so the runner can preflight on warm pods
 * that may be missing weights) plus the runtime-appropriate form: `workflow` for a ComfyUI pod,
 * `inference` for a vLLM pod. A bare object (no compiled envelope) is treated as a raw workflow.
 */
export async function submitToRunner(
  fetchFn: typeof fetch,
  runnerBase: string,
  jobId: string,
  input: unknown,
  webhook?: string,
  r2?: R2Config,
  /** BYO-secrets Phase C: the per-job pod credential. The runner presents it as
   *  `Authorization: Bearer <jobToken>` when fetching a `gated` model url (our weight-proxy). */
  jobToken?: string,
): Promise<void> {
  const body: Record<string, unknown> = { jobId }
  if (isComfyUISpec(input)) {
    body.workflow    = input.workflow.inputTemplate
    body.models      = input.models
    body.customNodes = input.customNodes ?? []
    if (input.mediaInputs?.length) body.mediaInputs = input.mediaInputs
    if (input.runtime) body.runtime = input.runtime
  } else if (isInferenceSpec(input)) {
    body.inference = input.inference
    body.models    = input.models
    if (input.runtime) body.runtime = input.runtime
  } else {
    // Legacy: a raw ComfyUI workflow object with no compiled envelope.
    body.workflow    = input
    body.models      = []
    body.customNodes = []
  }
  if (webhook)  body.webhook = webhook
  if (r2)       body.r2 = r2
  if (jobToken) body.jobToken = jobToken

  const res = await fetchFn(`${runnerBase}/job`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15_000),
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    const err = new Error(`comfyrunner POST /job returned ${res.status}: ${text}`) as Error & { permanent?: boolean }
    // 4xx = a deterministic bad request (e.g. wrong form field) — re-provisioning a fresh pod will
    // hit the exact same rejection, so mark it permanent so the caller fails fast (no retry waste).
    if (res.status >= 400 && res.status < 500) err.permanent = true
    throw err
  }
}

/** The tally comfyrunner's /install returns — a download-only model apply (no workflow run). */
export interface InstallResult {
  modelsDownloaded: number
  modelsReused: number
  downloadMs?: number
  downloadBytes?: number
}

/**
 * Download-only model install on an already-running pod. POSTs the model refs to comfyrunner's
 * `/install`, which runs its `_ensure_models` preflight (skip-present / resume-partial) WITHOUT
 * executing a workflow, and returns the download tally. Mirrors `submitToRunner`'s transport.
 */
export async function installViaRunner(
  fetchFn: typeof fetch,
  runnerBase: string,
  models: ModelRef[],
  timeoutMs = 45 * 60 * 1000,
): Promise<InstallResult> {
  const res = await fetchFn(`${runnerBase}/install`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ models }),
    signal: AbortSignal.timeout(timeoutMs),
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`comfyrunner POST /install returned ${res.status}: ${text}`)
  }
  return await res.json() as InstallResult
}

/**
 * What the runner says about a job when we ask it directly.
 *
 * `unknown` is IGNORANCE, not evidence: a transport error, a non-JSON body or an unrecognized
 * shape tells us nothing about whether the job is running, so it must never on its own be
 * treated as death. Liveness is asked, never inferred.
 */
export type JobLiveness =
  | { kind: 'alive'; status: 'queued' | 'running' }
  | { kind: 'terminal'; status: 'completed' | 'failed'; body: unknown }
  | { kind: 'gone' }
  | { kind: 'unknown' }

/**
 * The runner does not know this job any more — `GET /job/<id>` answered 404, meaning the job is
 * neither recorded nor in flight (a comfyrunner restart clears its in-process job table).
 * Callers decide a pod's fate off `instanceof RunnerJobLost`, never off a message substring.
 */
export class RunnerJobLost extends Error {
  readonly isJobLost = true
  constructor(jobId: string) {
    super(`comfyrunner no longer has job ${jobId}`)
    this.name = 'RunnerJobLost'
  }
}

/** Ask the runner whether a job is still alive. `GET /job/<id>` (comfyrunner `job-poll`). */
export async function pollJobStatus(
  fetchFn: typeof fetch,
  runnerBase: string,
  jobId: string,
  timeoutMs = 10_000,
): Promise<JobLiveness> {
  try {
    const res = await fetchFn(`${runnerBase}/job/${jobId}`, { signal: AbortSignal.timeout(timeoutMs) })
    if (res.status === 404) return { kind: 'gone' }
    if (!res.ok) return { kind: 'unknown' }
    const body = await res.json() as unknown
    const status = (body && typeof body === 'object') ? (body as { status?: unknown }).status : undefined
    if (status === 'completed' || status === 'failed') return { kind: 'terminal', status, body }
    if (status === 'queued' || status === 'running') return { kind: 'alive', status }
    // A finished job answers with its raw result object, which carries no `status` field. An
    // unrecognized 200 means the runner is answering about our job, so treat it as alive and let
    // the stream deliver the truth — never as death.
    return { kind: 'alive', status: 'running' }
  } catch (_) {
    return { kind: 'unknown' }
  }
}

/** Pull a human-readable reason out of a terminal `failed` poll body. */
function runnerFailureMessage(body: unknown): string {
  if (body && typeof body === 'object') {
    const o = body as { error?: unknown; message?: unknown }
    if (typeof o.error === 'string' && o.error) return o.error
    if (typeof o.message === 'string' && o.message) return o.message
  }
  return 'comfyrunner reports the job failed'
}

/** Consecutive unclassifiable liveness answers before we stop giving the job the benefit of the doubt. */
const MAX_CONSECUTIVE_UNKNOWN = 3

const SILENT = Symbol('silent')

/** Resolve with `p`'s value, or with SILENT if `ms` elapses first. `p` stays pending and reusable. */
function raceSilence<T>(p: Promise<T>, ms: number): Promise<T | typeof SILENT> {
  let timer: ReturnType<typeof setTimeout> | undefined
  return Promise.race([
    p,
    new Promise<typeof SILENT>(resolve => { timer = setTimeout(() => resolve(SILENT), Math.max(0, ms)) }),
  ]).finally(() => { if (timer !== undefined) clearTimeout(timer) })
}

/**
 * Subscribe to the comfyrunner SSE stream for a job. Resolves when the job
 * completes (terminal `complete` event), throws on `error`.
 *
 * Liveness is ASKED, never inferred from a clock. When the stream goes quiet for `silenceMs`
 * we call `GET /job/<id>`: `running`/`queued` buys another silence window (a long download or a
 * slow graph is not a dead job), `completed` resolves, `failed` throws, and `404` throws
 * `RunnerJobLost`. `costCeilingMs` is an absolute backstop only — it stops a job the runner still
 * calls `running` (e.g. ComfyUI deadlocked inside a node) from holding a paid GPU indefinitely.
 *
 * Emits bus events for progress and optional stage callbacks for Telegram UX.
 * Reconnects up to 3 times on dropped connections, replaying from last seq.
 */
export interface RunMetrics {
  modelsDownloaded?: number
  modelsReused?:     number
  downloadMs?:       number
  downloadBytes?:    number
  executionMs?:      number
}

export async function awaitViaStream(
  fetchFn: typeof fetch,
  runnerBase: string,
  jobId: string,
  /** Absolute cost backstop, NOT the liveness mechanism (see the doc comment above). */
  costCeilingMs: number,
  onMetrics?: (m: RunMetrics) => void,
  /** How long the stream may go quiet before we ask the runner whether the job is alive. */
  silenceMs = 60_000,
): Promise<void> {
  let lastSeq = -1
  let inferringEmitted = false
  let installingRecorded = false
  let modelTotal = 0
  let modelDone = 0
  let downloadStartMs = 0
  let downloadBytes = 0
  let completedBytes = 0
  const dlSizes = new Map<string, number>()
  // Throttle detection state (from download-progress samples).
  let lastProgBytes = -1
  let lastProgMs = 0
  let slowSinceMs = 0
  const ceiling = Date.now() + costCeilingMs
  // Rolling inactivity budget — reset on every parsed event and on every successful reconnect.
  let silenceDeadline = Date.now() + silenceMs
  let unknownStreak = 0

  // Status (Progressus, spec §6a): the OWNED, single status channel (#6e retired the parallel
  // `emitStage`/`actum.stage` strings). Persist a typed timeline onto the Actum via the in-process
  // recorder. We record only PHASE TRANSITIONS, log messages, and terminals (§7) — never per-tick
  // sampler progress (stays live-only) — so there's no findById-per-tick. Awaited inline so reports
  // for one Actum apply in order and the terminal lands before we resolve. No-op until a recorder
  // is registered (index.ts), so unit tests that drive the SSE parse directly need no sink.
  const record = async (p: Omit<Progressus, 'at'>): Promise<void> => {
    const ctx = getTrace()
    if (ctx?.actumId) await recordProgressus(ctx.actumId, { ...p, at: new Date() })
  }

  for (let attempt = 0; attempt <= 3; attempt++) {
    if (attempt > 0) {
      log.warn('SSE stream reconnecting', { attempt, jobId })
      await sleep(1000 * attempt)
    }

    try {
      const remaining = ceiling - Date.now()
      if (remaining <= 0) throw new Error('job cost ceiling exceeded')

      const headers: Record<string, string> = {}
      if (lastSeq >= 0) headers['Last-Event-ID'] = String(lastSeq)

      const res = await fetchFn(`${runnerBase}/job/${jobId}/stream`, {
        headers,
        signal: AbortSignal.timeout(remaining),
      })
      if (!res.ok) throw new Error(`SSE stream returned ${res.status}`)
      if (!res.body) throw new Error('SSE response has no body')

      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buf = ''
      let dataLine = ''
      let idLine = ''

      // A fresh connection is a fresh silence budget.
      silenceDeadline = Date.now() + silenceMs
      let pendingRead: Promise<ReadableStreamReadResult<Uint8Array>> | null = null

      outer: while (true) {
        if (!pendingRead) pendingRead = reader.read()
        const raced = await raceSilence(pendingRead, silenceDeadline - Date.now())

        if (raced === SILENT) {
          // The stream has gone quiet. Ask the runner rather than inferring anything from the clock.
          const liveness = await pollJobStatus(fetchFn, runnerBase, jobId)

          if (liveness.kind === 'alive') {
            unknownStreak = 0
            silenceDeadline = Date.now() + silenceMs
            log.info('stream quiet, runner reports job alive', { jobId, status: liveness.status })
            continue
          }

          if (liveness.kind === 'terminal') {
            if (liveness.status === 'completed') {
              // The job finished while the stream was broken — deliver it instead of waiting.
              log.info('stream quiet, runner reports job complete', { jobId })
              void reader.cancel().catch(() => {})
              await record({ phase: 'done' })
              return
            }
            const errMsg = runnerFailureMessage(liveness.body)
            log.warn('stream quiet, runner reports job failed', { jobId, error: errMsg })
            void reader.cancel().catch(() => {})
            await record({ phase: 'failed', message: errMsg })
            throw new JobError(errMsg)
          }

          if (liveness.kind === 'unknown') {
            unknownStreak++
            // Taxonomy capture: an unclassifiable liveness answer is the thing we cannot yet name.
            log.warn('runner liveness poll unclassified', { jobId, livenessKind: 'unknown', unknownStreak, maxUnknown: MAX_CONSECUTIVE_UNKNOWN })
            if (unknownStreak < MAX_CONSECUTIVE_UNKNOWN) {
              silenceDeadline = Date.now() + silenceMs
              continue
            }
          }

          // 404, or nothing classifiable MAX_CONSECUTIVE_UNKNOWN polls running: the job is lost.
          const lost = new RunnerJobLost(jobId)
          log.warn('runner no longer has this job', { jobId, livenessKind: liveness.kind, unknownStreak })
          void reader.cancel().catch(() => {})
          await record({ phase: 'failed', message: lost.message })
          throw lost
        }

        pendingRead = null
        const { done, value } = raced
        if (done) break

        buf += decoder.decode(value, { stream: true })
        const lines = buf.split('\n')
        buf = lines.pop() ?? ''

        for (const line of lines) {
          if (line.startsWith('id:')) {
            idLine = line.slice(3).trim()
          } else if (line.startsWith('data:')) {
            dataLine = line.slice(5).trim()
          } else if (line === '') {
            if (!dataLine) { idLine = ''; dataLine = ''; continue }
            if (idLine) lastSeq = parseInt(idLine, 10)

            const event = JSON.parse(dataLine) as { type: string; [k: string]: unknown }
            idLine = ''
            dataLine = ''
            // The job is demonstrably talking to us — refresh the inactivity budget.
            silenceDeadline = Date.now() + silenceMs
            unknownStreak = 0

            switch (event.type) {
              case 'preflight-models': {
                const { total = 0, present = 0 } = event as { total?: number; present?: number }
                modelTotal = total
                modelDone = present
                if (total > present && downloadStartMs === 0) downloadStartMs = Date.now()
                log.info('model preflight', { jobId, missing: total - present, present, total })
                if (total > present) {
                  await record({ phase: 'downloading', target: 'model', progress: { done: present, total, unit: 'items' } })
                }
                break
              }
              case 'downloading': {
                const { dest, total: bytes } = event as { dest?: string; total?: number }
                if (downloadStartMs === 0) downloadStartMs = Date.now()
                if (typeof bytes === 'number') {
                  downloadBytes += bytes
                  if (dest) dlSizes.set(dest, bytes)
                }
                // No preflight count (single-file fetch) → still surface a `downloading` phase
                // on the owned timeline so the bulletin/SSE show it (#6e; was emitStage('downloading')).
                if (modelTotal === 0) await record({ phase: 'downloading', target: 'model' })
                log.info('model download started', { jobId, dest, bytes })
                break
              }
              case 'downloaded': {
                modelDone++
                const { dest, elapsedMs: dlMs } = event as { dest?: string; elapsedMs?: number }
                if (dest) completedBytes += dlSizes.get(dest) ?? 0
                log.info('model downloaded', { jobId, dest, elapsedMs: dlMs, done: modelDone, total: modelTotal })
                if (modelTotal > 0) {
                  // ETA from aggregate download velocity (bytes/sec) over remaining bytes.
                  const elapsed = Date.now() - downloadStartMs
                  let etaMs: number | undefined
                  if (elapsed > 0 && completedBytes > 0 && downloadBytes > completedBytes) {
                    const bytesPerMs = completedBytes / elapsed
                    etaMs = Math.round((downloadBytes - completedBytes) / bytesPerMs)
                  }
                  // Tick the owned timeline: actum.progressus is the bulletin/SSE's sole driver, so
                  // the n/m counter must advance here, not just at preflight. Per-MODEL (low-frequency,
                  // like preflight) — NOT the byte-level download-progress; and same-phase progress
                  // coalesces out of the persisted timeline (§7), bus-only.
                  await record({ phase: 'downloading', target: 'model', progress: { done: modelDone, total: modelTotal, unit: 'items' }, ...(etaMs !== undefined ? { etaMs } : {}) })
                }
                break
              }
              case 'models-ready': {
                const { downloaded = 0, reused = 0 } = event as { downloaded?: number; reused?: number }
                const downloadMs = downloadStartMs > 0 ? Date.now() - downloadStartMs : 0
                log.info('models ready', { jobId, downloaded, reused, downloadMs, downloadBytes })
                onMetrics?.({ modelsDownloaded: downloaded, modelsReused: reused, downloadMs, downloadBytes })
                break
              }
              case 'download-progress': {
                const { bytesDownloaded = 0, elapsedMs: pMs = 0 } = event as { bytesDownloaded?: number; elapsedMs?: number }
                if (lastProgBytes >= 0 && pMs > lastProgMs) {
                  const mbps = ((bytesDownloaded - lastProgBytes) / (1024 * 1024)) / ((pMs - lastProgMs) / 1000)
                  if (mbps < THROTTLE_MIN_MBPS) {
                    if (slowSinceMs === 0) slowSinceMs = pMs
                    else if (pMs - slowSinceMs >= THROTTLE_WINDOW_MS) {
                      log.warn('pod download throttled — bailing', { jobId, mbps: Number(mbps.toFixed(1)), minMbps: THROTTLE_MIN_MBPS })
                      throw new ThrottleError(`download throttled to ${mbps.toFixed(1)} MB/s (min ${THROTTLE_MIN_MBPS})`)
                    }
                  } else {
                    slowSinceMs = 0
                  }
                }
                lastProgBytes = bytesDownloaded
                lastProgMs = pMs
                break
              }
              case 'workflow-submitted':
                log.info('workflow submitted to ComfyUI', { jobId, promptId: event.promptId })
                // ComfyUI now loads the graph's weights into VRAM (§6a).
                await record({ phase: 'loading', target: 'vram' })
                break
              case 'waiting':
                // Heartbeat while ComfyUI runs. nodesExecuted=0 across many of these = stuck loading.
                log.info('awaiting ComfyUI', { jobId, elapsedS: event.elapsedS, nodesExecuted: event.nodesExecuted })
                break
              case 'installing-node':
                // One installing entry per run (mirrors inferringEmitted) — fires per node,
                // so guard rather than lean on the recorder to coalesce N findById round-trips.
                if (!installingRecorded) {
                  installingRecorded = true
                  await record({ phase: 'installing' })
                }
                break
              case 'restarting-comfy':
                await record({ phase: 'installing', message: 'restarting ComfyUI' })
                break
              case 'node':
                if (!inferringEmitted) {
                  inferringEmitted = true
                  await record({ phase: 'executing' })   // first node → work begins (§6a)
                }
                break
              case 'progress':
                // Per-tick sampler progress (n/max) is live-only and high-frequency. It was a
                // bus-only `actum.stage` frame for the SSE bar; the bulletin never read it. With
                // the shim retired (#6e) we don't route it through the owned timeline (§7 keeps
                // per-tick out, and an actum.progressus per step would flood the Telegram render).
                break
              case 'uploading':
                await record({ phase: 'uploading', target: 'output' })
                break
              case 'complete': {
                const { executionTimeMs } = event as { executionTimeMs?: number }
                log.info('job complete', { jobId, executionTimeMs })
                if (typeof executionTimeMs === 'number') onMetrics?.({ executionMs: executionTimeMs })
                await record({ phase: 'done' })   // terminal → rolls up phaseDurations
                return
              }
              case 'error': {
                const errMsg = (event.error as string) || 'comfyrunner job failed'
                log.warn('job error from comfyrunner', { jobId, error: errMsg })
                await record({ phase: 'failed', message: errMsg })   // terminal
                throw new JobError(errMsg)
              }
            }
          }
        }
      }
      // Stream closed without terminal event — retry
      log.warn('SSE stream closed without terminal event', { jobId, attempt })
    } catch (err) {
      const e = err as { isJobError?: boolean; isThrottleError?: boolean; isJobLost?: boolean }
      // isJobLost: the runner was asked and does not have this job — reconnecting cannot help.
      if (e.isJobError || e.isThrottleError || e.isJobLost || attempt >= 3 || Date.now() >= ceiling) throw err
    }
  }

  throw new Error('SSE stream failed after max retries')
}
