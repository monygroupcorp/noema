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
    // Poll until the pod is actually allocated to a machine. SECURE pods never get publicIp;
    // proxy URL {podId}-8080.proxy.runpod.net becomes live once the machine field is populated.
    await this._waitForMachine(podId)
    log.info('pod allocated', { podId })
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
    const cloudType  = this.config.cloudType ?? 'SECURE'
    const gpuTypeId  = this.config.gpuTypeIds?.[0] ?? DEFAULT_GPU_TYPE
    const envVars    = [
      { key: 'SESSION_ID',        value: sessionId },
      { key: 'PLATFORM_CALLBACK', value: this.config.platformCallback },
      { key: 'WG_CLIENT_PUBKEY',  value: wgClientPublicKey },
    ]

    // GraphQL API supports dockerArgs (REST v1 does not).
    // NET_ADMIN is required for WireGuard interface creation in entrypoint.sh.
    const envGql = envVars.map(e => `{ key: "${e.key}", value: ${JSON.stringify(e.value)} }`).join(', ')
    const query = `
      mutation {
        podFindAndDeployOnDemand(input: {
          name: "noema-tee-${sessionId.slice(0, 8)}"
          imageName: "${this.config.imageId}"
          gpuCount: 1
          cloudType: ${cloudType}
          containerDiskInGb: ${this.config.containerDiskGb ?? 40}
          ports: "8080/http"
          supportPublicIp: true
          dockerArgs: "--cap-add NET_ADMIN"
          gpuTypeId: "${gpuTypeId}"
          env: [${envGql}]
        }) {
          id
          costPerHr
        }
      }
    `

    const res = await fetch(`${RUNPOD_GQL_API}?api_key=${this.config.apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query }),
    })

    if (!res.ok) {
      const text = await res.text().catch(() => '')
      throw new Error(`RunPod pod creation failed: ${res.status} ${text}`)
    }

    const json = await res.json() as {
      data?: { podFindAndDeployOnDemand?: { id: string; costPerHr?: number } }
      errors?: Array<{ message: string }>
    }
    if (json.errors?.length) throw new Error(`RunPod error: ${json.errors.map(e => e.message).join(', ')}`)
    const pod = json.data?.podFindAndDeployOnDemand
    if (!pod?.id) throw new Error(`RunPod returned no pod id: ${JSON.stringify(json)}`)
    return { podId: pod.id, costPerHrUsd: pod.costPerHr }
  }

  private async _waitForMachine(podId: string): Promise<void> {
    const deadline = Date.now() + MACHINE_TIMEOUT_MS
    while (Date.now() < deadline) {
      await sleep(MACHINE_POLL_MS)
      try {
        const res = await fetch(`${RUNPOD_REST_API}/pods/${podId}`, {
          headers: { 'Authorization': `Bearer ${this.config.apiKey}` },
        })
        if (res.ok) {
          const data = await res.json() as { machine?: Record<string, unknown> }
          if (data.machine && Object.keys(data.machine).length > 0) return
        }
      } catch { /* network blip — retry */ }
    }
    // No GPU became available — terminate to avoid ongoing charges and fail fast.
    await this.terminate(podId)
    throw new Error('No SECURE GPU available — pod queued for >5 min, terminated')
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms))
}
