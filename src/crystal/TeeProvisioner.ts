// =============================================================================
// TeeProvisioner — boots a TEE runner pod on RunPod and returns its identity.
// =============================================================================
//
// Unlike SecurePodClient (which SSHes in to bootstrap), TEE pods are
// self-bootstrapping: the Docker image runs entrypoint.sh as PID 1, which
// generates a WireGuard keypair, starts gost, and launches runner.py. The
// runner then calls PLATFORM_CALLBACK/runner/ready with its WG public key.
//
// This class only needs to: start the pod → return the podId + cost rate → done.
// The session transitions to 'ready' via the /runner/ready callback from the pod.
// =============================================================================

import { makeLogger } from '../lib/logger.js'

const log = makeLogger('tee:provisioner')

const RUNPOD_REST_API    = 'https://rest.runpod.io/v1'
const RUNPOD_GQL_API     = 'https://api.runpod.io/graphql'
const MACHINE_POLL_MS    = 8_000
const MACHINE_TIMEOUT_MS = 5 * 60 * 1_000
const DEFAULT_GPU_TYPE   = 'NVIDIA GeForce RTX 4090'

export interface TeeProvisionerConfig {
  apiKey: string
  /** Docker image for the TEE runner (e.g. "monygroup/tee-runner:latest"). */
  imageId: string
  /** Public URL the pod calls back to (e.g. "https://staging.noema.art"). No trailing slash. */
  platformCallback: string
  /** RunPod GPU type IDs to request. Defaults to RTX 4090. */
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
    // Poll via GraphQL runtime field until the container is actually running.
    // SECURE pods never get publicIp; proxy URL {podId}-8080.proxy.runpod.net
    // becomes live once runtime is non-null.
    await this._waitForRuntime(podId)
    log.info('pod running', { podId })
    return { podId, costPerHrUsd }
  }

  async terminate(podId: string): Promise<void> {
    const res = await fetch(`${RUNPOD_REST_API}/pods/${podId}`, {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${this.config.apiKey}` },
    })
    if (!res.ok) {
      const text = await res.text().catch(() => '')
      log.warn('terminate failed', { podId, status: res.status, text })
    }
  }

  private async _startPod(sessionId: string, wgClientPublicKey: string): Promise<{ podId: string; costPerHrUsd?: number }> {
    // REST v1 is used for SECURE cloud (podFindAndDeployOnDemand GQL creates community pods).
    // SECURE pods on dedicated hardware have NET_ADMIN by default — no dockerArgs needed.
    const body: Record<string, unknown> = {
      name: `noema-tee-${sessionId.slice(0, 8)}`,
      imageName: this.config.imageId,
      gpuCount: 1,
      cloudType: this.config.cloudType ?? 'SECURE',
      containerDiskInGb: this.config.containerDiskGb ?? 40,
      ports: ['8080/http'],
      supportPublicIp: true,
      gpuTypeIds: this.config.gpuTypeIds ?? [DEFAULT_GPU_TYPE],
      env: {
        SESSION_ID:        sessionId,
        PLATFORM_CALLBACK: this.config.platformCallback,
        WG_CLIENT_PUBKEY:  wgClientPublicKey,
      },
    }

    const res = await fetch(`${RUNPOD_REST_API}/pods`, {
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

  private async _waitForRuntime(podId: string): Promise<void> {
    const deadline = Date.now() + MACHINE_TIMEOUT_MS
    while (Date.now() < deadline) {
      await sleep(MACHINE_POLL_MS)
      try {
        const res = await fetch(`${RUNPOD_GQL_API}?api_key=${this.config.apiKey}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            query: `{ pod(input: {podId: "${podId}"}) { desiredStatus runtime { uptimeInSeconds } } }`,
          }),
        })
        if (res.ok) {
          const json = await res.json() as { data?: { pod?: { desiredStatus?: string; runtime?: { uptimeInSeconds: number } | null } } }
          const pod = json.data?.pod
          log.info('pod poll', { podId, desiredStatus: pod?.desiredStatus, hasRuntime: !!pod?.runtime })
          if (pod?.runtime) return
          // Pod was terminated or failed externally
          if (pod?.desiredStatus && pod.desiredStatus !== 'RUNNING') {
            throw new Error(`Pod entered unexpected state: ${pod.desiredStatus}`)
          }
        }
      } catch (err) {
        if (err instanceof Error && err.message.startsWith('Pod entered')) throw err
        // network blip — retry
      }
    }
    await this.terminate(podId)
    throw new Error('No SECURE GPU available — pod queued for >5 min, terminated')
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms))
}
