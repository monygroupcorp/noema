// =============================================================================
// ConfidentialPodClient — the hardware-sealed sibling of TeeProvisioner.
// =============================================================================
//
// Targets Azure NCCads_H100_v5 confidential VMs (AMD SEV-SNP CPU + H100 NVL in
// CC-On mode) — the substrate decided in docs/plans/2026-07-02-tee-hardware-path.md.
//
// Pure on-demand (plan decision 3): the pool is a small set of PRE-CREATED CVMs
// that sit deallocated (disk-only billing). provision() picks a free one, stamps
// the session parameters as VM tags (the guest reads them from IMDS at boot —
// a deallocated VM's env can't change per session), and starts it. terminate()
// deallocates — compute billing stops. No warm pool: an idle H100 CVM burning
// ~5× a 4090 is the one thing that crushes the economics.
//
// Capacity = pool size + regional availability. When nothing is free we throw
// a clear "no sealed capacity" error rather than queueing silently (plan §6).
//
// NOT live-verified — blocked on plan step 1 (Azure NCC quota/access).
// =============================================================================

import type { TeePodProvisioner, TeeProvisionResult, TeeIngress } from './TeePodProvisioner.js'
import { makeLogger } from '../lib/logger.js'

const log = makeLogger('tee:confidential')

const ARM_API_VERSION      = '2024-07-01'
/** Microsoft.Resources/tags — the merge-patch tags endpoint (VM-level PATCH would REPLACE all tags). */
const TAGS_API_VERSION     = '2022-09-01'
const DEALLOCATE_ATTEMPTS  = 4
const DEALLOCATE_BACKOFF_MS = 5_000
/** How long to poll after an accepted (202) deallocate for the LRO to actually finish. */
const DEALLOCATE_CONFIRM_MS = 5 * 60_000

export interface ConfidentialPodClientConfig {
  /** Service-principal client-credentials auth against ARM. */
  tenantId: string
  clientId: string
  clientSecret: string
  subscriptionId: string
  resourceGroup: string
  /** Names of the pre-created NCCads_H100_v5 CVMs the pool draws from. */
  vmNames: string[]
  /** Public URL the pod calls back to. Stamped as a VM tag, read via IMDS. */
  platformCallback: string
  /** On-demand USD/hr for the CVM size — billing rate for the session. */
  costPerHrUsd: number
  /**
   * Browser-facing tunnel ingress template with a `{vm}` placeholder, e.g.
   * "socks5+wss://{vm}.tee.noema.art/?gost&insecureudp". We own this ingress
   * (TLS terminated on or in front of the VM) — no RunPod-style proxy. Absent → the runner's
   * self-reported endpoint is used (dev only; production must set it).
   */
  ingressProxyUrlTemplate?: string
  /** Overridable for tests. */
  managementUrl?: string
  loginUrl?: string
  startPollMs?: number
  startTimeoutMs?: number
  deallocateBackoffMs?: number
  deallocateConfirmMs?: number
}

export class ConfidentialPodClient implements TeePodProvisioner {
  /** VMs claimed by an in-flight session — reserved synchronously so two provisions never race one VM. */
  private readonly inUse = new Set<string>()
  private token?: { value: string; expiresAt: number }

  constructor(
    private readonly config: ConfidentialPodClientConfig,
    private readonly fetchFn: typeof fetch = fetch,
  ) {}

  async provision(
    sessionId: string,
    wgClientPublicKey: string,
    onPodCreated?: (podId: string) => void,
    runnerToken?: string,
  ): Promise<TeeProvisionResult> {
    const vmName = await this._claimFreeVm()
    try {
      // Session parameters ride as tags because a deallocated VM has no per-boot
      // env channel; the guest entrypoint reads them from IMDS
      // (169.254.169.254/metadata/instance/compute/tags) before starting the runner.
      await this._patchTags(vmName, {
        noemaSessionId:        sessionId,
        noemaPlatformCallback: this.config.platformCallback,
        noemaWgClientPubkey:   wgClientPublicKey,
        ...(runnerToken ? { noemaRunnerToken: runnerToken } : {}),
      })
      onPodCreated?.(vmName)
      await this._start(vmName)
      log.info('CVM running', { vmName, sessionId })
      return { podId: vmName, costPerHrUsd: this.config.costPerHrUsd }
    } catch (err) {
      // Leave nothing allocated on a failed provision — an orphaned H100 CVM burns money.
      await this.terminate(vmName).catch(() => {})
      throw err
    }
  }

  /** We own the WSS ingress — no proxy that could strip the Upgrade header. */
  async probeWSUpgrade(_podId: string): Promise<boolean> {
    return true
  }

  ingress(podId: string): TeeIngress | null {
    const template = this.config.ingressProxyUrlTemplate
    if (!template) return null
    return {
      proxyUrl: template.replaceAll('{vm}', podId),
      endpoint: '127.0.0.1:51820',
    }
  }

  /**
   * Deallocate — stops compute billing (disks only). Idempotent and retried:
   * "already deallocated" is success, transient ARM errors back off and retry.
   *
   * A 202 Accepted only means Azure accepted the long-running operation — the
   * deallocation can still fail afterwards, which would leave the H100 silently
   * billing. So an accepted request is CONFIRMED by polling the power state until
   * 'deallocated'; an unconfirmed round retries the deallocate, and exhausting all
   * attempts throws loudly.
   */
  async terminate(vmName: string): Promise<void> {
    const backoff = this.config.deallocateBackoffMs ?? DEALLOCATE_BACKOFF_MS
    try {
      for (let attempt = 1; ; attempt++) {
        const res = await this._arm('POST', `${this._vmUrl(vmName)}/deallocate`).catch((err: unknown) => {
          log.warn('deallocate request failed', { vmName, attempt, err: String(err) })
          return undefined
        })
        // Accepted (or 404 gone / 409 already-in-progress) → confirm the VM actually
        // left the billing state before declaring success.
        const accepted = res && (res.ok || res.status === 202 || res.status === 404 || res.status === 409)
        if (accepted && await this._confirmDeallocated(vmName)) return
        if (accepted) log.warn('deallocate accepted but never confirmed — retrying', { vmName, attempt })
        if (attempt >= DEALLOCATE_ATTEMPTS) {
          throw new Error(`CVM ${vmName} deallocate failed after ${DEALLOCATE_ATTEMPTS} attempts — check the Azure portal, it may still be billing`)
        }
        await sleep(backoff * attempt)
      }
    } finally {
      this.inUse.delete(vmName)
    }
  }

  /** Poll until the VM is out of the compute-billing state. False = LRO never finished. */
  private async _confirmDeallocated(vmName: string): Promise<boolean> {
    const pollMs   = this.config.startPollMs ?? 10_000
    const deadline = Date.now() + (this.config.deallocateConfirmMs ?? DEALLOCATE_CONFIRM_MS)
    while (Date.now() < deadline) {
      const state = await this._powerState(vmName).catch(() => 'unknown')
      if (state === 'deallocated' || state === 'gone') return true
      await sleep(pollMs)
    }
    return false
  }

  // ── pool ───────────────────────────────────────────────────────────────────

  private async _claimFreeVm(): Promise<string> {
    for (const vmName of this.config.vmNames) {
      if (this.inUse.has(vmName)) continue
      this.inUse.add(vmName)   // reserve before the async state check so concurrent provisions can't double-claim
      const state = await this._powerState(vmName).catch(err => {
        log.warn('power state check failed', { vmName, err: String(err) })
        return 'unknown'
      })
      if (state === 'deallocated') return vmName
      this.inUse.delete(vmName)
    }
    throw new Error('No sealed capacity available right now — all confidential VMs are in use. Try again shortly.')
  }

  // ── ARM plumbing ───────────────────────────────────────────────────────────

  private _vmUrl(vmName: string): string {
    const { subscriptionId, resourceGroup } = this.config
    const base = this.config.managementUrl ?? 'https://management.azure.com'
    return `${base}/subscriptions/${subscriptionId}/resourceGroups/${resourceGroup}` +
      `/providers/Microsoft.Compute/virtualMachines/${vmName}`
  }

  private async _patchTags(vmName: string, tags: Record<string, string>): Promise<void> {
    // Merge via Microsoft.Resources/tags — a PATCH on the VM resource itself would
    // REPLACE the whole tag collection, wiping operator cost/governance tags on the
    // pooled CVM (and tripping any require-tag Azure Policy).
    const res = await this._arm(
      'PATCH',
      `${this._vmUrl(vmName)}/providers/Microsoft.Resources/tags/default`,
      { operation: 'Merge', properties: { tags } },
      TAGS_API_VERSION,
    )
    if (!res.ok) throw new Error(`CVM ${vmName} tag update failed: ${res.status} ${await res.text().catch(() => '')}`)
  }

  private async _start(vmName: string): Promise<void> {
    const res = await this._arm('POST', `${this._vmUrl(vmName)}/start`)
    if (!res.ok && res.status !== 202) {
      throw new Error(`CVM ${vmName} start failed: ${res.status} ${await res.text().catch(() => '')}`)
    }
    // CVM boot is the multi-minute part of the cold start the plan accepts (§6);
    // the runner's /runner/ready callback is what actually readies the session —
    // we only wait for the VM to reach 'running' so a stuck allocation fails loudly.
    const pollMs   = this.config.startPollMs ?? 10_000
    const deadline = Date.now() + (this.config.startTimeoutMs ?? 10 * 60 * 1_000)
    while (Date.now() < deadline) {
      await sleep(pollMs)
      const state = await this._powerState(vmName).catch(() => 'unknown')
      if (state === 'running') return
      if (state === 'gone') throw new Error(`CVM ${vmName} disappeared while starting`)
    }
    throw new Error(`CVM ${vmName} did not reach 'running' in time — no sealed capacity, try again later`)
  }

  /** 'deallocated' | 'deallocating' | 'running' | 'starting' | 'gone' | raw code tail */
  private async _powerState(vmName: string): Promise<string> {
    const res = await this._arm('GET', `${this._vmUrl(vmName)}/instanceView`)
    if (res.status === 404) return 'gone'
    if (!res.ok) throw new Error(`instanceView ${vmName}: ${res.status}`)
    const view = await res.json() as { statuses?: Array<{ code?: string }> }
    const power = view.statuses?.find(s => s.code?.startsWith('PowerState/'))
    return power?.code?.slice('PowerState/'.length) ?? 'unknown'
  }

  private async _arm(method: string, url: string, body?: unknown, apiVersion = ARM_API_VERSION): Promise<Response> {
    const token = await this._getToken()
    const sep = url.includes('?') ? '&' : '?'
    return this.fetchFn(`${url}${sep}api-version=${apiVersion}`, {
      method,
      headers: {
        'Authorization': `Bearer ${token}`,
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    })
  }

  private async _getToken(): Promise<string> {
    if (this.token && Date.now() < this.token.expiresAt) return this.token.value
    const { tenantId, clientId, clientSecret } = this.config
    const loginBase = this.config.loginUrl ?? 'https://login.microsoftonline.com'
    const scope = `${this.config.managementUrl ?? 'https://management.azure.com'}/.default`
    const res = await this.fetchFn(`${loginBase}/${tenantId}/oauth2/v2.0/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: clientId,
        client_secret: clientSecret,
        scope,
      }).toString(),
    })
    if (!res.ok) throw new Error(`Azure token request failed: ${res.status} ${await res.text().catch(() => '')}`)
    const data = await res.json() as { access_token: string; expires_in: number }
    this.token = { value: data.access_token, expiresAt: Date.now() + (data.expires_in - 60) * 1_000 }
    return data.access_token
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms))
}
