import crypto from 'node:crypto'
import type { Actorum, ActumCompletor } from '../../types/cursus.js'
import type { Exitus } from '../../types/cursus.js'
import type { Nexus } from '../../types/nexus.js'
import type { Signorum } from '../../types/significandi.js'

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
    ): Promise<void>
  }
  /** Optional: Nexus event bus — fires execution_spend hooks after completion. */
  nexus?: Nexus
  /** Optional: ledger write target — bulk-inserts hook-produced signa. Required when nexus is set. */
  signorum?: Signorum
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
      if (deps.nexus && deps.signorum) {
        const newSigna = await deps.nexus.emit({
          type: 'execution_spend',
          payload: { actum: completed, impetus: exitus.impetus },
        })
        if (newSigna.length) await deps.signorum.createMany(newSigna)
      }
      await deps.flowRouter?.handleActumComplete(actum.id, {
        kind: 'complete',
        exitus: exitus.exitus as Record<string, unknown>,
      })
      return { status: 200, body: { success: true } }
    }

    if (status === 'FAILED' || status === 'CANCELLED') {
      await deps.completor.fail(actum, payload.error ?? 'Job failed')
      await deps.flowRouter?.handleActumComplete(actum.id, { kind: 'failed', error: payload.error ?? 'Job failed' })
      return { status: 200, body: { success: true } }
    }

    // IN_PROGRESS and unknown statuses: informational, no action
    return { status: 200, body: { success: true } }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return { status: 500, body: { success: false, message } }
  }
}
