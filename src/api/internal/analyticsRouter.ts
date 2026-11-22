import { Router } from 'express'
import type { WideEventStore } from '../../analytics/WideEventStore.js'
import { internalSecretMatches } from '../../lib/internalSecret.js'
import type { BehaviourEventStore } from '../../analytics/BehaviourEventStore.js'
import type { Actorum } from '../../types/cursus.js'
import { computeFunnel, DEFAULT_FUNNEL_ORDER } from '../../analytics/funnel.js'

export interface AnalyticsRouterDeps {
  wideStore: WideEventStore
  /** Absent only in a deployment that hasn't wired the behaviour corpus — totals/funnel
   *  then simply omit the non-run stages rather than erroring. */
  behaviourStore?: BehaviourEventStore
  /** Absent → `attempts`/`completed`/`failed` run counts are omitted from `totals` (the
   *  store backing it may not implement `statusCountsSince`). */
  actorum?: Actorum
}

function sinceParam(req: import('express').Request): Date {
  return req.query.since ? new Date(String(req.query.since)) : new Date(Date.now() - 24 * 60 * 60 * 1000)
}

export function createAnalyticsRouter(deps: AnalyticsRouterDeps, secret?: string): Router {
  const { wideStore, behaviourStore, actorum } = deps
  const router = Router()

  // The gate is unconditional: an unconfigured secret refuses every request rather than
  // admitting it. Configuration is asserted at boot (see `src/index.ts`).
  function auth(req: import('express').Request, res: import('express').Response, next: import('express').NextFunction): void {
    if (!internalSecretMatches(secret, req.headers['x-internal-secret'])) {
      res.status(401).json({ error: 'unauthorized' })
      return
    }
    next()
  }

  // GET /internal/analytics/totals?since=2024-01-01
  router.get('/totals', auth, async (req, res) => {
    const since = sinceParam(req)
    const totals = await wideStore.totals(since)
    const runs: Record<string, number> = {}
    if (actorum?.statusCountsSince) {
      const counts = await actorum.statusCountsSince(since)
      // "attempted" = every actum created in the window, regardless of where it ended up —
      // this is the count that can never be smaller than `completed`, because a completed
      // run was an attempt first (clause 1: attempts and completions counted separately).
      runs.attempted = Object.values(counts).reduce((a, b) => a + (b ?? 0), 0)
      runs.completed = counts.completus ?? 0
      runs.failed = counts.fractus ?? 0
      runs.inFlight = (counts.nascens ?? 0) + (counts.agens ?? 0)
    }
    const behaviour: Record<string, number> = {}
    if (behaviourStore) {
      const kinds = await behaviourStore.totals(since)
      for (const [kind, count] of Object.entries(kinds)) behaviour[kind] = count
    }
    res.json({
      revenue:   totals.revenue.toString(),
      count:     totals.count,
      failed:    totals.failed,
      ...(actorum?.statusCountsSince ? { runs } : {}),
      ...(behaviourStore ? { behaviour } : {}),
    })
  })

  // GET /internal/analytics/recent?limit=50&modusId=flux-dev&status=failed
  router.get('/recent', auth, async (req, res) => {
    const events = await wideStore.query({
      modusId: req.query.modusId ? String(req.query.modusId) : undefined,
      animaId: req.query.animaId ? String(req.query.animaId) : undefined,
      status:  req.query.status  as 'completed' | 'failed' | undefined,
      since:   req.query.since   ? new Date(String(req.query.since)) : undefined,
      limit:   req.query.limit   ? Number(req.query.limit) : 50,
    })
    res.json(events)
  })

  // GET /internal/analytics/funnel?since=2024-01-01 — clause 6: "where do visitors stop,"
  // answered directly rather than by reading logs by hand. Stages are distinct-owner counts
  // (catalog_view/quote/sign_in/funding_attempt from the behaviour corpus; run_attempt/
  // run_complete from Actorum/WideEvent) walked in the fixed order a visitor actually
  // experiences them.
  router.get('/funnel', auth, async (req, res) => {
    if (!behaviourStore) { res.status(503).json({ error: 'behaviour corpus not configured' }); return }
    const since = sinceParam(req)
    const counts: Record<string, number> = await behaviourStore.distinctOwnersByKind(since)
    if (actorum?.statusCountsSince) {
      const runCounts = await actorum.statusCountsSince(since)
      counts.run_attempt = Object.values(runCounts).reduce((a, b) => a + (b ?? 0), 0)
      counts.run_complete = runCounts.completus ?? 0
    }
    res.json({ since: since.toISOString(), stages: computeFunnel(DEFAULT_FUNNEL_ORDER, counts) })
  })

  return router
}
