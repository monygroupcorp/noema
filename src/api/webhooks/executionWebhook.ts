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
import { createVestigiumFromActum } from '../../execution/hooks/vestigiumHook.js'
import { projectExitus } from '../../execution/projectExitus.js'
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
  /** Optional: per-anima dispatch index — entry is removed on terminal status
   *  so `/status` YOUR GENS only shows in-flight work. */
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
}

export interface WebhookResult {
  status: 200 | 400 | 401 | 404 | 500
  body: { success: boolean; message?: string }
}

interface RunPodOutputItem {
  url?: string
  path?: string
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

    // Idempotency: webhook may arrive more than once; already-terminal actums are a no-op
    if (actum.status === 'completus' || actum.status === 'fractus') {
      return { status: 200, body: { success: true } }
    }

    const status = payload.status

    if (status === 'COMPLETED') {
      const executionTime = payload.executionTime ?? 0
      const outputItems = payload.output ?? []

      // Resolve the flow's exitus schema once — used to key the outputs under the
      // DECLARED exitus Porta names (projectExitus), and reused below for royalty
      // routing. Optional dep → null, and projectExitus falls back to bare type names.
      const modus = deps.modorum ? await deps.modorum.find(actum.modusId) : null

      const exitus: Exitus = {
        exitus: projectExitus(modus, outputItems),
        impetus: BigInt(Math.ceil(executionTime / 1000)),
        duratio: executionTime,
      }
      const completed = await deps.completor.complete(actum, exitus)

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

      // baseImpetus is stamped at dispatch on executio. Owner/admin paths that
      // never went through cursor stamping fall back to the spend amount itself.
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

      const identity = await deps.flowRouter?.handleActumComplete(actum.id, {
        kind: 'complete',
        exitus: exitus.exitus as Record<string, unknown>,
      })

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

      if (identity && deps.vestigiorum && !('bursaToken' in identity)) {
        createVestigiumFromActum(completed, identity, deps.vestigiorum).catch(() => {})
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

      // Drop the actumIndex entry — terminal status, no longer "in flight".
      if (deps.actumIndex) await deps.actumIndex.remove(actum.id).catch(() => {})

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

      // Drop the actumIndex entry — terminal status, no longer "in flight".
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
