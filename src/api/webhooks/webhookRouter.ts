import { Router, type Request, type Response } from 'express'
import { handleExecutionWebhook, type ExecutionWebhookDeps } from './executionWebhook.js'
import { makeLogger } from '../../lib/logger.js'
import { withTrace, makeTraceContext, getTrace } from '../../lib/trace.js'

const log = makeLogger('webhook:runpod')

export interface WebhookRouterDeps extends ExecutionWebhookDeps {
  /** Raw body is needed for HMAC validation — populate req.rawBody in Express setup */
}

export function createWebhookRouter(deps: WebhookRouterDeps): Router {
  const router = Router()

  const handle = (nonce?: string) => async (req: Request, res: Response): Promise<void> => {
    const body = req.body as Record<string, unknown> | undefined
    // `id` is RunPod's own field, naming the POD — not the actum. Keep the wire field as-is;
    // only the local name and the log field below should say what this value actually is.
    const podId = (body as { id?: unknown; actumId?: unknown } | undefined)?.id ?? (body as { actumId?: unknown } | undefined)?.actumId

    await withTrace(makeTraceContext({ platform: 'api' }), async () => {
      if (podId) {
        log.info('webhook received', {
          podId: podId as string,
          status: (body as { status?: unknown } | undefined)?.status as string | undefined,
        })
        const ctx = getTrace()
        if (ctx) ctx.webhookMs = Date.now() - ctx.startTs
      } else {
        log.warn('webhook: unknown podId', { raw: body })
      }

      const result = await handleExecutionWebhook({
        body: req.body,
        rawBody: (req as { rawBody?: string }).rawBody ?? JSON.stringify(req.body),
        signature: req.headers['x-webhook-secret'] as string | undefined,
        ...(nonce ? { nonce } : {}),
      }, deps)

      res.status(result.status).json(result.body)
    })
  }

  // POST /runpod/:nonce — job completion on the per-job callback URL handed to the pod at
  // dispatch. The nonce is the admission credential; the handler requires it to resolve to the
  // same actum the reported job id resolves to.
  router.post('/runpod/:nonce', async (req, res) => handle(req.params.nonce)(req, res))

  // POST /runpod — the nonce-less callback URL. Retained for runs dispatched before the per-job
  // nonce existed and still in flight; the handler admits it only for an actum carrying no nonce,
  // so cutting it off would have stranded those runs. Self-retiring once none remain.
  router.post('/runpod', async (req, res) => handle()(req, res))

  return router
}
