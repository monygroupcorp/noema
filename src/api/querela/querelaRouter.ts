// =============================================================================
// querelaRouter — POST /v1/reports (in-app bug/feature/feedback reports)
// =============================================================================
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
//
// That seam is mirrored INCLUDING its terminal-purse rule: a revoked or redeemed
// purse refuses its own token here too. Filing a report spends nothing, so this is
// not about credits — the token is what keys the report's owner and its rate-limit
// budget, so a code its owner revoked would go on writing rows into the private
// store under their name and go on consuming their window. Revocation that held
// only where money moved would not be revocation. Like `colloquiaRouter`, this
// surface takes `refuseTerminalPurse` alone and NOT the ANON_PURSE gate: an
// unfunded anonymous visitor is exactly who most needs to report a bug.
// =============================================================================

import express, { type Request, type Response, type Router } from 'express'
import { createHash } from 'node:crypto'
import type { QuerelaStore, Querela, QuerelaCapturedState } from '../../types/Querela.js'
import type { AuctorKey } from '../../flow/types.js'
import type { Bursarum } from '../../types/bursa.js'
import type { Credentials } from '../../allocutio/api/IdentityResolver.js'
import { credentialsFromHeaders } from '../../allocutio/api/IdentityResolver.js'
import { ownerKeyOf } from '../../crystal/ownerKey.js'
import { ApiError, Errors } from '../../allocutio/api/errors.js'
import { refuseTerminalPurse, TerminalPurseError } from '../../allocutio/api/bursaGate.js'
import { makeLogger } from '../../lib/logger.js'

const log = makeLogger('querela:router')

export interface QuerelaRouterDeps {
  querelae: QuerelaStore
  identity: { resolve(creds: Credentials): Promise<AuctorKey> }
  /** Reads the purse behind a presented token, so a terminal one can be refused. Required
   *  rather than optional: an absent store would admit every revoked code silently, which
   *  is the failure this exists to close. */
  bursarium: Pick<Bursarum, 'findByToken'>
}

const KINDS = ['bug', 'feature', 'feedback'] as const
type Kind = typeof KINDS[number]

// Per-owner rate limit (Decision record Q3): anon DB spam is possible even with
// no public egress. A generous window — this guards against abuse, not normal use.
const RATE_LIMIT_MAX = 20
const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000

function computeContentHash(ownerKey: string, kind: Kind, description: string, featureOrRoute: string): string {
  return createHash('sha256').update(`${ownerKey}\0${kind}\0${description}\0${featureOrRoute}`).digest('hex')
}

export function createQuerelaRouter(deps: QuerelaRouterDeps): Router {
  const { querelae, identity, bursarium } = deps
  const router = express.Router()

  /** Resolve the caller's AuctorKey. bursaToken in body/`x-bursa-token` header
   *  short-circuits to anon bursa identity (mirrors apiRouter.ts/storageRouter.ts's
   *  `auth()` — the noema-092 ownerKey-pattern seam, bursa-permitting by design), but
   *  only for a purse that is still live: a revoked or redeemed one refuses its own
   *  token here, before it can own a report or spend a rate-limit window. */
  async function resolveCaller(req: Request): Promise<AuctorKey> {
    const bursaToken = req.body?.bursaToken ?? (req.headers['x-bursa-token'] as string | undefined)
    if (bursaToken) {
      refuseTerminalPurse(await bursarium.findByToken(bursaToken))
      return { bursaToken }
    }
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
    } catch (err) {
      // A terminal purse is a DECIDED answer about a credential the caller definitely
      // holds, not a failure to read one, so it may not be flattened into the 401 below:
      // "could not work out who you are" would send the holder of a revoked code looking
      // for a sign-in problem instead of telling them the code was revoked.
      if (err instanceof TerminalPurseError) throw err
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
    const clientError = typeof body.clientError === 'string' ? body.clientError : null
    const device = typeof body.device === 'string' ? body.device : null
    const userAgent = typeof body.userAgent === 'string' ? body.userAgent : (req.headers['user-agent'] ?? null)

    // Dedup (Q3): identical report from the same owner returns the existing id, 200.
    const hashInput = feature ?? capturedState?.route ?? ''
    const contentHash = computeContentHash(ownerKey, kind, description, hashInput)
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
    }
    const created = await querelae.create(record)
    res.status(200).json({ id: created.id })
  }))

  return router
}
