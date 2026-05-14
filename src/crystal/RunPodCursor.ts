import type { Modus, Modorum } from '../types/modus.js'
import type { Actum } from '../types/actum.js'
import type { Modo } from '../types/modo.js'
import type { Cursor, CursorResult, Actorum } from '../types/cursus.js'
import type { Materia } from '../types/materia.js'
import type { DeploymentumStore } from '../types/deploymentum.js'
import type { Praefectus } from './Praefectus.js'

/**
 * RunPodClient — the injectable seam between the cursor and any GPU pod substrate.
 *
 * The real implementation provisions a RunPod SECURE pod, SSHes in, runs the
 * ComfyUI workflow, and POSTs the result to `webhook`. In tests a stub is swapped in.
 *
 * `webhook` is the ONLY thing that differs between deployment contexts (normal vs TEE).
 */
export interface RunPodClient {
  submit(params: {
    input: unknown
    /** Where the runner POSTs the completion result.
     * Normal deployment: our server (e.g. https://api.noema.io/webhooks/runpod)
     * TEE deployment: the TEE pod's local endpoint. */
    webhook?: string
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
    const { id: externusJobId } = await client.submit({
      input,
      webhook: this.config.webhookUrl,
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
      }
    }
    return this.client
  }
}
