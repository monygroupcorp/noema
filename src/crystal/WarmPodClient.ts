import type { RunPodClient } from './RunPodCursor.js'
import type { Materia, MateriaStore } from '../types/materia.js'
import type { SshTransportLike } from './SecurePodClient.js'
import { makeSecurePodSshFactory } from './SecurePodClient.js'

const COMFYUI_PORT = 8188

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms))
}

interface WarmPodConfig {
  comfyReadyTimeoutMs?: number
  comfyPollIntervalMs?: number
  jobTimeoutMs?: number
}

interface ComfyHistoryEntry {
  outputs?: Record<string, {
    images?: Array<{ filename: string; subfolder: string; type: string }>
    gifs?: Array<{ filename: string; subfolder: string; type: string }>
    videos?: Array<{ filename: string; subfolder: string; type: string }>
  }>
}

function collectOutputPaths(outputs: ComfyHistoryEntry['outputs']): string[] {
  const paths: string[] = []
  for (const node of Object.values(outputs ?? {})) {
    for (const kind of ['images', 'gifs', 'videos'] as const) {
      for (const item of node[kind] ?? []) {
        const subdir = item.subfolder ? `${item.subfolder}/` : ''
        paths.push(`/root/ComfyUI/output/${subdir}${item.filename}`)
      }
    }
  }
  return paths
}

/**
 * WarmPodClient — runs a ComfyUI job on an already-running SECURE pod.
 *
 * Unlike SecurePodClient (which provisions → runs → terminates), WarmPodClient:
 *   - SSHes into an existing pod (no provisioning)
 *   - Submits the workflow (ComfyUI is already running)
 *   - Returns the pod to idle status after the job (no termination)
 *
 * This is the execution side of Praefectus — the router finds the pod,
 * WarmPodClient does the work.
 */
export class WarmPodClient implements RunPodClient {
  private readonly sshFactory: (info: { host: string; port: number; user: string }) => SshTransportLike

  constructor(
    private readonly materia: Materia,
    private readonly materiae: MateriaStore,
    sshFactory?: (info: { host: string; port: number; user: string }) => SshTransportLike,
    private readonly fetchFn: typeof fetch = globalThis.fetch,
    private readonly config: WarmPodConfig = {},
  ) {
    this.sshFactory = sshFactory ?? makeSecurePodSshFactory(process.env.RUNPOD_SSH_KEY_PATH ?? `${process.env.HOME}/.ssh/runpod`)
  }

  async submit(params: { input: unknown; webhook?: string }): Promise<{ id: string }> {
    const { id } = this.materia

    // Mark busy immediately (before returning) so Praefectus won't double-dispatch
    await this.materiae.update(id, { status: 'active' })

    this._runBackground(params.input, params.webhook).catch(async (err) => {
      console.error(`[WarmPodClient] Materia ${id} job failed: ${(err as Error).message}`)
      // Return pod to idle (or terminate if private) even on failure
      const nextStatus = this.materia.podPolicy === 'private' ? 'terminated' : 'idle'
      await this.materiae.update(id, { status: nextStatus }).catch(() => {})
      if (params.webhook) {
        await this.fetchFn(params.webhook, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id, status: 'FAILED', error: (err as Error).message }),
        }).catch(() => {})
      }
    })

    return { id }
  }

  // ── private ──────────────────────────────────────────────────────────────

  private async _runBackground(input: unknown, webhook: string | undefined): Promise<void> {
    const { id, sshHost, sshPort } = this.materia
    if (!sshHost || !sshPort) throw new Error(`Materia ${id} has no SSH info`)

    const startMs = Date.now()
    const ssh = this.sshFactory({ host: sshHost, port: sshPort, user: 'root' })

    try {
      await this._waitForComfyApi(ssh)
      const promptId = await this._submitWorkflow(ssh, input)
      const jobTimeoutMs = this.config.jobTimeoutMs ?? 15 * 60 * 1000
      const remotePaths = await this._awaitCompletion(ssh, promptId, jobTimeoutMs)

      const executionTime = Date.now() - startMs

      if (webhook) {
        await this.fetchFn(webhook, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            id,
            status: 'COMPLETED',
            output: remotePaths.map(p => ({ path: p })),
            executionTime,
          }),
        })
      }
    } finally {
      await ssh.close().catch(() => {})
      // Terminate private pods; return all others to idle
      const nextStatus = this.materia.podPolicy === 'private' ? 'terminated' : 'idle'
      await this.materiae.update(id, { status: nextStatus }).catch(() => {})
    }
  }

  private async _waitForComfyApi(ssh: SshTransportLike): Promise<void> {
    const timeoutMs = this.config.comfyReadyTimeoutMs ?? 2 * 60 * 1000
    const pollMs = this.config.comfyPollIntervalMs ?? 2000
    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline) {
      try {
        const out = await ssh.exec(`curl -sf http://localhost:${COMFYUI_PORT}/system_stats`, { stdio: 'pipe', timeout: 5000 })
        if (out && out.includes('system')) return
      } catch (_) {
        // not ready yet
      }
      await sleep(pollMs)
    }
    throw new Error('ComfyUI API not responsive on warm pod')
  }

  private async _submitWorkflow(ssh: SshTransportLike, input: unknown): Promise<string | null> {
    const payload = JSON.stringify({ prompt: input }).replace(/'/g, "'\\''")
    const out = await ssh.exec(
      `curl -sf -X POST http://localhost:${COMFYUI_PORT}/prompt -H "Content-Type: application/json" -d '${payload}'`,
      { stdio: 'pipe', timeout: 15000 },
    )
    try {
      const parsed = JSON.parse(out ?? '{}') as { prompt_id?: string }
      return parsed.prompt_id ?? null
    } catch (_) {
      return null
    }
  }

  private async _awaitCompletion(ssh: SshTransportLike, promptId: string | null, timeoutMs: number): Promise<string[]> {
    const pollMs = this.config.comfyPollIntervalMs ?? 2000
    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline) {
      try {
        const out = await ssh.exec(`curl -sf http://localhost:${COMFYUI_PORT}/history`, { stdio: 'pipe', timeout: 5000 })
        const history = JSON.parse(out ?? '{}') as Record<string, ComfyHistoryEntry>
        const entry = promptId ? history[promptId] : Object.values(history)[0]
        if (entry?.outputs) {
          const paths = collectOutputPaths(entry.outputs)
          if (paths.length) return paths
        }
      } catch (_) {
        // poll again
      }
      await sleep(pollMs)
    }
    throw new Error('Workflow did not complete within job timeout')
  }
}
