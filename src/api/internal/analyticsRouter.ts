import { Router } from 'express'
import type { WideEventStore } from '../../analytics/WideEventStore.js'

export function createAnalyticsRouter(store: WideEventStore, secret?: string): Router {
  const router = Router()

  function auth(req: import('express').Request, res: import('express').Response, next: import('express').NextFunction): void {
    if (secret) {
      const provided = req.headers['x-internal-secret'] ?? req.query.token
      if (provided !== secret) { res.status(401).json({ error: 'unauthorized' }); return }
    }
    next()
  }

  // GET /internal/analytics/totals?since=2024-01-01
  router.get('/totals', auth, async (req, res) => {
    const since = req.query.since ? new Date(String(req.query.since)) : new Date(Date.now() - 24 * 60 * 60 * 1000)
    const totals = await store.totals(since)
    res.json({
      revenue: totals.revenue.toString(),
      count:   totals.count,
      failed:  totals.failed,
    })
  })

  // GET /internal/analytics/recent?limit=50&modusId=flux-dev&status=failed
  router.get('/recent', auth, async (req, res) => {
    const events = await store.query({
      modusId: req.query.modusId ? String(req.query.modusId) : undefined,
      animaId: req.query.animaId ? String(req.query.animaId) : undefined,
      status:  req.query.status  as 'completed' | 'failed' | undefined,
      since:   req.query.since   ? new Date(String(req.query.since)) : undefined,
      limit:   req.query.limit   ? Number(req.query.limit) : 50,
    })
    res.json(events)
  })

  return router
}
