import crypto from 'node:crypto'
import type { Actorum, ActumCompletor } from '../../types/cursus.js'
import type { Exitus } from '../../types/cursus.js'
import type { Nexus } from '../../types/nexus.js'
import type { Signorum } from '../../types/significandi.js'
import type { Vestigiorum } from '../../types/vestigium.js'
import type { Modorum } from '../../types/modus.js'
import type { ModoStore } from '../../types/modo.js'
import { createVestigiumFromActum } from '../../execution/hooks/vestigiumHook.js'

type AuctorKey = { animaId: string } | { commitment: string }

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
  /** Optional: routes collection actum completions back to CollectioCursor. */
  collectioRouter?: {
    findCollectioIdForActum(actumId: string): string | null
    onActumCompleta(collectioId: string, actumId: string, success: boolean): Promise<void>
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

interface RunPodPayload {
  id: string
  status: string
  output?: unknown[]
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

    const status = payload.status

    if (status === 'COMPLETED') {
      const executionTime = payload.executionTime ?? 0
      const exitus: Exitus = {
        exitus: { outputs: payload.output ?? [] },
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

      // Look up spell author for royalty routing — available via modorum dep
      let modusAuctorAnimaId: string | undefined
      if (deps.modorum) {
        const modus = await deps.modorum.find(actum.modusId)
        modusAuctorAnimaId = modus?.auctor
      }

      if (deps.nexus && deps.signorum) {
        const royaltySigna = await deps.nexus.emit({
          type: 'execution_spend',
          payload: { actum: completed, impetus: exitus.impetus, modusAuctorAnimaId },
        })
        let allSigna = royaltySigna
        // Fire royalty_fired so platformSkimHook can take its cut
        if (royaltySigna.length > 0) {
          const royaltyValor = royaltySigna.reduce((sum, s) => sum + s.valor, 0n)
          const skimSigna = await deps.nexus.emit({
            type: 'royalty_fired',
            payload: { actumId: completed.id, royaltyValor, baseValor: exitus.impetus },
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

      if (identity && deps.vestigiorum) {
        createVestigiumFromActum(completed, identity, deps.vestigiorum).catch(() => {})
      }
      return { status: 200, body: { success: true } }
    }

    if (status === 'FAILED' || status === 'CANCELLED') {
      await deps.completor.fail(actum, payload.error ?? 'Job failed')
      await deps.flowRouter?.handleActumComplete(actum.id, { kind: 'failed', error: payload.error ?? 'Job failed' })

      // Route collection acta to CollectioCursor on failure
      if (deps.collectioRouter) {
        const collectioId = deps.collectioRouter.findCollectioIdForActum(actum.id)
        if (collectioId) await deps.collectioRouter.onActumCompleta(collectioId, actum.id, false)
      }

      return { status: 200, body: { success: true } }
    }

    // IN_PROGRESS and unknown statuses: informational, no action
    return { status: 200, body: { success: true } }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return { status: 500, body: { success: false, message } }
  }
}
