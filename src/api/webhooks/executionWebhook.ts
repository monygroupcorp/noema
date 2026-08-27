import crypto from 'node:crypto'
import type { Actorum, ActumCompletor } from '../../types/cursus.js'
import type { Actum } from '../../types/actum.js'
import type { Exitus } from '../../types/cursus.js'
import type { Nexus } from '../../types/nexus.js'
import type { Signorum } from '../../types/significandi.js'
import type { Vestigiorum } from '../../types/vestigium.js'
import type { Modorum } from '../../types/modus.js'
import type { ModoStore } from '../../types/modo.js'
import type { HospitiumStore } from '../../types/hospitium.js'
import type { MateriaStore } from '../../types/materia.js'
import type { ActumIndexStore } from '../../types/actumIndex.js'
import { projectExitus } from '../../execution/projectExitus.js'
import { privateMarker } from '../../crystal/MediaFetcher.js'
import { modoHostFor } from '../../ledger/rates.js'
import { resolveModelRoyaltyPayees } from '../../ledger/resolveModelPayees.js'

type AuctorKey = { animaId: string } | { commitment: string } | { bursaToken: string }

export interface ExecutionWebhookDeps {
  actorum: Actorum
  completor: ActumCompletor
  /** HMAC-SHA256 shared secret. If absent, signature validation is skipped (dev only). */
  secret?: string
  /** Optional: notify waiting flow contexts when execution completes/fails. */
  flowRouter?: {
    handleActumComplete(
      actumId: string,
      result: { kind: 'complete'; exitus: Record<string, unknown> } | { kind: 'failed'; error: string }
    ): Promise<AuctorKey | null>
  }
  /** Optional: Nexus event bus — fires execution_spend hooks after completion. */
  nexus?: Nexus
  /** Optional: ledger write target — bulk-inserts hook-produced signa. Required when nexus is set. */
  signorum?: Signorum
  /** Optional: vestigium store — writes a generation trace after each completion. */
  vestigiorum?: Vestigiorum
  /** Optional: modus registry — used to look up spell author for royalty routing. */
  modorum?: Modorum
  /**
   * Optional: a ministerium-specific exitus resolver. When it returns non-null for a
   * completion, that record is the actum's exitus instead of the generic `projectExitus`
   * of the pod outputs. The training path uses this to run finality (host the pod-uploaded
   * LoRA + register the Intella) at completion. Returns null → fall back to projectExitus.
   */
  resolveExitus?(
    actum: Actum,
    modus: import('../../types/modus.js').Modus | null,
    outputItems: Array<{ url?: string; path?: string; kind?: string } | string>,
  ): Promise<Record<string, unknown> | null>
  /** Optional: session store — updates impetusAccrued when async jobs complete. */
  modos?: ModoStore
  /** Optional: identity-bearing hosting side-table — resolves modoHostAnimaId at emit. */
  hospitia?: HospitiumStore
  /** Optional: compiled-bundle store — reads the resolved `spec.models` (the models the
   *  gen actually used) to route model royalties. Absent → no model-royalty payees. */
  deployments?: import('../../types/deploymentum.js').DeploymentumStore
  /** Optional: publication store — a model's published `Editio.owners[]` is its royalty
   *  surface (spec §5e). Absent → no model-royalty payees. */
  editiones?: import('../../types/editio.js').Editionum
  /** Optional: studio store — merges `executio.modelsInstalled` reports into
   *  `Materia.installedModels` so the bulletin Mod • → View loadout reflects reality. */
  materiae?: MateriaStore
  /** Optional: per-anima dispatch index. On `completus` the entry is RETAINED and stamped
   *  settled (spend history for `GET /v1/me/runs`); on `fractus` it is removed. Either way
   *  `/status` YOUR GENS shows only in-flight work (buildGens filters to nascens|agens). */
  actumIndex?: ActumIndexStore
  /** Optional: routes collection actum completions back to CollectioCursor. */
  collectioRouter?: {
    findCollectioIdForActum(actumId: string): string | null
    onActumCompleta(collectioId: string, actumId: string, success: boolean): Promise<void>
  }
  /** Optional: routes compositus step completions back to CompositusCursor (ADR-0008).
   *  Unlike collections, the child step carries its own `compositum.parentId`, so no
   *  lookup table is needed — the webhook reads the link off the completed actum. */
  compositusRouter?: {
    onStepComplete(parentId: string, childActum: Actum, success: boolean): Promise<void>
  }
}

export interface WebhookRequest {
  body: unknown        // parsed JSON body
  rawBody: string      // raw string for signature validation
  signature?: string   // X-Webhook-Secret header value
  /**
   * The per-job callback nonce carried in the callback URL's last path segment, when the request
   * arrived on the nonce-bearing route. Absent for a callback on the nonce-less route, which is
   * admitted only for an actum that carries no nonce (dispatched before the nonce existed).
   */
  nonce?: string
}

export interface WebhookResult {
  status: 200 | 400 | 401 | 404 | 500
  body: { success: boolean; message?: string }
}

interface RunPodOutputItem {
  url?: string
  path?: string
  /** The object KEY, reported instead of `url` when the run's bucket has no public binding
   *  (noema-347 private generation) — there is no URL for the runner to build. */
  key?: string
}

/**
 * Rewrite a private run's pod outputs so nothing fetchable is ever persisted.
 *
 * A run dispatched to the private-outputs bucket gets object KEYS back; each becomes an opaque
 * `noema-private://<key>` marker, carried through `projectExitus` under the same declared exitus
 * porta keys (the marker keeps the extension, so media-type resolution is unchanged). An
 * `http(s)` item on such a run is DROPPED rather than stored: it would be a durable, fetchable
 * handle to output the caller asked to keep private, and the private path has no use for one.
 */
function toPrivateOutputs(
  items: Array<RunPodOutputItem | string>,
): Array<RunPodOutputItem | string> {
  const out: Array<RunPodOutputItem | string> = []
  for (const item of items) {
    if (typeof item === 'string') continue
    if (typeof item.key === 'string' && item.key.length > 0) {
      const { key: _key, url: _url, ...rest } = item
      out.push({ ...rest, url: privateMarker(item.key) })
      continue
    }
    if (typeof item.url === 'string' && /^https?:\/\//i.test(item.url)) continue
    out.push(item)
  }
  return out
}

interface RunPodPayload {
  id: string
  status: string
  output?: Array<RunPodOutputItem | string>
  error?: string
  executionTime?: number
  delayTime?: number
}

export async function handleExecutionWebhook(
  req: WebhookRequest,
  deps: ExecutionWebhookDeps,
): Promise<WebhookResult> {
  try {
    // Validate HMAC signature if secret is configured
    if (deps.secret) {
      const expected = crypto
        .createHmac('sha256', deps.secret)
        .update(req.rawBody)
        .digest('hex')

      const provided = req.signature ?? ''
      const expectedBuf = Buffer.from(expected, 'utf8')
      const providedBuf = Buffer.from(provided, 'utf8')

      const signaturesMatch =
        expectedBuf.length === providedBuf.length &&
        crypto.timingSafeEqual(expectedBuf, providedBuf)

      if (!signaturesMatch) {
        return { status: 401, body: { success: false, message: 'Invalid signature' } }
      }
    }

    // Parse and validate body shape
    const payload = req.body as Partial<RunPodPayload>
    if (!payload.id || typeof payload.id !== 'string') {
      return { status: 400, body: { success: false, message: 'Missing required field: id' } }
    }

    // Look up the actum by external job ID
    const actum = await deps.actorum.findByExternusJobId(payload.id)
    if (!actum) {
      return { status: 404, body: { success: false, message: `No actum found for externusJobId: ${payload.id}` } }
    }

    // Admission: bind this callback to the job it reports. The nonce is minted per job at dispatch
    // and travels only in the callback URL we hand the pod, so possession of it is what authorises
    // the write. Two ways in, and nothing else:
    //   - nonce presented → it must resolve to THIS actum (the one the reported job id resolves to);
    //   - no nonce → admitted only for an actum that carries none, i.e. one dispatched before the
    //     nonce existed and still in flight. Self-retiring: once every in-flight run carries a
    //     nonce this branch is unreachable and the nonce-less route can be removed.
    // A callback that satisfies neither is refused with the same 404 as an unknown job, so the
    // response does not distinguish which half failed. Refusal is BEFORE any completion, ledger
    // write, or impetus accrual.
    const nonceOk = req.nonce
      ? (await deps.actorum.findByCallbackNonce(req.nonce))?.id === actum.id
      : !actum.callbackNonce
    if (!nonceOk) {
      return { status: 404, body: { success: false, message: `No actum found for externusJobId: ${payload.id}` } }
    }

    // Idempotency: webhook may arrive more than once; already-terminal actums are a no-op
    if (actum.status === 'completus' || actum.status === 'fractus') {
      return { status: 200, body: { success: true } }
    }

    const status = payload.status

    if (status === 'COMPLETED') {
      const executionTime = payload.executionTime ?? 0
      // Private generation (noema-347): the run's OWN dispatch stamp decides — never a
      // preference re-read here, which would race a mid-flight preference change.
      const outputItems = actum.executio?.privateOutputs
        ? toPrivateOutputs(payload.output ?? [])
        : (payload.output ?? [])

      // Resolve the flow's exitus schema once — used to key the outputs under the
      // DECLARED exitus Porta names (projectExitus), and reused below for royalty
      // routing. Optional dep → null, and projectExitus falls back to bare type names.
      const modus = deps.modorum ? await deps.modorum.find(actum.modusId) : null

      // A ministerium-specific resolver (e.g. training finality) may own the exitus;
      // otherwise project the pod outputs under the declared exitus Porta names.
      const resolved = deps.resolveExitus ? await deps.resolveExitus(actum, modus, outputItems) : null

      const exitus: Exitus = {
        exitus: resolved ?? projectExitus(modus, outputItems),
        impetus: BigInt(Math.ceil(executionTime / 1000)),
        duratio: executionTime,
      }
      // Resolve identity ahead of completion — the completor threads it straight into
      // vestigium indexing (single choke point) instead of a second webhook-only write
      // site. No data dependency on `completed`: handleActumComplete only needs the
      // actum id + the exitus payload we already built above.
      const flowIdentity = await deps.flowRouter?.handleActumComplete(actum.id, {
        kind: 'complete',
        exitus: exitus.exitus as Record<string, unknown>,
      })
      // Fallback: runs fired directly (e.g. `POST /v1/runs`) never create a FlowContext,
      // so flowRouter has nothing to resolve. ActumIndex is the sanctioned identity
      // source for that case — ExecuteFlow records it on dispatch for both identified
      // and anonymous (commitment) runs; bursaToken runs are never indexed there, so
      // reading it back adds no new owner↔anonymous linkage.
      const indexEntry = !flowIdentity
        ? await deps.actumIndex?.findByActumId?.(actum.id)
        : null
      const indexIdentity: AuctorKey | null = indexEntry
        ? indexEntry.animaId
          ? { animaId: indexEntry.animaId }
          : indexEntry.commitment
            ? { commitment: indexEntry.commitment }
            : null
        : null
      const identity = flowIdentity ?? indexIdentity
      const auctor = identity && !('bursaToken' in identity) ? identity : undefined

      const completed = await deps.completor.complete(actum, exitus, auctor)

      // Update session spend — async jobs can't update impetusAccrued at dispatch
      // time since the actual cost is unknown until the webhook fires.
      if (deps.modos && actum.modoId) {
        const modo = await deps.modos.findById(actum.modoId)
        if (modo) {
          await deps.modos.update(actum.modoId, {
            impetusAccrued: modo.impetusAccrued + exitus.impetus,
          })
        }
      }

      // Spell-author royalty routing — reuse the `modus` resolved above.
      // `Modus.auctor` is the `{ animaId } | { commitment }` owner union. Royalty
      // routing addresses identified authors only; anon-owned (commitment) saved
      // flows have no animaId to route to here.
      const modusAuctorAnimaId: string | undefined =
        modus?.auctor && typeof modus.auctor === 'object' && 'animaId' in modus.auctor
          ? modus.auctor.animaId : undefined   // typeof guard: legacy stringy data can't crash the webhook

      // Hosting payout (Phase C): resolve the host's full HostKey from Hospitium
      // at emit time — host identity is NEVER on the actum or materia. The
      // host-bound hooks (hostCutHook, hospitiumHook) branch on the discriminant
      // to mint reward (identified) or arcanum (commitment) signa.
      let modoHostKey: import('../../types/hospitium.js').HostKey | undefined
      if (deps.hospitia && completed.executio?.pricingTier && completed.materiamId) {
        const hospitium = await deps.hospitia.findByMateriaId(completed.materiamId).catch(() => null)
        modoHostKey = modoHostFor(completed.executio.pricingTier, hospitium)
      }

      // baseImpetus is written by ActumCompletor at completion, derived from the
      // measured pod cost (post-167). The `?? completed.impetus` fallback covers
      // rails that complete without a completor-written executio stamp.
      const baseImpetus = completed.executio?.baseImpetus ?? completed.impetus

      // Model royalty routing (roadmap Tier 1 #1): the models this gen actually used
      // → their published Editio rights split → weighted payees. The `modelRoyaltyHook`
      // splits the 5% pool across them; empty list → it no-ops (no published models).
      const intellaRoyaltyPayees = await resolveModelRoyaltyPayees(completed, {
        deployments: deps.deployments,
        editiones: deps.editiones,
      })

      if (deps.nexus && deps.signorum) {
        const royaltySigna = await deps.nexus.emit({
          type: 'execution_spend',
          payload: {
            actum: completed,
            impetus: completed.impetus,
            baseImpetus,
            modusAuctorAnimaId,
            modoHostKey,
            ...(intellaRoyaltyPayees.length ? { intellaRoyaltyPayees } : {}),
          },
        })
        let allSigna = royaltySigna
        // Fire royalty_fired so platformSkimHook can take its cut
        if (royaltySigna.length > 0) {
          const royaltyValor = royaltySigna.reduce((sum, s) => sum + s.valor, 0n)
          const skimSigna = await deps.nexus.emit({
            type: 'royalty_fired',
            payload: { actumId: completed.id, royaltyValor, baseValor: completed.impetus },
          })
          if (skimSigna.length) allSigna = [...allSigna, ...skimSigna]
        }
        if (allSigna.length) await deps.signorum.createMany(allSigna)
      }

      // Route collection acta to CollectioCursor
      if (deps.collectioRouter) {
        const collectioId = deps.collectioRouter.findCollectioIdForActum(actum.id)
        if (collectioId) await deps.collectioRouter.onActumCompleta(collectioId, actum.id, true)
      }

      // Route compositus step acta to CompositusCursor — the completed step carries
      // its own parent link, so it advances the chain (next step) or completes the parent.
      if (deps.compositusRouter && completed.compositum) {
        await deps.compositusRouter.onStepComplete(completed.compositum.parentId, completed, true)
      }

      // Studio inventory merge: comfyrunner reports the post-run installed model
      // list via `executio.modelsInstalled`. Set-union into Materia.installedModels
      // so the bulletin Mod • → View loadout reflects what's actually on disk and
      // /status studio rows can show a real loadout summary. No identity flows here.
      const reported = completed.executio?.modelsInstalled
      if (deps.materiae && completed.materiamId && reported && reported.length > 0) {
        const materia = await deps.materiae.findById(completed.materiamId).catch(() => null)
        if (materia) {
          const next = new Set<string>(materia.installedModels ?? [])
          for (const id of reported) next.add(id)
          if (next.size !== (materia.installedModels?.length ?? 0)) {
            await deps.materiae.update(materia.id, { installedModels: [...next] }).catch(() => {})
          }
        }
      }

      // Retain-on-settle (noema-026): the run terminated as `completus`, so instead of
      // pruning the index row we STAMP it settled — it becomes durable, owner-queryable
      // spend history (`GET /v1/me/runs`). `/status`'s buildGens still filters to
      // nascens|agens, so the retained row never re-appears in the active view. `modus`
      // was resolved above; impetus is the settled cost. Idempotent (webhook at-least-once).
      // Stores without `settle` (in-memory/dev doubles) keep the old prune behaviour.
      if (deps.actumIndex?.settle) {
        await deps.actumIndex
          .settle(actum.id, {
            settledAt: completed.completum ?? new Date(),
            impetus: completed.impetus.toString(),
            modusLabel: modus?.nomen ?? actum.modusId,
          })
          .catch(() => {})
      } else if (deps.actumIndex) {
        await deps.actumIndex.remove(actum.id).catch(() => {})
      }

      return { status: 200, body: { success: true } }
    }

    if (status === 'FAILED' || status === 'CANCELLED') {
      await deps.completor.fail(actum, payload.error ?? 'Job failed')
      await deps.flowRouter?.handleActumComplete(actum.id, { kind: 'failed', error: payload.error ?? 'Job failed' })

      if (deps.collectioRouter) {
        const collectioId = deps.collectioRouter.findCollectioIdForActum(actum.id)
        if (collectioId) await deps.collectioRouter.onActumCompleta(collectioId, actum.id, false)
      }

      // A failed compositus step fails the parent run (release-only — no charge for
      // the unrun remainder).
      if (deps.compositusRouter && actum.compositum) {
        await deps.compositusRouter.onStepComplete(actum.compositum.parentId, actum, false)
      }

      // A `fractus` run is a failure (signa released, no charge) — NOT spend — so it is
      // pruned, never retained as settled history (noema-026: spend view is completus-only).
      if (deps.actumIndex) await deps.actumIndex.remove(actum.id).catch(() => {})

      return { status: 200, body: { success: true } }
    }

    // IN_PROGRESS and unknown statuses: informational, no action
    return { status: 200, body: { success: true } }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return { status: 500, body: { success: false, message } }
  }
}
