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
export async function awaitViaStream(
  fetchFn: typeof fetch,
  runnerBase: string,
  jobId: string,
  timeoutMs: number,
  emitStage?: (stage: string) => void,
): Promise<void> {
  let lastSeq = -1
  let inferringEmitted = false
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
              case 'installing-node':
                emitStage?.('installing-nodes')
                break
              case 'restarting-comfy':
                emitStage?.('restarting')
                break
              case 'downloading':
                emitStage?.('downloading')
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
                    elapsedMs: 0,
                  })
                }
                break
              }
              case 'uploading':
                emitStage?.('uploading')
                break
              case 'complete':
                return
              case 'error':
                throw new JobError((event.error as string) || 'comfyrunner job failed')
            }
          }
        }
      }
      // Stream closed without terminal event — retry
      log.warn('SSE stream closed without terminal event', { jobId, attempt })
    } catch (err) {
      if ((err as { isJobError?: boolean }).isJobError || attempt >= 3 || Date.now() >= deadline) throw err
    }
  }

  throw new Error('SSE stream failed after max retries')
}
