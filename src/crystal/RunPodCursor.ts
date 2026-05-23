import type { Modus, Modorum } from '../types/modus.js'
import type { Actum, ActumExecutio } from '../types/actum.js'
import type { Modo } from '../types/modo.js'
import type { Cursor, CursorResult, Actorum } from '../types/cursus.js'
import type { Materia } from '../types/materia.js'
import type { HospitiumStore, HostKey } from '../types/hospitium.js'
import type { DeploymentumStore } from '../types/deploymentum.js'
import type { Praefectus } from './Praefectus.js'
import { getTrace } from '../lib/trace.js'
import { tierOf, impetusFor } from '../ledger/rates.js'

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
  /** The economic owner of this provisioning — identified anima or anonymous
   *  arcanum commitment. Stamped onto the paired Hospitium at warm-park. */
  hostKey?: { animaId: string } | { commitment: string }
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
  /**
   * Identity-bearing hosting metadata, side-table to Materia. When present, the
   * cursor reads it at dispatch to compute the three-tier pricing decision
   * (owner/admin/guest) and stamps the result on actum.executio for the
   * completor to use at emit time. Materia stays identity-blind.
   */
  hospitia?: HospitiumStore
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

    const { client, materia } = await this._resolveClient(modus, actum)
    // Identity + chat context reach the client via the trace, never via schema columns.
    const trace = getTrace()
    const hostKey: HostKey | undefined =
      trace?.animaId    ? { animaId:    trace.animaId    } :
      trace?.commitment ? { commitment: trace.commitment } :
      undefined
    const provCtx: ProvisioningContext | undefined = (hostKey || trace?.groupChatId)
      ? { ...(hostKey ? { hostKey } : {}), ...(trace?.groupChatId ? { groupChatId: trace.groupChatId } : {}) }
      : undefined

    // Phase B dispatch decision: when we know the pod (warm match) AND have a
    // hospitia store, compute the pricing tier + finalImpetus and stamp them on
    // the actum so the completor emits execution_spend with the right numbers.
    // We stash ONLY non-identity values on the actum — host identity is re-derived
    // from Hospitium at emit time (see ActumCompletor).
    if (materia && this.config.hospitia) {
      const hospitium = await this.config.hospitia.findByMateriaId(materia.id).catch(() => null)
      const tier = tierOf(hostKey, hospitium)
      const finalImpetus = impetusFor(tier, materia, actum.impetus)
      await this.actorum.update(actum.id, {
        materiamId: materia.id,
        executio: { ...(actum.executio ?? {}), pricingTier: tier, finalImpetus },
      }).catch(() => {})
    } else if (materia) {
      // No hospitia configured — at least record which Materia we landed on.
      await this.actorum.update(actum.id, { materiamId: materia.id }).catch(() => {})
    }

    const { id: externusJobId } = await client.submit({
      input,
      webhook: this.config.webhookUrl,
      provisioningContext: provCtx,
      onPodActive: async (newPodId) => {
        // Retry pod is now active — update so boot recovery and reconciliation see the right pod
        await this.actorum.update(actum.id, { externusJobId: newPodId }).catch(() => {})
      },
      onMetrics: async (executio) => {
        // MERGE, never replace — the dispatch stamp ({pricingTier, finalImpetus})
        // lives in the same executio object and would be wiped by a naïve overwrite
        // from the client's pod-telemetry view. The client always sends the full
        // accumulated snapshot of *its* fields; we preserve the dispatch fields.
        const cur = await this.actorum.findById(actum.id).catch(() => null)
        const merged: ActumExecutio = { ...(cur?.executio ?? {}), ...executio }
        await this.actorum.update(actum.id, { executio: merged }).catch(() => {})
      },
    })

    await this.actorum.update(actum.id, { externusJobId, deploymentHash: hash, status: 'agens' })

    return { kind: 'async', externusJobId }
  }

  /**
   * Route the actum to a client + (when warm) the Materia it landed on. The
   * Materia surfaces back to the caller so dispatch can stamp materiamId and
   * read the paired Hospitium for the pricing decision.
   *
   * Priority:
   *   1. shareTokenHint — explicit deep-link routing to a specific host's pod.
   *   2. computeStrategy='performance' — always cold (dedicated, never warm).
   *   3. Praefectus warm match (economy pool or standard).
   *   4. Cold fallback via this.client.
   */
  private async _resolveClient(modus: Modus, actum: Actum): Promise<{ client: RunPodClient; materia?: Materia }> {
    const { praefectus, warmFactory, imageRefOf } = this.config

    // 1. Deep-link routing wins when present + valid. Expired/revoked tokens
    //    silently fall through to normal routing (no surprise failure for the user).
    if (actum.shareTokenHint && praefectus && warmFactory) {
      const warm = await praefectus.findByShareToken(actum.shareTokenHint).catch(() => null)
      if (warm) return { client: warmFactory(warm), materia: warm }
    }

    // 2. 'performance' always cold-starts a dedicated pod — never touch the warm pool.
    if (actum.computeStrategy === 'performance') return { client: this.client }

    // 3. Praefectus warm match (economy or standard).
    if (praefectus && imageRefOf) {
      const imageRef = imageRefOf(modus)
      if (imageRef) {
        const forEconomy = actum.computeStrategy === 'economy'
        const warm = await praefectus.findWarm(imageRef, forEconomy ? { forEconomy: true } : undefined)
        if (warm && warmFactory) return { client: warmFactory(warm), materia: warm }

        // Economy jobs must not silently fall back to a cold-start pod —
        // the user elected to wait for warm capacity, not to be billed full price.
        if (forEconomy) throw new EconomyUnavailableError(imageRef)
      }
    }

    // 4. Cold fallback — Materia will be created on warm-park (see SecurePodClient).
    return { client: this.client }
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
