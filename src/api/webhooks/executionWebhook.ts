import crypto from 'node:crypto'
import type { Actorum, ActumCompletor } from '../../types/cursus.js'
import type { Exitus } from '../../types/cursus.js'

export interface ExecutionWebhookDeps {
  actorum: Actorum
  completor: ActumCompletor
  /** HMAC-SHA256 shared secret. If absent, signature validation is skipped (dev only). */
  secret?: string
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
      await deps.completor.complete(actum, exitus)
      return { status: 200, body: { success: true } }
    }

    if (status === 'FAILED' || status === 'CANCELLED') {
      await deps.completor.fail(actum, payload.error ?? 'Job failed')
      return { status: 200, body: { success: true } }
    }

    // IN_PROGRESS and unknown statuses: informational, no action
    return { status: 200, body: { success: true } }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return { status: 500, body: { success: false, message } }
  }
}
