import { makeLogger } from '../lib/logger.js'
import { getTrace } from '../lib/trace.js'
import { bus } from '../lib/bus.js'

export interface R2Config {
  /** Full R2 endpoint URL: https://<accountId>.r2.cloudflarestorage.com */
  endpoint: string
  accessKeyId: string
  secretAccessKey: string
  bucket: string
  publicUrl?: string
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

export interface CompiledSpecLike {
  workflow: { inputTemplate: Record<string, unknown> }
  models: Array<{ url: string; dest: string; sizeBytes?: number }>
  customNodes?: Array<{ url: string; name?: string }>
}

export function isCompiledSpec(v: unknown): v is CompiledSpecLike {
  if (!v || typeof v !== 'object') return false
  const o = v as Record<string, unknown>
  return (
    o.workflow !== null && typeof o.workflow === 'object' &&
    typeof (o.workflow as Record<string, unknown>).inputTemplate === 'object' &&
    Array.isArray(o.models)
  )
}

/**
 * POST a job to comfyrunner. Includes the full model + custom-node manifests
 * so the runner can do preflight on warm pods that may be missing models.
 */
export async function submitToRunner(
  fetchFn: typeof fetch,
  runnerBase: string,
  jobId: string,
  input: unknown,
  webhook?: string,
  r2?: R2Config,
): Promise<void> {
  const spec = isCompiledSpec(input) ? input : null
  const workflow    = spec?.workflow.inputTemplate ?? input
  const models      = spec?.models ?? []
  const customNodes = spec?.customNodes ?? []

  const body: Record<string, unknown> = { jobId, workflow, models, customNodes }
  if (webhook) body.webhook = webhook
  if (r2)      body.r2 = r2

  const res = await fetchFn(`${runnerBase}/job`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15_000),
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`comfyrunner POST /job returned ${res.status}: ${text}`)
  }
}

/**
 * Subscribe to the comfyrunner SSE stream for a job. Resolves when the job
 * completes (terminal `complete` event), throws on `error` or timeout.
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
  timeoutMs: number,
  emitStage?: (stage: string, info?: { etaMs?: number }) => void,
  onMetrics?: (m: RunMetrics) => void,
): Promise<void> {
  let lastSeq = -1
  let inferringEmitted = false
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
  const deadline = Date.now() + timeoutMs

  for (let attempt = 0; attempt <= 3; attempt++) {
    if (attempt > 0) {
      log.warn('SSE stream reconnecting', { attempt, jobId })
      await sleep(1000 * attempt)
    }

    try {
      const remaining = deadline - Date.now()
      if (remaining <= 0) throw new Error('job timeout exceeded')

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

      outer: while (true) {
        const { done, value } = await reader.read()
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

            switch (event.type) {
              case 'preflight-models': {
                const { total = 0, present = 0 } = event as { total?: number; present?: number }
                modelTotal = total
                modelDone = present
                if (total > present && downloadStartMs === 0) downloadStartMs = Date.now()
                log.info('model preflight', { jobId, missing: total - present, present, total })
                if (total > present) emitStage?.(`downloading:${present}/${total}`)
                break
              }
              case 'downloading': {
                const { dest, total: bytes } = event as { dest?: string; total?: number }
                if (downloadStartMs === 0) downloadStartMs = Date.now()
                if (typeof bytes === 'number') {
                  downloadBytes += bytes
                  if (dest) dlSizes.set(dest, bytes)
                }
                if (modelTotal === 0) emitStage?.('downloading')
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
                  emitStage?.(`downloading:${modelDone}/${modelTotal}`, etaMs !== undefined ? { etaMs } : undefined)
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
                break
              case 'waiting':
                // Heartbeat while ComfyUI runs. nodesExecuted=0 across many of these = stuck loading.
                log.info('awaiting ComfyUI', { jobId, elapsedS: event.elapsedS, nodesExecuted: event.nodesExecuted })
                break
              case 'installing-node':
                emitStage?.('installing-nodes')
                break
              case 'restarting-comfy':
                emitStage?.('restarting')
                break
              case 'node':
                if (!inferringEmitted) {
                  inferringEmitted = true
                  emitStage?.('inferring')
                }
                break
              case 'progress': {
                const ctx = getTrace()
                if (ctx?.actumId) {
                  bus.emit('actum.stage', {
                    actumId:  ctx.actumId,
                    stage:    `progress:${event.value}/${event.max}`,
                    elapsedMs: Date.now() - (ctx.startTs ?? deadline - timeoutMs),
                  })
                }
                break
              }
              case 'uploading':
                emitStage?.('uploading')
                break
              case 'complete': {
                const { executionTimeMs } = event as { executionTimeMs?: number }
                log.info('job complete', { jobId, executionTimeMs })
                if (typeof executionTimeMs === 'number') onMetrics?.({ executionMs: executionTimeMs })
                return
              }
              case 'error': {
                const errMsg = (event.error as string) || 'comfyrunner job failed'
                log.warn('job error from comfyrunner', { jobId, error: errMsg })
                throw new JobError(errMsg)
              }
            }
          }
        }
      }
      // Stream closed without terminal event — retry
      log.warn('SSE stream closed without terminal event', { jobId, attempt })
    } catch (err) {
      const e = err as { isJobError?: boolean; isThrottleError?: boolean }
      if (e.isJobError || e.isThrottleError || attempt >= 3 || Date.now() >= deadline) throw err
    }
  }

  throw new Error('SSE stream failed after max retries')
}
