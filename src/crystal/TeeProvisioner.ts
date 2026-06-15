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

export interface TeeProvisionerConfig {
  apiKey: string
  /** Docker image for the TEE runner (e.g. "monygroup/tee-runner:latest"). */
  imageId: string
  /** Public URL the pod calls back to (e.g. "https://staging.noema.art"). No trailing slash. */
  platformCallback: string
  /** RunPod GPU type IDs to request. If omitted, RunPod picks any available. */
  gpuTypeIds?: string[]
  cloudType?: string
  containerDiskGb?: number
}

export interface TeeProvisionResult {
  podId: string
  /** USD/hr from the RunPod API — set as costPerHrUsd on the TeeSession for billing. */
  costPerHrUsd?: number
}

export class TeeProvisioner {
  constructor(private readonly config: TeeProvisionerConfig) {}

  async provision(
    sessionId: string,
    wgClientPublicKey: string,
  ): Promise<TeeProvisionResult> {
    const { podId, costPerHrUsd } = await this._startPod(sessionId, wgClientPublicKey)
    log.info('pod created', { podId, sessionId, costPerHrUsd })
    // SECURE pods never get a publicIp field — they're exposed via {podId}-8080.proxy.runpod.net.
    // The session transitions to 'ready' via /runner/ready callback from the pod; we return now.
    return { podId, costPerHrUsd }
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

  private async _startPod(sessionId: string, wgClientPublicKey: string): Promise<{ podId: string; costPerHrUsd?: number }> {
    const body: Record<string, unknown> = {
      name: `noema-tee-${sessionId.slice(0, 8)}`,
      imageName: this.config.imageId,
      gpuCount: 1,
      cloudType: this.config.cloudType ?? 'SECURE',
      containerDiskInGb: this.config.containerDiskGb ?? 40,
      // Only gost (TCP 8080) needs to be public — WireGuard tunnels through it via RunPod's HTTP proxy.
      ports: ['8080/http'],
      supportPublicIp: true,
      env: {
        SESSION_ID:        sessionId,
        PLATFORM_CALLBACK: this.config.platformCallback,
        WG_CLIENT_PUBKEY:  wgClientPublicKey,
      },
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

    const data = await res.json() as { id: string; costPerHr?: number }
    return { podId: data.id, costPerHrUsd: data.costPerHr }
  }
}
