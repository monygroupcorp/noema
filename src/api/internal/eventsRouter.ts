// =============================================================================
// eventsRouter — POST /v1/events (non-run visitor behaviour: catalog view,
// quote, sign-in, funding attempt)
// =============================================================================
//
// Mirrors querelaRouter's shape: anon-capable via all identity classes
// (bursaToken short-circuits, everything else falls through to identity.resolve),
// own hand-rolled per-owner rate limit, no CrystalApi facade.
//
// PRIVACY: the device bucket is derived from `req.headers['user-agent']` and
// ONLY the bucket is ever passed to buildBehaviourEvent — the raw header value
// never leaves this function. No IP is read anywhere in this file. A caller
// has no way to make this endpoint store a raw user-agent or an IP, by
// construction, not by convention.
// =============================================================================

import express, { type Request, type Response, type Router } from 'express'
import type { BehaviourEventStore } from '../../analytics/BehaviourEventStore.js'
import { BEHAVIOUR_EVENT_KINDS, buildBehaviourEvent, type BehaviourEventKind, type BehaviourEventMeta } from '../../analytics/BehaviourEvent.js'
import { deriveDeviceBucket } from '../../lib/deviceBucket.js'
import type { AuctorKey } from '../../flow/types.js'
import type { Credentials } from '../../allocutio/api/IdentityResolver.js'
import { credentialsFromHeaders } from '../../allocutio/api/IdentityResolver.js'
import { ApiError, Errors } from '../../allocutio/api/errors.js'
import { makeLogger } from '../../lib/logger.js'

const log = makeLogger('events:router')

export interface EventsRouterDeps {
  events: BehaviourEventStore
  identity: { resolve(creds: Credentials): Promise<AuctorKey> }
}

// Generous counted-window per-owner limit — this guards against a runaway client loop,
// not normal browsing. In-memory by design: losing the counter on a restart costs nothing
// worse than one extra fresh window, and a Mongo round trip per catalog view would be
// disproportionate to the cost of recording one.
const RATE_LIMIT_MAX = 300
const RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000
const hits = new Map<string, { count: number; resetAt: number }>()

function rateLimited(ownerKey: string): boolean {
  const now = Date.now()
  const entry = hits.get(ownerKey)
  if (!entry || entry.resetAt <= now) {
    hits.set(ownerKey, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS })
    return false
  }
  entry.count++
  return entry.count > RATE_LIMIT_MAX
}

const META_KEYS: Array<keyof BehaviourEventMeta> = ['modusId', 'method', 'packageId']
const SIGN_IN_METHODS = new Set(['telegram', 'wallet', 'email', 'password', 'federated'])

function sanitizeMeta(body: Record<string, unknown>): BehaviourEventMeta | undefined {
  const out: BehaviourEventMeta = {}
  for (const key of META_KEYS) {
    const v = body[key]
    if (typeof v !== 'string' || !v.trim()) continue
    if (key === 'method' && !SIGN_IN_METHODS.has(v)) continue
    ;(out as Record<string, string>)[key] = v.trim().slice(0, 200)
  }
  return Object.keys(out).length ? out : undefined
}

export function createEventsRouter(deps: EventsRouterDeps): Router {
  const { events, identity } = deps
  const router = express.Router()

  async function resolveCaller(req: Request): Promise<AuctorKey> {
    const bursaToken = req.body?.bursaToken ?? (req.headers['x-bursa-token'] as string | undefined)
    if (bursaToken) return { bursaToken }
    return identity.resolve(credentialsFromHeaders(req.headers as Record<string, string | undefined>, req.body))
  }

  router.post('/', async (req: Request, res: Response) => {
    try {
      let auctor: AuctorKey
      try {
        auctor = await resolveCaller(req)
      } catch {
        // Clause 3: every event is keyed on identity already in hand. No identity in
        // hand → nothing is recorded, and no fallback (e.g. an IP) ever stands in for one.
        throw Errors.authInvalid('could not resolve caller identity')
      }

      const body = (req.body ?? {}) as Record<string, unknown>
      const kind = body.kind as BehaviourEventKind
      if (!BEHAVIOUR_EVENT_KINDS.includes(kind)) {
        throw Errors.inputMalformed(`kind must be one of ${BEHAVIOUR_EVENT_KINDS.join(', ')}`)
      }

      const ownerKey = 'animaId' in auctor ? `anima:${auctor.animaId}`
        : 'bursaToken' in auctor ? `bursa:${auctor.bursaToken}`
        : `commitment:${auctor.commitment}`
      if (rateLimited(ownerKey)) {
        throw new ApiError('rate.limited', 'Too many events — please slow down', 429, { retryable: true, retryAfter: RATE_LIMIT_WINDOW_MS / 1000 })
      }

      // Server-derives the bucket from the header it controls — a client-supplied
      // userAgent/device field in the body is never read, so this cannot be spoofed
      // into carrying a raw string through.
      const device = deriveDeviceBucket(req.headers['user-agent'])
      const platform = typeof body.platform === 'string' ? body.platform.slice(0, 40) : undefined
      const event = buildBehaviourEvent(kind, auctor, device, { platform, meta: sanitizeMeta(body) })
      await events.save(event)
      res.status(204).end()
    } catch (err) {
      if (err instanceof ApiError) {
        res.status(err.httpStatus).json({ error: err.toBody() })
      } else {
        log.error('unhandled events error', { path: req.path, error: String((err as Error)?.stack ?? err) })
        res.status(500).json({ error: Errors.internal().toBody() })
      }
    }
  })

  return router
}
