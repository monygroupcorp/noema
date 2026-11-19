// =============================================================================
// querelaRouter — POST /v1/reports (in-app bug/feature/feedback/abuse reports)
// =============================================================================
//
// `abuse` is the reporting mechanism licence terms such as MiniMax H3's require: anyone can
// report a run whose output they believe breaks the terms. The report names the run; who OWNS
// it, and which terms its flow carried, are resolved here from the run itself — a reporter
// cannot point a strike at someone else by naming them. An admin's verdict on the report
// (querelaAdminRouter) is what counts toward suspension.
//
// Backend half of in-app reporting: persists a rich,
// kind-discriminated report to the private `Querela` store. No GitHub egress,
// no sanitizer — nothing here leaves the database (Decision record Q1).
//
// Anon-capable via all three identity classes (animaId, commitment, bursaToken)
// — a user hitting a bug may not be signed in. Mirrors the `auth()` seam used by
// `apiRouter.ts`/`storageRouter.ts` (bursaToken short-circuits to an anon bursa
// identity; everything else falls through to `identity.resolve`), NOT
// `vestigiaRouter.resolveCaller`, which throws on bursaToken (Decision record Q5).
// =============================================================================

import express, { type Request, type Response, type Router } from 'express'
import { createHash } from 'node:crypto'
import type { QuerelaStore, Querela, QuerelaCapturedState } from '../../types/Querela.js'
import type { AuctorKey } from '../../flow/types.js'
import type { Credentials } from '../../allocutio/api/IdentityResolver.js'
import { credentialsFromHeaders } from '../../allocutio/api/IdentityResolver.js'
import { ownerKeyOf } from '../../crystal/ownerKey.js'
import { ApiError, Errors } from '../../allocutio/api/errors.js'
import { makeLogger } from '../../lib/logger.js'

const log = makeLogger('querela:router')

export interface QuerelaRouterDeps {
  querelae: QuerelaStore
  identity: { resolve(creds: Credentials): Promise<AuctorKey> }
  /** The owner key of a run, and the licence terms its flow carries; null for no such run.
   *  Absent → abuse reports are refused, since none could name whom they are about. */
  resolveRun?: (runId: string) => Promise<{ ownerKey: string; useTerms: string[] } | null>
}

const KINDS = ['bug', 'feature', 'feedback', 'abuse'] as const
type Kind = typeof KINDS[number]

// Per-owner rate limit (Decision record Q3): anon DB spam is possible even with
// no public egress. A generous window — this guards against abuse, not normal use.
const RATE_LIMIT_MAX = 20
const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000

function computeContentHash(ownerKey: string, kind: Kind, description: string, featureOrRoute: string): string {
  return createHash('sha256').update(`${ownerKey}\0${kind}\0${description}\0${featureOrRoute}`).digest('hex')
}

export function createQuerelaRouter(deps: QuerelaRouterDeps): Router {
  const { querelae, identity } = deps
  const router = express.Router()

  /** Resolve the caller's AuctorKey. bursaToken in body/`x-bursa-token` header
   *  short-circuits to anon bursa identity (mirrors apiRouter.ts/storageRouter.ts's
   *  `auth()` — the noema-092 ownerKey-pattern seam, bursa-permitting by design). */
  async function resolveCaller(req: Request): Promise<AuctorKey> {
    const bursaToken = req.body?.bursaToken ?? (req.headers['x-bursa-token'] as string | undefined)
    if (bursaToken) return { bursaToken }
    return identity.resolve(credentialsFromHeaders(req.headers as Record<string, string | undefined>, req.body))
  }

  const wrap = (fn: (req: Request, res: Response) => Promise<void>) =>
    async (req: Request, res: Response): Promise<void> => {
      try {
        await fn(req, res)
      } catch (err) {
        if (err instanceof ApiError) {
          res.status(err.httpStatus).json({ error: err.toBody() })
        } else {
          log.error('unhandled querela error', { path: req.path, error: String((err as Error)?.stack ?? err) })
          res.status(500).json({ error: Errors.internal().toBody() })
        }
      }
    }

  // POST /reports — file a report. Mounted at `/v1/reports`.
  router.post('/', wrap(async (req, res) => {
    let auctor: AuctorKey
    try {
      auctor = await resolveCaller(req)
    } catch {
      throw Errors.authInvalid('could not resolve caller identity')
    }
    const ownerKey = ownerKeyOf(auctor)

    const body = req.body ?? {}
    const kind = body.kind as Kind
    if (!KINDS.includes(kind)) throw Errors.inputMalformed(`kind must be one of ${KINDS.join(', ')}`)
    const description = typeof body.description === 'string' ? body.description.trim() : ''
    if (!description) throw Errors.inputMalformed('description is required')

    const feature = kind === 'feature' && typeof body.feature === 'string' && body.feature.trim() ? body.feature.trim() : null
    let capturedState: QuerelaCapturedState | null = null
    if (kind === 'bug' && body.capturedState && typeof body.capturedState === 'object') {
      const cs = body.capturedState as Record<string, unknown>
      capturedState = {
        ...(typeof cs.route === 'string' ? { route: cs.route } : {}),
        ...(typeof cs.runId === 'string' ? { runId: cs.runId } : {}),
        ...(typeof cs.actumId === 'string' ? { actumId: cs.actumId } : {}),
      }
    }
    // An abuse report is about one run. Its subject and terms come from the run, not the body.
    let subjectOwnerKey: string | null = null
    let useTerms: string[] | null = null
    if (kind === 'abuse') {
      const cs = (body.capturedState && typeof body.capturedState === 'object') ? body.capturedState as Record<string, unknown> : {}
      const runId = typeof cs.runId === 'string' && cs.runId.trim() ? cs.runId.trim() : null
      if (!runId) throw Errors.inputMalformed('an abuse report names the run it is about (capturedState.runId)')
      if (!deps.resolveRun) throw Errors.internal('abuse reports are not available on this deployment')
      const run = await deps.resolveRun(runId)
      if (!run) throw Errors.notFoundRun(runId)
      subjectOwnerKey = run.ownerKey
      useTerms = run.useTerms
      capturedState = { runId, ...(typeof cs.route === 'string' ? { route: cs.route } : {}) }
    }
    const clientError = typeof body.clientError === 'string' ? body.clientError : null
    const device = typeof body.device === 'string' ? body.device : null
    const userAgent = typeof body.userAgent === 'string' ? body.userAgent : (req.headers['user-agent'] ?? null)

    // Dedup (Q3): identical report from the same owner returns the existing id, 200. An abuse
    // report dedups on the run, so one reporter repeating themselves files one report.
    const hashInput = kind === 'abuse' ? (capturedState?.runId ?? '') : (feature ?? capturedState?.route ?? '')
    const contentHash = computeContentHash(ownerKey, kind, kind === 'abuse' ? '' : description, hashInput)
    const existing = await querelae.findByOwnerAndHash(ownerKey, contentHash)
    if (existing) {
      res.status(200).json({ id: existing.id })
      return
    }

    // Rate limit (Q3): counted-window check against the (ownerKey, natum) index.
    const recent = await querelae.findByOwner(ownerKey)
    const windowStart = Date.now() - RATE_LIMIT_WINDOW_MS
    const recentCount = recent.filter(q => q.natum.getTime() >= windowStart).length
    if (recentCount >= RATE_LIMIT_MAX) {
      throw new ApiError('rate.limited', 'Too many reports — please try again later', 429, { retryable: true, retryAfter: RATE_LIMIT_WINDOW_MS / 1000 })
    }

    const record: Omit<Querela, 'id' | 'natum' | 'mutatum'> = {
      ownerKey,
      kind,
      status: 'new',
      description,
      feature,
      capturedState,
      clientError,
      device,
      userAgent: userAgent as string | null,
      contentHash,
      ...(kind === 'abuse' ? { subjectOwnerKey, useTerms, verdict: null } : {}),
    }
    const created = await querelae.create(record)
    res.status(200).json({ id: created.id })
  }))

  return router
}
