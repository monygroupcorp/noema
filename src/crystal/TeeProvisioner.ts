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

import tls from 'tls'
import crypto from 'crypto'
import { makeLogger } from '../lib/logger.js'

const log = makeLogger('tee:provisioner')

const RUNPOD_REST_API    = 'https://rest.runpod.io/v1'
const RUNPOD_GQL_API     = 'https://api.runpod.io/graphql'
const MACHINE_POLL_MS    = 8_000
const MACHINE_TIMEOUT_MS = 5 * 60 * 1_000
const HEALTH_POLL_MS     = 3_000
const HEALTH_TIMEOUT_MS  = 60 * 1_000
const WS_PROBE_TIMEOUT_MS = 5_000
const MAX_PROVISION_ATTEMPTS = 3

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
    onPodCreated?: (podId: string) => void,
  ): Promise<TeeProvisionResult> {
    const { podId, costPerHrUsd } = await this._startPod(sessionId, wgClientPublicKey)
    // Notify caller immediately so session.podId is set before the pod's runner/ready callback
    // can arrive (which happens while _waitForRuntime is still polling).
    onPodCreated?.(podId)
    log.info('pod created', { podId, sessionId, costPerHrUsd })
    await this._waitForRuntime(podId)
    log.info('pod running', { podId })
    return { podId, costPerHrUsd }
  }

  /**
   * Probe the WS upgrade path from the server side, called from handleRunnerReady BEFORE
   * the session is marked ready. Gates the 'ready' state on actual WS connectivity so the
   * browser never receives a session that will immediately 1006.
   *
   * Returns true if the pod's proxy correctly forwards WS upgrades (Cloudflare path),
   * false if it strips the Upgrade header (RunPod nginx path — kill and let the user retry).
   */
  async probeWSUpgrade(podId: string): Promise<boolean> {
    return this._probeWSUpgrade(podId)
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
      ...(this.config.gpuTypeIds ? { gpuTypeIds: this.config.gpuTypeIds } : {}),
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

  private async _waitForHealth(podId: string): Promise<void> {
    const url = `https://${podId}-8080.proxy.runpod.net/health`
    const deadline = Date.now() + HEALTH_TIMEOUT_MS
    while (Date.now() < deadline) {
      try {
        const res = await fetch(url)
        if (res.ok) return
      } catch { /* not up yet */ }
      await sleep(HEALTH_POLL_MS)
    }
    throw new Error(`Pod ${podId} /health never returned 200 within ${HEALTH_TIMEOUT_MS / 1000}s`)
  }

  private _probeWSUpgrade(podId: string): Promise<boolean> {
    const host = `${podId}-8080.proxy.runpod.net`
    const key  = crypto.randomBytes(16).toString('base64')
    return new Promise(resolve => {
      let settled = false
      const done = (ok: boolean) => { if (!settled) { settled = true; socket.destroy(); resolve(ok) } }
      const socket = tls.connect({ host, port: 443, servername: host, ALPNProtocols: ['http/1.1'] }, () => {
        socket.write(
          `GET / HTTP/1.1\r\nHost: ${host}\r\nUpgrade: websocket\r\n` +
          `Connection: Upgrade\r\nSec-WebSocket-Key: ${key}\r\nSec-WebSocket-Version: 13\r\n\r\n`
        )
      })
      socket.once('data', chunk => done(chunk.toString().startsWith('HTTP/1.1 101')))
      socket.once('error', () => done(false))
      setTimeout(() => done(false), WS_PROBE_TIMEOUT_MS)
    })
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
