import type { Modus, Modorum } from '../types/modus.js'
import type { Actum, ActumExecutio } from '../types/actum.js'
import type { Modo } from '../types/modo.js'
import type { Cursor, CursorResult, Actorum } from '../types/cursus.js'
import type { Materia } from '../types/materia.js'
import type { DeploymentumStore } from '../types/deploymentum.js'
import type { Praefectus } from './Praefectus.js'
import { getTrace } from '../lib/trace.js'

/**
 * RunPodClient — the injectable seam between the cursor and any GPU pod substrate.
 *
 * The real implementation provisions a RunPod SECURE pod, SSHes in, runs the
 * ComfyUI workflow, and POSTs the result to `webhook`. In tests a stub is swapped in.
 *
 * `webhook` is the ONLY thing that differs between deployment contexts (normal vs TEE).
 */
/**
 * Hosting-context the cursor hands the client at submit. Identity-bearing — the
 * client stamps it into the Hospitium side-table at warm-park, so the dispatch
 * layer can answer "who is the host" without putting animaId on Materia/Modo.
 * Sourced from the trace context, not from any durable schema.
 */
export interface ProvisioningContext {
  hostAnimaId?: string
  /** Group chat id when the provisioning originated in a group — stamped onto
   *  Materia.groupChatId for the hosting-tier dispatch decision later. */
  groupChatId?: string
}

export interface RunPodClient {
  submit(params: {
    input: unknown
    /** Where the runner POSTs the completion result.
     * Normal deployment: our server (e.g. https://api.noema.io/webhooks/runpod)
     * TEE deployment: the TEE pod's local endpoint. */
    webhook?: string
    /** See ProvisioningContext — passed for hosting/economic bookkeeping. */
    provisioningContext?: ProvisioningContext
    /**
     * Called when the active pod changes — i.e. when a retry provisions a new pod.
     * Callers should update actum.externusJobId to the new podId so the DB always
     * reflects the pod that is actually running.
     */
    onPodActive?: (podId: string) => Promise<void>
    /**
     * Called as pod execution telemetry accrues (provisioning, downloads, etc.).
     * Persisted onto the actum so it survives to the completion webhook, which
     * runs in a fresh context with none of this in-flight state.
     */
    onMetrics?: (executio: ActumExecutio) => Promise<void>
  }): Promise<{ id: string }>
}

interface Config {
  /** Deployment-configurable webhook URL. Set at startup — same cursor code in all contexts. */
  webhookUrl: string
  /** Upper-bound seconds for a single pod job. Default 1800 (30 min). */
  maxJobSeconds?: number
  /** Warm GPU pool scheduler. When present, checked before cold-starting a new pod. */
  praefectus?: Praefectus
  /** Builds a WarmPodClient for a given Materia — required when praefectus is set. */
  warmFactory?: (materia: Materia) => RunPodClient
  /** Extracts the OCI image ref from a modus for Praefectus matching. Returns undefined to skip warm routing. */
  imageRefOf?: (modus: Modus) => string | undefined
  /** When set, compiled specs are persisted by hash before submission. */
  deployments?: DeploymentumStore
}

export class RunPodCursor implements Cursor {
  constructor(
    private readonly client: RunPodClient,
    private readonly compile: (modus: Modus, aditus: Record<string, unknown>) => Promise<{ hash: string; input: unknown }>,
    private readonly modorum: Modorum,
    private readonly actorum: Actorum,
    private readonly config: Config,
  ) {}

  async reserve(modus: Modus, _aditus: Record<string, unknown>): Promise<bigint> {
    if (modus.impetusFixum !== undefined) return modus.impetusFixum
    return BigInt(this.config.maxJobSeconds ?? 1800)
  }

  async run(actum: Actum, _modo?: Modo): Promise<CursorResult> {
    const modus = await this.modorum.find(actum.modusId, actum.modusVersiono)
    if (!modus) throw new Error(`Modus '${actum.modusId}' not found`)

    const { hash, input } = await this.compile(modus, actum.aditus)

    if (this.config.deployments) {
      await this.config.deployments.upsert({
        hash,
        spec: input as Record<string, unknown>,
        natum: new Date(),
      })
    }

    const client = await this._resolveClient(modus, actum)
    // Identity + chat context reach the client via the trace, never via schema columns.
    const trace = getTrace()
    const provCtx: ProvisioningContext | undefined = (trace?.animaId || trace?.groupChatId)
      ? { hostAnimaId: trace.animaId, groupChatId: trace.groupChatId }
      : undefined
    const { id: externusJobId } = await client.submit({
      input,
      webhook: this.config.webhookUrl,
      provisioningContext: provCtx,
      onPodActive: async (newPodId) => {
        // Retry pod is now active — update so boot recovery and reconciliation see the right pod
        await this.actorum.update(actum.id, { externusJobId: newPodId }).catch(() => {})
      },
      onMetrics: async (executio) => {
        await this.actorum.update(actum.id, { executio }).catch(() => {})
      },
    })

    await this.actorum.update(actum.id, { externusJobId, deploymentHash: hash, status: 'agens' })

    return { kind: 'async', externusJobId }
  }

  private async _resolveClient(modus: Modus, actum: Actum): Promise<RunPodClient> {
    const { praefectus, warmFactory, imageRefOf } = this.config

    // 'performance' always cold-starts a dedicated pod — never touch the warm pool.
    if (actum.computeStrategy === 'performance') return this.client

    if (praefectus && imageRefOf) {
      const imageRef = imageRefOf(modus)
      if (imageRef) {
        const forEconomy = actum.computeStrategy === 'economy'
        const warm = await praefectus.findWarm(imageRef, forEconomy ? { forEconomy: true } : undefined)
        if (warm && warmFactory) return warmFactory(warm)

        // Economy jobs must not silently fall back to a cold-start pod —
        // the user elected to wait for warm capacity, not to be billed full price.
        if (forEconomy) throw new EconomyUnavailableError(imageRef)
      }
    }
    return this.client
  }
}

/**
 * Thrown when an economy-strategy job finds no warm pod in the economy pool.
 * Callers should hold the job and retry when a pod becomes available,
 * rather than silently upgrading the user to a full cold-start.
 */
export class EconomyUnavailableError extends Error {
  constructor(imageRef: string) {
    super(`No economy-pool pod available for image '${imageRef}' — job not dispatched`)
    this.name = 'EconomyUnavailableError'
  }
}
