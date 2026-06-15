// =============================================================================
// TeeProvisioner — boots a TEE runner pod on RunPod and returns its identity.
// =============================================================================
//
// Unlike SecurePodClient (which SSHes in to bootstrap), TEE pods are
// self-bootstrapping: the Docker image runs entrypoint.sh as PID 1, which
// generates a WireGuard keypair, starts gost, and launches runner.py. The
// runner then calls PLATFORM_CALLBACK/runner/ready with its WG public key.
//
// This class only needs to: start the pod → wait for a public IP → done.
// The session transitions to 'ready' via the /runner/ready callback, not here.
// =============================================================================

import { makeLogger } from '../lib/logger.js'

const log = makeLogger('tee:provisioner')

const RUNPOD_API = 'https://rest.runpod.io/v1'
const POLL_INTERVAL_MS = 8_000
const PROVISION_TIMEOUT_MS = 10 * 60 * 1_000

export interface TeeProvisionerConfig {
  apiKey: string
  /** Docker image for the TEE runner (e.g. "monyrth/tee-runner:latest"). */
  imageId: string
  /** Public URL the pod calls back to (e.g. "https://api.noema.ai"). No trailing slash. */
  platformCallback: string
  /** RunPod GPU type IDs to request. If omitted, RunPod picks any available. */
  gpuTypeIds?: string[]
  cloudType?: string
  containerDiskGb?: number
  provisionTimeoutMs?: number
  pollIntervalMs?: number
}

export interface TeeProvisionResult {
  podId: string
  publicIp: string
  /** USD/hr from the RunPod API — set as costPerHrUsd on the TeeSession for billing. */
  costPerHrUsd?: number
}

interface RunPodStatus {
  desiredStatus?: string
  publicIp?: string
  costPerHr?: number
  machine?: { gpuDisplayName?: string; dataCenterId?: string }
  portMappings?: Record<string, number>
}

export class TeeProvisioner {
  constructor(private readonly config: TeeProvisionerConfig) {}

  async provision(
    sessionId: string,
    wgClientPublicKey: string,
  ): Promise<TeeProvisionResult> {
    const podId = await this._startPod(sessionId, wgClientPublicKey)
    log.info('pod created', { podId, sessionId })
    const { publicIp, costPerHrUsd } = await this._waitForIp(podId)
    log.info('pod running', { podId, publicIp, costPerHrUsd })
    return { podId, publicIp, costPerHrUsd }
  }

  async terminate(podId: string): Promise<void> {
    const res = await fetch(`${RUNPOD_API}/pods/${podId}`, {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${this.config.apiKey}` },
    })
    if (!res.ok) {
      const text = await res.text().catch(() => '')
      log.warn('terminate failed', { podId, status: res.status, text })
    }
  }

  private async _startPod(sessionId: string, wgClientPublicKey: string): Promise<string> {
    const body: Record<string, unknown> = {
      name: `noema-tee-${sessionId.slice(0, 8)}`,
      imageName: this.config.imageId,
      gpuCount: 1,
      cloudType: this.config.cloudType ?? 'SECURE',
      containerDiskInGb: this.config.containerDiskGb ?? 40,
      // Only gost (TCP 8080) needs to be public — WireGuard tunnels through it.
      ports: ['8080/http'],
      supportPublicIp: true,
      env: [
        { key: 'SESSION_ID',        value: sessionId },
        { key: 'PLATFORM_CALLBACK', value: this.config.platformCallback },
        { key: 'WG_CLIENT_PUBKEY',  value: wgClientPublicKey },
        // WG_ENDPOINT is set by the provisioner after we learn the pod's public IP,
        // but we can't know it yet. The runner defaults to 127.0.0.1:51820 and the
        // /runner/ready callback uses the env var if set, or falls back. We patch it
        // on the session via handleRunnerReady using the actual endpoint the runner reports.
      ],
    }
    if (this.config.gpuTypeIds) body.gpuTypeIds = this.config.gpuTypeIds

    const res = await fetch(`${RUNPOD_API}/pods`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.config.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    })

    if (!res.ok) {
      const text = await res.text().catch(() => '')
      throw new Error(`RunPod pod creation failed: ${res.status} ${text}`)
    }

    const data = await res.json() as { id: string }
    return data.id
  }

  private async _waitForIp(podId: string): Promise<{ publicIp: string; costPerHrUsd?: number }> {
    const timeout = this.config.provisionTimeoutMs ?? PROVISION_TIMEOUT_MS
    const pollMs  = this.config.pollIntervalMs    ?? POLL_INTERVAL_MS
    const deadline = Date.now() + timeout

    while (Date.now() < deadline) {
      const info = await this._pollStatus(podId)
      if (info) return info
      await sleep(pollMs)
    }
    throw new Error(`TEE pod ${podId} did not get a public IP within ${timeout}ms`)
  }

  private async _pollStatus(podId: string): Promise<{ publicIp: string; costPerHrUsd?: number } | null> {
    let res: Response
    try {
      res = await fetch(`${RUNPOD_API}/pods/${podId}`, {
        headers: { 'Authorization': `Bearer ${this.config.apiKey}` },
      })
    } catch {
      return null
    }
    if (!res.ok) return null

    const data = await res.json() as RunPodStatus
    if (data.desiredStatus !== 'RUNNING' || !data.publicIp) return null

    return {
      publicIp:     data.publicIp,
      costPerHrUsd: data.costPerHr,
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms))
}
