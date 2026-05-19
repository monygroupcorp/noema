import fs from 'node:fs'
import path from 'node:path'
import type { RunPodClient } from './RunPodCursor.js'
import type { MateriaStore } from '../types/materia.js'
import { makeLogger } from '../lib/logger.js'
import { getTrace } from '../lib/trace.js'
import { bus } from '../lib/bus.js'

const RUNNER_SCRIPT_PATH = path.resolve(__dirname, '../../scripts/pod/runner.py')

const log = makeLogger('cursor:runpod:secure')

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface R2Config {
  accountId: string
  accessKeyId: string
  secretAccessKey: string
  bucket: string
  publicUrl?: string
}

// Ordered by preference: 24GB VRAM SECURE-tier GPUs first, then fallbacks
// All GPUs with ≥24 GB VRAM — needed for the full BF16 FLUX model.
// Ordered roughly by expected speed (fastest/most available first).
const DEFAULT_GPU_TYPE_IDS = [
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
  'NVIDIA A30',
  'NVIDIA H100 PCIe',
  'NVIDIA H100 NVL',
  'NVIDIA H100 80GB HBM3',
  'NVIDIA RTX A4500',
  'NVIDIA RTX 4000 Ada Generation',
]

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
}

interface RunPodPodStatus {
  desiredStatus?: string
  publicIp?: string
  portMappings?: Record<string, number>
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
    // Derive image from spec if available, else fall back to config
    const specOciRef = isCompiledSpec(params.input)
      ? ((params.input as unknown as { image?: { ociRef?: string } }).image?.ociRef)
      : undefined
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
    const runWithRetry = async () => {
      try {
        await this._runBackground(podId!, imageName, params.input, params.webhook)
      } catch (firstErr) {
        log.warn(`pod run attempt 1/${maxAttempts} failed`, { podId, error: (firstErr as Error).message })
        for (let attempt = 2; attempt <= maxAttempts; attempt++) {
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
          try {
            await this._runBackground(retryPodId, imageName, params.input, params.webhook, podId)
            return
          } catch (runErr) {
            log.warn(`pod run attempt ${attempt}/${maxAttempts} failed`, { podId: retryPodId, error: (runErr as Error).message })
            if (attempt === maxAttempts) throw runErr
          }
        }
      }
    }

    runWithRetry().catch(async (err) => {
      log.error(`Pod ${activePodId} failed`, { podId: activePodId, error: (err as Error).message })
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
    log.debug('pod status poll', {
      podId,
      desiredStatus: data.desiredStatus,
      publicIp: data.publicIp,
      portMappings: data.portMappings,
    })
    if (data.desiredStatus !== 'RUNNING') return null
    if (!data.publicIp) return null

    const sshPort = data.portMappings?.['22']
    if (!sshPort) return null

    return { host: data.publicIp, port: sshPort, user: 'root' }
  }

  private async _terminatePod(podId: string): Promise<void> {
    try {
      // Stop first (required if RUNNING), then delete to fully remove it
      await this._fetchWithTimeout(`https://rest.runpod.io/v1/pods/${podId}/stop`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${this.config.apiKey}` },
      }, 15_000).catch(() => {})

      const res = await this._fetchWithTimeout(`https://rest.runpod.io/v1/pods/${podId}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${this.config.apiKey}` },
      }, 15_000)
      if (!res.ok) {
        const text = await res.text().catch(() => '')
        log.warn('pod delete failed', { podId, status: res.status, body: text })
      } else {
        log.info('pod terminated', { podId })
      }
    } catch (err) {
      log.warn('pod terminate error', { podId, error: (err as Error).message })
    }
  }

  // externusJobId: the job ID stored on the actum (always the first pod's ID, even on retries)
  private async _runBackground(podId: string, imageName: string, input: unknown, webhook: string | undefined, externusJobId?: string): Promise<void> {
    const startMs = Date.now()
    let ssh: SshTransportLike | null = null
    let sshInfo: SshInfo | null = null
    const emitStage = (stage: string) => {
      const ctx = getTrace()
      if (ctx?.actumId) bus.emit('actum.stage', { actumId: ctx.actumId, stage, elapsedMs: Date.now() - startMs })
    }
    let jobSucceeded = false

    try {
      // Both inside try so _terminatePod always runs on any early failure
      emitStage('provisioning')
      sshInfo = await this._waitForSsh(podId)
      emitStage('ssh-ready')
      ssh = await this._waitForSshd(sshInfo)

      // If input is a full CompiledSpec (has workflow.inputTemplate), bootstrap ComfyUI first
      const spec = isCompiledSpec(input) ? input : null
      const workflowInput = spec ? spec.workflow.inputTemplate : input

      if (spec) {
        emitStage('bootstrapping')
        await this._bootstrap(ssh, spec, podId)
      }

      emitStage('comfy-ready')
      await this._waitForComfyApi(ssh)

      const promptId = await this._submitWorkflow(ssh, workflowInput)
      emitStage('inferring')
      log.info('job submitted', { podId })
      // After job is submitted to ComfyUI
      const submitCtx = getTrace()
      if (submitCtx) {
        submitCtx.jobSubmitMs = Date.now() - submitCtx.startTs
      }
      const remotePaths = await this._awaitCompletion(ssh, promptId, this.config.jobTimeoutMs ?? 15 * 60 * 1000)

      const executionTime = Date.now() - startMs

      let outputItems: Array<{ url: string } | { path: string }>
      if (this.config.r2 && remotePaths.length > 0) {
        outputItems = await this._uploadToR2(ssh, remotePaths)
      } else {
        outputItems = remotePaths.map(p => ({ path: p }))
      }

      if (webhook) {
        await this._postWebhook(webhook, {
          id: externusJobId ?? podId,
          status: 'COMPLETED',
          output: outputItems,
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
          gpu: (this.config.gpuTypeIds ?? DEFAULT_GPU_TYPE_IDS)[0] ?? '',
          vramGb: 0,
          ramGb: 0,
          imageRef: imageName,
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

  /** Returns the runner.py HTTP base URL for a given pod ID. */
  static runnerBase(podId: string): string {
    return `https://${podId}-8080.proxy.runpod.net`
  }

  /** Poll runner.py /health until it reports 'ready'. */
  private async _waitForRunner(runnerBase: string): Promise<void> {
    const timeoutMs = this.config.comfyReadyTimeoutMs ?? 5 * 60 * 1000
    const pollMs = this.config.comfyPollIntervalMs ?? 2000
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
    throw new Error('runner.py did not become ready within timeout')
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

  private async _bootstrap(ssh: SshTransportLike, spec: CompiledSpecLike, podId: string): Promise<void> {
    log.info('bootstrapping ComfyUI')

    // Install git if not present, clone ComfyUI
    await ssh.exec('which git || (apt-get update -qq && apt-get install -y -qq git)', { timeout: 120_000 })
    await ssh.exec('cd /root && rm -rf ComfyUI && git clone --depth 1 https://github.com/comfyanonymous/ComfyUI.git', { timeout: 120_000 })
    await ssh.exec('cd /root/ComfyUI && pip install -r requirements.txt -q', { timeout: 600_000 })

    // Start ComfyUI in background before downloading models (parallel speedup)
    await ssh.exec(
      'cd /root/ComfyUI && nohup python main.py --listen 0.0.0.0 --port 8188 >> /tmp/comfyui.log 2>&1 &',
      { timeout: 5_000 },
    ).catch(() => {})

    // Upload runner.py and start it alongside ComfyUI
    try {
      const runnerScript = fs.readFileSync(RUNNER_SCRIPT_PATH, 'utf8')
      const b64 = Buffer.from(runnerScript).toString('base64').replace(/\n/g, '')
      await ssh.exec(`echo '${b64}' | base64 -d > /root/runner.py && chmod +x /root/runner.py`, { timeout: 10_000 })
      await ssh.exec(
        `RUNPOD_POD_ID=${podId} nohup python3 /root/runner.py >> /tmp/runner.log 2>&1 &`,
        { timeout: 5_000 },
      )
      log.info('runner.py started', { podId })
    } catch (err) {
      log.warn('runner.py upload/start failed — warm reuse unavailable', { error: (err as Error).message })
    }

    // Download models in parallel. Per-model timeout is derived from sizeBytes so large
    // models get proportionally more time. Assumes 5 MB/s minimum per stream with 1.5x buffer.
    // Fallback for models without sizeBytes: 40 min.
    const MIN_BYTES_PER_SEC = 5 * 1024 * 1024
    await Promise.all(spec.models.map(async (model) => {
      const destPath = `/root/ComfyUI/models/${model.dest}`
      const timeoutMs = model.sizeBytes
        ? Math.max(900_000, Math.ceil(model.sizeBytes / MIN_BYTES_PER_SEC * 1.5 * 1000))
        : 2_400_000
      await ssh.exec(`mkdir -p "$(dirname '${destPath}')"`, { timeout: 10_000 })
      await ssh.exec(`wget -q "${model.url}" -O "${destPath}"`, { timeout: timeoutMs })
      log.info('model downloaded', { dest: model.dest })
    }))
  }

  private async _uploadToR2(
    ssh: SshTransportLike,
    remotePaths: string[],
  ): Promise<Array<{ url: string }>> {
    const { S3Client, PutObjectCommand } = await import('@aws-sdk/client-s3')
    const r2 = this.config.r2!
    const client = new S3Client({
      region: 'auto',
      endpoint: `https://${r2.accountId}.r2.cloudflarestorage.com`,
      credentials: { accessKeyId: r2.accessKeyId, secretAccessKey: r2.secretAccessKey },
    })

    const CONTENT_TYPES: Record<string, string> = {
      png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg',
      webp: 'image/webp', gif: 'image/gif',
      mp4: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime',
    }

    const results: Array<{ url: string }> = []
    for (const remotePath of remotePaths) {
      const filename = remotePath.split('/').pop()!
      const ext = filename.split('.').pop()?.toLowerCase() ?? ''
      const contentType = CONTENT_TYPES[ext] ?? 'application/octet-stream'

      const b64 = await ssh.exec(`base64 -w0 "${remotePath}"`, { stdio: 'pipe', timeout: 60_000 })
      if (!b64) {
        log.warn('empty base64 output for remote file', { remotePath })
        continue
      }
      const buffer = Buffer.from(b64.trim(), 'base64')
      const key = `outputs/${Date.now()}-${filename}`

      await client.send(new PutObjectCommand({
        Bucket: r2.bucket,
        Key: key,
        Body: buffer,
        ContentType: contentType,
      }))

      const base = r2.publicUrl ? r2.publicUrl.replace(/\/$/, '') : `https://${r2.bucket}.r2.dev`
      results.push({ url: `${base}/${key}` })
      log.info('output uploaded to R2', { key, size: buffer.byteLength })
    }
    return results
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
