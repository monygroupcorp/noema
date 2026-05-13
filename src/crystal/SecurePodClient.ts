import type { RunPodClient } from './RunPodCursor.js'
import type { MateriaStore } from '../types/materia.js'

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
  sshReadyTimeoutMs?: number     // default: 10 min
  sshPollIntervalMs?: number     // default: 8000
  comfyReadyTimeoutMs?: number   // default: 5 min
  comfyPollIntervalMs?: number   // default: 2000
  jobTimeoutMs?: number          // default: 15 min
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
    const podId = await this._provisionPod()

    this._runBackground(podId, params.input, params.webhook).catch(async (err) => {
      console.error(`[SecurePodClient] Pod ${podId} failed: ${(err as Error).message}`)
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

  private async _provisionPod(): Promise<string> {
    const res = await this.fetchFn('https://rest.runpod.io/v1/pods', {
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
    })

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
      if (info) return info
      await sleep(pollMs)
    }
    throw new Error(`Pod ${podId} SSH not ready within ${timeoutMs}ms`)
  }

  private async _getSshInfo(podId: string): Promise<SshInfo | null> {
    const res = await this.fetchFn(`https://rest.runpod.io/v1/pods/${podId}`, {
      headers: { 'Authorization': `Bearer ${this.config.apiKey}` },
    })
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
    const sshInfo = await this._waitForSsh(podId)
    const ssh = this.sshFactory(sshInfo)
    const jobTimeoutMs = this.config.jobTimeoutMs ?? 15 * 60 * 1000
    let jobSucceeded = false

    try {
      await this._waitForComfyApi(ssh)

      const promptId = await this._submitWorkflow(ssh, input)
      const remotePaths = await this._awaitCompletion(ssh, promptId, jobTimeoutMs)

      const executionTime = Date.now() - startMs

      if (webhook) {
        await this.fetchFn(webhook, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            id: podId,
            status: 'COMPLETED',
            output: remotePaths.map(p => ({ path: p })),
            executionTime,
          }),
        })
      }
      jobSucceeded = true
    } finally {
      await ssh.close().catch(() => {})
      if (jobSucceeded && this.config.keepWarm && this.materiae) {
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

import { createRequire } from 'node:module'

const _require = createRequire(import.meta.url)

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SshTransportCtor = new (opts: { host: string; port: number; username: string; privateKeyPath: string }) => SshTransportLike
let _SshTransport: SshTransportCtor | null = null

function loadSshTransport(): SshTransportCtor {
  if (!_SshTransport) {
    _SshTransport = _require('../core/services/remote/SshTransport.js') as SshTransportCtor
  }
  return _SshTransport
}

export function makeSecurePodSshFactory(sshKeyPath: string): (info: SshInfo) => SshTransportLike {
  return (info: SshInfo) => {
    const Ctor = loadSshTransport()
    return new Ctor({ host: info.host, port: info.port, username: info.user, privateKeyPath: sshKeyPath })
  }
}
