import type { RunPodClient } from './RunPodCursor.js'
import type { MateriaStore } from '../types/materia.js'
import { makeLogger } from '../lib/logger.js'
import { getTrace } from '../lib/trace.js'

const log = makeLogger('cursor:runpod:secure')

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SecurePodConfig {
  apiKey: string
  sshKeyPath: string
  gpuTypeIds: string[]
  imageName: string
  cloudType?: 'SECURE' | 'COMMUNITY'
  containerDiskGb?: number
  /** Overrideable timeouts (ms) — defaults tuned for production, inject small values in tests. */
  provisionTimeoutMs?: number    // default: 30_000 — per-request timeout for the pod creation POST
  sshInfoTimeoutMs?: number      // default: 10_000 — per-request timeout for each SSH status poll GET
  sshReadyTimeoutMs?: number     // default: 10 min  — overall deadline for SSH to become reachable
  sshPollIntervalMs?: number     // default: 8000
  comfyReadyTimeoutMs?: number   // default: 5 min
  comfyPollIntervalMs?: number   // default: 2000
  jobTimeoutMs?: number          // default: 15 min
  /** How many times to retry the COMPLETED webhook POST on failure (default: 3). */
  webhookRetries?: number        // default: 3
  /** Base delay between webhook retries in ms; doubles each attempt (default: 1000). */
  webhookRetryDelayMs?: number   // default: 1000
  /** When true: register pod as idle Materia instead of terminating after a successful job. */
  keepWarm?: boolean
  /** Cost rate for the Materia record (default 0n). */
  impetusPerSecond?: bigint
}

export interface SshTransportLike {
  exec(command: string, options?: { stdio?: string; timeout?: number }): Promise<string | undefined>
  close(): Promise<void>
}

interface SshInfo {
  host: string
  port: number
  user: string
}

interface RunPodPodStatus {
  desiredStatus?: string
  runtime?: {
    ports?: Array<{ ip: string; privatePort: number; publicPort: number; type: string }>
  }
}

interface ComfyHistoryEntry {
  outputs?: Record<string, {
    images?: Array<{ filename: string; subfolder: string; type: string }>
    gifs?: Array<{ filename: string; subfolder: string; type: string }>
    videos?: Array<{ filename: string; subfolder: string; type: string }>
  }>
}

const COMFYUI_PORT = 8188

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms))
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

// ---------------------------------------------------------------------------
// SecurePodClient
// ---------------------------------------------------------------------------

export class SecurePodClient implements RunPodClient {
  constructor(
    private readonly config: SecurePodConfig,
    private readonly sshFactory: (info: SshInfo) => SshTransportLike,
    private readonly fetchFn: typeof fetch = globalThis.fetch,
    private readonly materiae?: MateriaStore,
  ) {}

  async submit(params: { input: unknown; webhook?: string }): Promise<{ id: string }> {
    log.info('pod provisioning', { actumId: getTrace()?.actumId })
    const podId = await this._provisionPod()

    // After pod is provisioned — record podId and provisionMs
    const _traceCtx = getTrace()
    if (_traceCtx) {
      _traceCtx.wideFields.podId = podId
      _traceCtx.provisionMs = Date.now() - _traceCtx.startTs
    }

    this._runBackground(podId, params.input, params.webhook).catch(async (err) => {
      log.error(`Pod ${podId} failed`, { podId, error: (err as Error).message })
      if (params.webhook) {
        await this.fetchFn(params.webhook, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: podId, status: 'FAILED', error: (err as Error).message }),
        }).catch(() => {})
      }
    })

    return { id: podId }
  }

  // ── private ──────────────────────────────────────────────────────────────

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

  private async _provisionPod(): Promise<string> {
    const res = await this._fetchWithTimeout('https://rest.runpod.io/v1/pods', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.config.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        name: `noema-${Date.now()}`,
        imageName: this.config.imageName,
        gpuTypeIds: this.config.gpuTypeIds,
        gpuCount: 1,
        cloudType: this.config.cloudType ?? 'SECURE',
        containerDiskInGb: this.config.containerDiskGb ?? 40,
        ports: '22/tcp,8188/http',
        supportPublicIp: true,
      }),
    }, this.config.provisionTimeoutMs ?? 30_000)

    if (!res.ok) {
      const text = await res.text().catch(() => '')
      throw new Error(`RunPod pod provision failed: ${res.status} ${text}`)
    }

    const data = await res.json() as { id: string }
    return data.id
  }

  private async _waitForSsh(podId: string): Promise<SshInfo> {
    const timeoutMs = this.config.sshReadyTimeoutMs ?? 10 * 60 * 1000
    const pollMs = this.config.sshPollIntervalMs ?? 8000
    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline) {
      const info = await this._getSshInfo(podId)
      if (info) {
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
        return info
      }
      await sleep(pollMs)
    }
    throw new Error(`Pod ${podId} SSH not ready within ${timeoutMs}ms`)
  }

  private async _getSshInfo(podId: string): Promise<SshInfo | null> {
    let res: Response
    try {
      res = await this._fetchWithTimeout(`https://rest.runpod.io/v1/pods/${podId}`, {
        headers: { 'Authorization': `Bearer ${this.config.apiKey}` },
      }, this.config.sshInfoTimeoutMs ?? 10_000)
    } catch {
      // Timeout or network error on a single poll — treat as not-ready.
      // _waitForSsh deadline governs the overall give-up point.
      return null
    }
    if (!res.ok) return null

    const data = await res.json() as RunPodPodStatus
    if (data.desiredStatus !== 'RUNNING') return null

    const sshPort = data.runtime?.ports?.find(p => p.privatePort === 22 && p.type === 'tcp')
    if (!sshPort) return null

    return { host: sshPort.ip, port: sshPort.publicPort, user: 'root' }
  }

  private async _terminatePod(podId: string): Promise<void> {
    await this.fetchFn(`https://rest.runpod.io/v1/pods/${podId}`, {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${this.config.apiKey}` },
    }).catch(() => {})
  }

  private async _runBackground(podId: string, input: unknown, webhook: string | undefined): Promise<void> {
    const startMs = Date.now()
    let ssh: SshTransportLike | null = null
    let sshInfo: SshInfo | null = null
    let jobSucceeded = false

    try {
      // Both inside try so _terminatePod always runs on any early failure
      sshInfo = await this._waitForSsh(podId)
      ssh = this.sshFactory(sshInfo)

      await this._waitForComfyApi(ssh)

      const promptId = await this._submitWorkflow(ssh, input)
      log.info('job submitted', { podId })
      // After job is submitted to ComfyUI
      const submitCtx = getTrace()
      if (submitCtx) {
        submitCtx.jobSubmitMs = Date.now() - submitCtx.startTs
      }
      const remotePaths = await this._awaitCompletion(ssh, promptId, this.config.jobTimeoutMs ?? 15 * 60 * 1000)

      const executionTime = Date.now() - startMs

      if (webhook) {
        await this._postWebhook(webhook, {
          id: podId,
          status: 'COMPLETED',
          output: remotePaths.map(p => ({ path: p })),
          executionTime,
        })
      }
      jobSucceeded = true
    } finally {
      await ssh?.close().catch(() => {})
      if (jobSucceeded && this.config.keepWarm && this.materiae && sshInfo) {
        await this.materiae.create({
          genus: 'runpod',
          externusId: podId,
          gpu: this.config.gpuTypeIds[0] ?? '',
          vramGb: 0,
          ramGb: 0,
          imageRef: this.config.imageName,
          sshHost: sshInfo.host,
          sshPort: sshInfo.port,
          impetusPerSecond: this.config.impetusPerSecond ?? 0n,
          status: 'idle',
        }).catch(() => {})   // best-effort — don't fail the job over registration
      } else {
        await this._terminatePod(podId)
      }
    }
  }

  private async _waitForComfyApi(ssh: SshTransportLike): Promise<void> {
    const timeoutMs = this.config.comfyReadyTimeoutMs ?? 5 * 60 * 1000
    const pollMs = this.config.comfyPollIntervalMs ?? 2000
    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline) {
      try {
        const out = await ssh.exec(
          `curl -sf http://localhost:${COMFYUI_PORT}/system_stats`,
          { stdio: 'pipe', timeout: 5000 },
        )
        if (out && out.includes('system')) return
      } catch (_) {
        // not ready yet — retry until deadline
      }
      await sleep(pollMs)
    }
    throw new Error('ComfyUI API never came up')
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

  private async _awaitCompletion(
    ssh: SshTransportLike,
    promptId: string | null,
    timeoutMs: number,
  ): Promise<string[]> {
    const pollMs = this.config.comfyPollIntervalMs ?? 2000
    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline) {
      try {
        const out = await ssh.exec(
          `curl -sf http://localhost:${COMFYUI_PORT}/history`,
          { stdio: 'pipe', timeout: 5000 },
        )
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

// ---------------------------------------------------------------------------
// Default SSH factory — uses the system ssh binary via SshTransport.js
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SshTransportCtor = new (opts: { host: string; port: number; username: string; privateKeyPath: string }) => SshTransportLike
let _SshTransport: SshTransportCtor | null = null

function loadSshTransport(): SshTransportCtor {
  if (!_SshTransport) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    _SshTransport = require('../core/services/remote/SshTransport.js') as SshTransportCtor
  }
  return _SshTransport
}

export function makeSecurePodSshFactory(sshKeyPath: string): (info: SshInfo) => SshTransportLike {
  return (info: SshInfo) => {
    const Ctor = loadSshTransport()
    return new Ctor({ host: info.host, port: info.port, username: info.user, privateKeyPath: sshKeyPath })
  }
}
