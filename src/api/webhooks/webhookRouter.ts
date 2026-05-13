import { Router } from 'express'
import { handleExecutionWebhook, type ExecutionWebhookDeps } from './executionWebhook.js'

export interface WebhookRouterDeps extends ExecutionWebhookDeps {
  /** Raw body is needed for HMAC validation — populate req.rawBody in Express setup */
}

export function createWebhookRouter(deps: WebhookRouterDeps): Router {
  const router = Router()

  // POST /runpod — RunPod job completion (async execution webhook)
  router.post('/runpod', async (req, res) => {
    const result = await handleExecutionWebhook({
      body: req.body,
      rawBody: (req as { rawBody?: string }).rawBody ?? JSON.stringify(req.body),
      signature: req.headers['x-webhook-secret'] as string | undefined,
    }, deps)

    res.status(result.status).json(result.body)
  })

  return router
}
