import { Router } from 'express'
import { handleExecutionWebhook, type ExecutionWebhookDeps } from './executionWebhook.js'
import { makeLogger } from '../../lib/logger.js'
import { withTrace, makeTraceContext, getTrace } from '../../lib/trace.js'

const log = makeLogger('webhook:runpod')

export interface WebhookRouterDeps extends ExecutionWebhookDeps {
  /** Raw body is needed for HMAC validation — populate req.rawBody in Express setup */
}

export function createWebhookRouter(deps: WebhookRouterDeps): Router {
  const router = Router()

  // POST /runpod — RunPod job completion (async execution webhook)
  router.post('/runpod', async (req, res) => {
    const body = req.body as Record<string, unknown> | undefined
    const actumId = (body as { id?: unknown; actumId?: unknown } | undefined)?.id ?? (body as { actumId?: unknown } | undefined)?.actumId

    await withTrace(makeTraceContext({ platform: 'api' }), async () => {
      if (actumId) {
        log.info('webhook received', {
          actumId: actumId as string,
          status:  (body as { status?: unknown } | undefined)?.status as string | undefined,
        })
        const ctx = getTrace()
        if (ctx) ctx.webhookMs = Date.now() - ctx.startTs
      } else {
        log.warn('webhook: unknown actumId', { raw: body })
      }

      const result = await handleExecutionWebhook({
        body: req.body,
        rawBody: (req as { rawBody?: string }).rawBody ?? JSON.stringify(req.body),
        signature: req.headers['x-webhook-secret'] as string | undefined,
      }, deps)

      res.status(result.status).json(result.body)
    })
  })

  return router
}
