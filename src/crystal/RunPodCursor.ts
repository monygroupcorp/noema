import { randomUUID } from 'node:crypto'
import type { Modus, Modorum } from '../types/modus.js'
import type { Actum, ActumExecutio, ModelRef } from '../types/actum.js'
import type { Modo } from '../types/modo.js'
import type { Cursor, CursorResult, Actorum } from '../types/cursus.js'
import type { Materia } from '../types/materia.js'
import type { HospitiumStore, HostKey } from '../types/hospitium.js'
import type { DeploymentumStore } from '../types/deploymentum.js'
import type { Praefectus } from './Praefectus.js'
import { getTrace } from '../lib/trace.js'
import type { AuctorKey } from '../flow/types.js'
import { ownerKeyOf } from './ownerKey.js'
import { tierOf, reservationImpetus, GENERIC_RESERVE_IMPETUS } from '../ledger/rates.js'
import { isCompiledSpec, type R2Config } from './comfyrunnerClient.js'
import { privateKeyOf, privateMarkersIn, privateOutputKeyPrefix, withResolvedPrivateMarkers } from './MediaFetcher.js'
import type { Consuetudinum } from '../types/consuetudo.js'
import { makeLogger } from '../lib/logger.js'
import { PROVISION_BUDGET_MS } from './SecurePodClient.js'

const log = makeLogger('cursor:runpod')

/**
 * The single join rule for callback URLs: the deployment-set base (which may or may not carry a
 * trailing slash) plus the per-job nonce as one more path segment. Every rail that registers an
 * inbound callback uses this, so the URL the pod receives always matches the route the server
 * mounts — a double slash or a dropped segment would 404 the callback and strand the run.
 */
export function withCallbackNonce(baseUrl: string, nonce: string): string {
  return `${baseUrl.replace(/\/+$/, '')}/${nonce}`
}

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
    /** BYO-secrets Phase C: the per-job pod credential (minted at dispatch, bound to
     *  `{actumId, ownerKey, exp}`). The runner presents it when fetching a `gated` weight
     *  from our proxy. Omitted when no job-token secret is configured. */
    jobToken?: string
    /** See ProvisioningContext — passed for hosting/economic bookkeeping. */
    provisioningContext?: ProvisioningContext
    /**
     * PER-RUN object-store override (noema-347 private generation). When present it replaces the
     * client's construction-time `r2` for THIS submission only, carrying the private bucket and
     * the run's owner-scoped `keyPrefix`. It must ride the submit rather than the client because
     * a warm pod is reused across owners — a pod can never itself be "the private one".
     */
    r2?: R2Config
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
  imageRefOf?: (modus: Modus) => string | undefined | Promise<string | undefined>
  /**
   * Resolve a studio session (`actum.modoId`) to its pinned, freshly-claimed pod —
   * the studio's bound `Materia`, atomically claimed (idle→active). Injected so the
   * cursor stays decoupled from the Modo/Materia stores. Returns null when the studio
   * has no live, claimable pod (gone, or busy with another run) → routing falls through
   * to the normal warm-match / cold path. Makes `POST /v1/runs { studioId }` deterministic.
   */
  studioPodFor?: (modoId: string) => Promise<Materia | null>
  /** Admission gate: before dispatching a gen onto a reused WARM pod, ensure the models it needs
   *  are installed (awaiting any in-flight live-apply install). No-op on a cold start. */
  admitWarm?: (materia: Materia, models: Array<{ id?: string }>) => Promise<void>
  /** When set, compiled specs are persisted by hash before submission. */
  deployments?: DeploymentumStore
  /**
   * Identity-bearing hosting metadata, side-table to Materia. When present, the
   * cursor reads it at dispatch to compute the three-tier pricing decision
   * (owner/admin/guest) and stamps the result on actum.executio for the
   * completor to use at emit time. Materia stays identity-blind.
   */
  hospitia?: HospitiumStore
  /** BYO-secrets Phase C: mint the per-job pod credential bound to `{actumId, ownerKey, exp}`.
   *  Injected (bound to `JOB_TOKEN_SECRET`) so the cursor stays decoupled from the crypto. Present
   *  only when a job-token secret is configured; absent → no token minted (gated-weight path dark). */
  mintJobToken?: (claims: { actumId: string; ownerKey: string; exp: number }) => string
  /** TTL (ms) for a minted job token. Default 6h — long enough for a cold pod to boot, download,
   *  and run; short enough that a leaked token expires with the job. */
  jobTokenTtlMs?: number
  /**
   * Private generation (noema-347): the DEDICATED private-outputs bucket — no `publicUrl`, so
   * nothing written there is publicly reachable. Present only when the deployment configures one.
   * ABSENT → private generation is dark on this deployment and every run dispatches public; the
   * cursor never falls back to the public bucket for a run it resolved as private, because there
   * is nothing to fall back to (the whole point of the dedicated bucket).
   */
  privateOutputsR2?: R2Config
  /**
   * Mint a short-lived GET for one object in the private-outputs bucket (noema-347). Injected
   * because the cursor holds that bucket's CONFIG, not a client for it; present exactly when
   * `privateOutputsR2` is.
   *
   * This is the only way a pod ever reads a private output. A run that chains one resolves it
   * here, at dispatch, and the link it mints reaches the job body and nothing else — no durable
   * record carries a handle to a private object.
   */
  presignPrivateInput?: (key: string, opts: { expiresIn: number }) => Promise<string>
  /**
   * Account preferences source — read at dispatch to resolve THIS caller's `privateOutputs`
   * choice. Read here, at the one dispatch site that holds the run's owner, and stamped on the
   * actum; every later stage reads the stamp, never the preference (which can change mid-run).
   */
  consuetudinum?: Pick<Consuetudinum, 'resolveGeneratio'>
}

export class RunPodCursor implements Cursor {
  constructor(
    private readonly client: RunPodClient,
    private readonly compile: (modus: Modus, aditus: Record<string, unknown>, pinnedModels?: ModelRef[], ownerKey?: string) => Promise<{ hash: string; input: unknown }>,
    private readonly modorum: Modorum,
    private readonly actorum: Actorum,
    private readonly config: Config,
  ) {}

  /**
   * The up-front hold for a pod run, in impetus. A COST BOUND, not a price: settlement
   * charges the measured pod-time and refunds the remainder, so this only has to be an
   * upper bound (an under-reservation throws `Cursor overcharge` at completion).
   *
   * Precedence:
   *   1. `modus.impetusFixum` — a declared fixed price, honoured as-is.
   *   2. `modus.pretium` — the flow's own fitted cost curve, evaluated against this run's
   *      inputs (falling back to the flow's schema defaults per term).
   *   3. `GENERIC_RESERVE_IMPETUS` — the evidence-based fallback for a flow with no curve,
   *      and for a curve whose inputs cannot be resolved.
   *
   * The result is then clamped to the `maxJobSeconds` ceiling, so a reservation can never
   * exceed the pod-time the job timeout actually permits. Pure — no I/O — because this is
   * reached from `quote()` on a public route.
   */
  async reserve(modus: Modus, aditus: Record<string, unknown>): Promise<bigint> {
    const ceiling = BigInt(this.config.maxJobSeconds ?? 1800)

    const estimate = modus.pretium
      ? reservationImpetus({ pretium: modus.pretium, forma: modus.aditus, aditus })
      : null

    const base =
      modus.impetusFixum !== undefined ? modus.impetusFixum :
      estimate !== null ? estimate :
      GENERIC_RESERVE_IMPETUS

    return base < ceiling ? base : ceiling
  }

  /**
   * Wall-clock budget for a pod run: the pod provisioning budget PLUS the job window the
   * `maxJobSeconds` ceiling permits. The two are different clocks and are added — provisioning
   * rents the machine and builds the environment; the job window is what runs on it afterward.
   *
   * Explicitly NOT derived from `reserve()`. `reserve()` here evaluates `modus.pretium`, a fitted
   * COST CURVE, or honours a declared fixed price — an impetus figure with no duration meaning at
   * all. `terminus` lands on the actum's `expirat` and nowhere else: it is not quoted, does not
   * enter the balance check, and does not size the ledger lock.
   *
   * The cost of the number: `expirat` is what releases the locked reserve, so a pod run that dies
   * silently holds the payer's credits locked this long before the reaper frees them (clamped by
   * MAX_TERMINUS_MS). Nothing is charged — a reaped run is failed, not settled.
   */
  async terminus(_modus: Modus, _aditus: Record<string, unknown>): Promise<number> {
    return PROVISION_BUDGET_MS + (this.config.maxJobSeconds ?? 1800) * 1000
  }

  async run(actum: Actum, _modo?: Modo): Promise<CursorResult> {
    const modus = await this.modorum.find(actum.modusId, actum.modusVersiono)
    if (!modus) throw new Error(`Modus '${actum.modusId}' not found`)

    // Owner-scope compilation: private imports resolve for their owner (by trigger) and a private
    // model id the runner doesn't own is refused. Identity is off-schema — from the trace (anima/
    // commitment) or the actum's Bursa token (the purse that paid owns the run).
    const runTrace = getTrace()
    const runOwner: AuctorKey | undefined =
      actum.bursaToken    ? { bursaToken: actum.bursaToken } :
      runTrace?.animaId    ? { animaId:    runTrace.animaId }    :
      runTrace?.commitment ? { commitment: runTrace.commitment } :
      undefined
    const runOwnerKey = runOwner ? ownerKeyOf(runOwner) : undefined

    // Private generation (noema-347), chaining. An earlier run's private output arrives as a
    // `noema-private://` marker, which a pod cannot read — the bucket has no public binding, by
    // design. Each marker is resolved to a presigned GET that lapses with this run, and only the
    // job body ever carries it; `actum.aditus` keeps the marker, so no durable record gains a
    // handle to a private object.
    //
    // Every refusal here is fail-closed. The dispatch stops rather than hand the pod a reference
    // it could not fetch, or mint a link for bytes the caller has no claim on.
    const privateInputs = privateMarkersIn(actum.aditus)
    let aditus = actum.aditus
    if (privateInputs.length > 0) {
      if (!this.config.privateOutputsR2 || !this.config.presignPrivateInput) {
        throw new Error('this run uses a private output as an input, but no private-outputs store is configured')
      }
      if (!runOwnerKey) {
        throw new Error('this run uses a private output as an input, but has no owner to check it against')
      }
      // The namespace IS the claim. A private object is written under the hash of its owner's
      // key, so a marker outside this caller's own prefix belongs to someone else and is never
      // presigned — however the caller came by it.
      const ownPrefix = privateOutputKeyPrefix(runOwnerKey)
      const expiresIn = Math.ceil((PROVISION_BUDGET_MS + (this.config.maxJobSeconds ?? 1800) * 1000) / 1000)
      const resolved = new Map<string, string>()
      for (const marker of privateInputs) {
        if (resolved.has(marker)) continue
        const key = privateKeyOf(marker) ?? ''
        if (!key.startsWith(ownPrefix)) {
          throw new Error('a private output of another account cannot be used as an input')
        }
        resolved.set(marker, await this.config.presignPrivateInput(key, { expiresIn }))
      }
      aditus = withResolvedPrivateMarkers(actum.aditus, resolved)
    }

    const { hash, input } = await this.compile(modus, aditus, actum.pinnedModels, runOwnerKey)

    // Privacy for this run's OWN outputs, resolved HERE because this is the dispatch site that
    // holds the run's owner. The deployment must have a private-outputs bucket and the run must
    // have an owner to scope the key namespace to; given both, the run is private when the owner's
    // stored preference says so — an absent preference reads PUBLIC, the default is unchanged —
    // or when it reads bytes out of the private bucket. That second arm only ever fails safe:
    // writing the result of a private input to a public bucket would republish it.
    const privateR2 = this.config.privateOutputsR2
    const privateOutputs = !!privateR2 && !!runOwner && !!runOwnerKey &&
      (privateInputs.length > 0 ||
        (await this.config.consuetudinum?.resolveGeneratio(runOwner).catch(() => undefined))?.privateOutputs === true)
    // The per-run store override: the private bucket under this owner's hashed namespace. Any
    // `publicUrl` is stripped on the way out — a private run's objects have no public handle by
    // construction, so the runner returns KEYS and the host decides who ever gets a link.
    let r2Override: R2Config | undefined
    if (privateOutputs && privateR2 && runOwnerKey) {
      const { publicUrl: _unusedPublicUrl, ...privateBase } = privateR2
      r2Override = { ...privateBase, keyPrefix: privateOutputKeyPrefix(runOwnerKey) }
    }

    // BYO-secrets Phase C: mint the per-job pod credential so the pod can fetch this owner's gated
    // private weights through our proxy (the Compiler rewrote those urls + flagged them `gated`).
    // Only when both a mint fn is configured AND the run has an owner (anon-no-purse runs can't own
    // private gated imports, so they need no token). The pod presents it on `/internal/weights/:id`.
    const jobToken = (this.config.mintJobToken && runOwnerKey)
      ? this.config.mintJobToken({
          actumId: actum.id,
          ownerKey: runOwnerKey,
          exp: Date.now() + (this.config.jobTokenTtlMs ?? 6 * 60 * 60 * 1000),
        })
      : undefined

    // The compiled spec is kept by content hash as the record of what was dispatched. A spec that
    // carries a resolved private input is neither useful nor safe to keep: the link inside it was
    // minted for this one run, so the hash never recurs, and storing it would put a handle to a
    // private object in a durable row — the very thing the marker scheme exists to prevent. The
    // run still records its `deploymentHash`, so the dispatch remains traceable.
    if (this.config.deployments && privateInputs.length === 0) {
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

    // Dispatch decision: when we know the pod (warm match) AND have a hospitia
    // store, resolve the pricing tier and stamp it on the actum so the completor
    // and the spend hooks know which economics apply. The tier is a dispatch-time
    // fact (who runs on whose pod); the AMOUNTS are not — the run has not finished
    // here, so the measured cost is unknown. `ActumCompletor` derives baseImpetus
    // (the cursor's measured pod wall-clock) and the settled total at completion.
    // We stash ONLY non-identity values on the actum — host identity is re-derived
    // from Hospitium at emit time (see ActumCompletor).
    //
    // The private-generation stamp rides the SAME executio object for the same reason: it is a
    // dispatch-time fact about this run. The completion webhook reads the stamp to decide
    // marker-vs-URL, so it never has to re-resolve a preference that may have changed since.
    const privacyStamp = privateOutputs ? { privateOutputs: true } : {}
    if (privateOutputs) {
      // NOT best-effort, and BEFORE submit: the completion callback can arrive the moment the pod
      // has the job, and it decides marker-vs-URL from this stamp. A run dispatched to the private
      // bucket with no stamp on the record is a broken run, so fail here instead.
      await this.actorum.update(actum.id, { executio: { ...(actum.executio ?? {}), ...privacyStamp } })
    }
    if (materia && this.config.hospitia) {
      const hospitium = await this.config.hospitia.findByMateriaId(materia.id).catch(() => null)
      const tier = tierOf(hostKey, hospitium)
      await this.actorum.update(actum.id, {
        materiamId: materia.id,
        executio: {
          ...(actum.executio ?? {}),
          ...privacyStamp,
          pricingTier: tier,
        },
      }).catch(() => {})
    } else if (materia) {
      // No hospitia configured — at least record which Materia we landed on.
      await this.actorum.update(actum.id, { materiamId: materia.id }).catch(() => {})
    }

    // B4 admission gate: a reused warm pod may be missing a model this gen needs (one added live
    // and still downloading, or never installed). Await its install — serialized with any in-flight
    // live-apply — so the job's preflight finds the weights present instead of racing a concurrent
    // download. No-op on a cold start (no materia) or when nothing's missing.
    if (materia && this.config.admitWarm && isCompiledSpec(input)) {
      await this.config.admitWarm(materia, input.models).catch(err =>
        log.warn('warm admission install failed; job preflight will retry the download', { materiaId: materia.id, error: String(err) }))
    }

    // Per-job callback credential. The pod POSTs its completion to whatever URL we hand it at
    // submit time, so the credential rides in that URL's last path segment; the webhook admits a
    // callback only for the actum the nonce resolves to. Minted here so it lands on the actum in
    // the SAME patch as `externusJobId` (below) — a job is never in flight with one and not the
    // other. Stable across a retry pod, which rotates only `externusJobId`.
    const callbackNonce = randomUUID()

    const { id: externusJobId } = await client.submit({
      input,
      webhook: withCallbackNonce(this.config.webhookUrl, callbackNonce),
      ...(jobToken ? { jobToken } : {}),
      ...(r2Override ? { r2: r2Override } : {}),
      provisioningContext: provCtx,
      onPodActive: async (newPodId) => {
        // Retry pod is now active — update so boot recovery and reconciliation see the right pod
        await this.actorum.update(actum.id, { externusJobId: newPodId }).catch(() => {})
      },
      onMetrics: async (executio) => {
        // MERGE, never replace — the dispatch stamps ({pricingTier, privateOutputs})
        // lives in the same executio object and would be wiped by a naïve overwrite
        // from the client's pod-telemetry view. The client always sends the full
        // accumulated snapshot of *its* fields; we preserve the dispatch fields.
        const cur = await this.actorum.findById(actum.id).catch(() => null)
        const merged: ActumExecutio = { ...(cur?.executio ?? {}), ...executio }
        await this.actorum.update(actum.id, { executio: merged }).catch(() => {})
      },
    })

    await this.actorum.update(actum.id, { externusJobId, callbackNonce, deploymentHash: hash, status: 'agens' })

    return { kind: 'async', externusJobId }
  }

  /**
   * Route the actum to a client + (when warm) the Materia it landed on. The
   * Materia surfaces back to the caller so dispatch can stamp materiamId and
   * read the paired Hospitium for the pricing decision.
   *
   * Priority:
   *   0. studioId (actum.modoId) — pin to the studio's own bound pod (explicit target).
   *   1. shareTokenHint — explicit deep-link routing to a specific host's pod.
   *   2. computeStrategy='performance' — always cold (dedicated, never warm).
   *   3. Praefectus warm match (economy pool or standard).
   *   4. Cold fallback via this.client.
   */
  private async _resolveClient(modus: Modus, actum: Actum): Promise<{ client: RunPodClient; materia?: Materia }> {
    const { praefectus, warmFactory, imageRefOf, studioPodFor } = this.config

    // 0. Studio-targeted run: pin to the session's own pod. The agent provisioned this
    //    studio and is targeting it explicitly — never let an image-match land it
    //    elsewhere. Falls through if the studio is gone/busy (graceful, not an error).
    if (actum.modoId && studioPodFor && warmFactory) {
      const pinned = await studioPodFor(actum.modoId).catch(() => null)
      if (pinned) return { client: warmFactory(pinned), materia: pinned }
    }

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
      const imageRef = await imageRefOf(modus)
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
 * The job is held and dispatched when a pod becomes available rather than the
 * user being silently upgraded to a full cold-start — `Vocator` is what holds it.
 *
 * `imageRef` is carried as a FIELD, not only inside the message: it is the match
 * key the run waits under, and the line reads it as data rather than parsing it
 * back out of a sentence.
 */
export class EconomyUnavailableError extends Error {
  constructor(readonly imageRef: string) {
    super(`No economy-pool pod available for image '${imageRef}' — job not dispatched`)
    this.name = 'EconomyUnavailableError'
  }
}
