import type { RunPodClient } from './RunPodCursor.js'
import type { Materia, MateriaStore } from '../types/materia.js'
import { SecurePodClient } from './SecurePodClient.js'
import { makeLogger } from '../lib/logger.js'

const log = makeLogger('cursor:runpod:warm')

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms))
}

interface WarmPodConfig {
  runnerReadyTimeoutMs?: number
  runnerPollIntervalMs?: number
  jobTimeoutMs?: number
}

interface CompiledSpecLike {
  workflow: { inputTemplate: Record<string, unknown> }
  models: Array<{ url: string; dest: string; sizeBytes?: number }>
}

function isCompiledSpec(v: unknown): v is CompiledSpecLike {
  if (!v || typeof v !== 'object') return false
  const o = v as Record<string, unknown>
  return (
    o.workflow !== null && typeof o.workflow === 'object' &&
    typeof (o.workflow as Record<string, unknown>).inputTemplate === 'object' &&
    Array.isArray(o.models)
  )
}

interface JobResult {
  status: 'running' | 'completed' | 'failed'
  output?: Array<{ url: string }>
  error?: string
  executionTime?: number
}

/**
 * WarmPodClient — runs a ComfyUI job on an already-running SECURE pod.
 *
 * Submits the job to runner.py via the RunPod HTTP proxy, then polls
 * runner.py's /job/<id> endpoint for the result. When done, fires the
 * completion webhook from Crystal's own process — no outbound calls from the
 * pod required, which avoids reverse-proxy / CSRF issues.
 */
export class WarmPodClient implements RunPodClient {
  constructor(
    private readonly materia: Materia,
    private readonly materiae: MateriaStore,
    private readonly fetchFn: typeof fetch = globalThis.fetch,
    private readonly config: WarmPodConfig = {},
  ) {}

  async submit(params: { input: unknown; webhook?: string }): Promise<{ id: string }> {
    const { id, externusId } = this.materia

    this._runBackground(params.input, params.webhook).catch(async (err) => {
      log.error(`Materia ${externusId} job failed`, { materiaId: id, externusId, error: (err as Error).message })
      if (params.webhook) {
        await this.fetchFn(params.webhook, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: externusId, status: 'FAILED', error: (err as Error).message }),
        }).catch(() => {})
      }
    })

    return { id: externusId }
  }

  // ── private ──────────────────────────────────────────────────────────────

  private _runnerBase(): string {
    return SecurePodClient.runnerBase(this.materia.externusId)
  }

  private async _runBackground(input: unknown, webhook: string | undefined): Promise<void> {
    const { id, externusId } = this.materia
    const runnerBase = this._runnerBase()
    const workflowInput = isCompiledSpec(input) ? input.workflow.inputTemplate : input
    let podReachable = false

    try {
      await this._waitForRunner(runnerBase)
      podReachable = true

      // Submit job — runner.py queues it and exposes status at GET /job/<externusId>
      const res = await this.fetchFn(`${runnerBase}/job`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jobId: externusId, workflow: workflowInput }),
        signal: AbortSignal.timeout(15000),
      })

      if (!res.ok) {
        if (res.status >= 500) podReachable = false
        throw new Error(`runner.py POST /job returned ${res.status}`)
      }

      log.info('job queued on runner.py', { materiaId: id, externusId, runnerBase })

      // Poll for completion — Crystal fires the webhook itself from this process
      const jobTimeoutMs = this.config.jobTimeoutMs ?? 15 * 60 * 1000
      const result = await this._pollJobResult(runnerBase, externusId, jobTimeoutMs)

      if (result.status === 'failed') {
        throw new Error(result.error ?? 'runner.py job failed')
      }

      if (webhook) {
        await this.fetchFn(webhook, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            id: externusId,
            status: 'COMPLETED',
            output: result.output ?? [],
            executionTime: result.executionTime ?? 0,
          }),
        })
      }
    } finally {
      // Pod unreachable = dead; otherwise return to idle
      const nextStatus = (!podReachable || this.materia.podPolicy === 'private') ? 'terminated' : 'idle'
      await this.materiae.update(id, { status: nextStatus }).catch(() => {})
    }
  }

  private async _waitForRunner(runnerBase: string): Promise<void> {
    const timeoutMs = this.config.runnerReadyTimeoutMs ?? 30_000
    const pollMs = this.config.runnerPollIntervalMs ?? 2000
    const deadline = Date.now() + timeoutMs
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
    throw new Error('runner.py not reachable on warm pod')
  }

  private async _pollJobResult(runnerBase: string, jobId: string, timeoutMs: number): Promise<JobResult> {
    const pollMs = this.config.runnerPollIntervalMs ?? 2000
    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline) {
      try {
        const res = await this.fetchFn(`${runnerBase}/job/${jobId}`, { signal: AbortSignal.timeout(5000) })
        if (res.ok) {
          const body = await res.json() as JobResult
          if (body.status === 'completed' || body.status === 'failed') return body
        }
      } catch (_) {
        // poll again
      }
      await sleep(pollMs)
    }
    throw new Error('runner.py job did not complete within timeout')
  }
}
