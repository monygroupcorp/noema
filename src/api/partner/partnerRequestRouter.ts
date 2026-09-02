// =============================================================================
// partnerRequestRouter — POST /v1/partner-requests (public B2B partner intake)
// =============================================================================
//
// The front door of the B2B partner program: anyone can ask to become a
// partner, no auth required. Modeled directly on `querelaRouter.ts` (the
// codebase's other public, anon-capable write route): same response envelope,
// same hand-rolled counted-window rate limit, same error wrapping — NOT
// `express-rate-limit` (that middleware is reserved for the credential-
// stuffing surface in `authRouter.ts`).
//
// IDENTITY IS OPPORTUNISTIC, NOT REQUIRED — this is the one thing that differs
// from querelaRouter's `resolveCaller` (which THROWS `auth.invalid` when
// resolution fails). A fully anonymous visitor has no resolvable `AuctorKey` at
// all — `IdentityResolver.resolve` throws `auth.missing` when no credential of
// any kind is present (see its header). Here we TRY to resolve identity so a
// submitter who happens to be logged in gets their `animaId` attached to the
// request (useful context for the reviewer, and the thing that makes approval
// able to provision a real account later) — but ANY resolution failure
// (missing credential, invalid credential, unconfigured acceptor) is silently
// swallowed and the request proceeds with `animaId: undefined`. A resolved
// identity that is NOT animaId-bearing (an anonymous `commitment` spend
// identity) also leaves `animaId` undefined — there is nothing to attach.
//
// Rate limit: 5 requests per contactEmail per hour. Keyed on a HASH of the
// (normalized) email, not `ownerKey` — most submitters have no identity at
// all, so `ownerKey` would collapse every anonymous submitter onto the same
// bucket. Mirrors `ownerKeyOf`'s discipline of hashing bearer-ish identifiers
// rather than storing them raw as a lookup key.
// =============================================================================

import express, { type Request, type Response, type Router } from 'express'
import { createHash } from 'node:crypto'
import type { PartnerRequestStore } from '../../types/partnerRequest.js'
import type { AuctorKey } from '../../flow/types.js'
import type { Credentials } from '../../allocutio/api/IdentityResolver.js'
import { credentialsFromHeaders } from '../../allocutio/api/IdentityResolver.js'
import { ApiError, Errors } from '../../allocutio/api/errors.js'
import { makeLogger } from '../../lib/logger.js'

const log = makeLogger('partner:request-router')

export interface PartnerRequestRouterDeps {
  partnerRequests: PartnerRequestStore
  identity: { resolve(creds: Credentials): Promise<AuctorKey> }
}

const RATE_LIMIT_MAX = 5
const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase()
}

/** Opaque rate-limit key derived from a normalized email — mirrors `ownerKeyOf`'s
 *  hashing of bearer-ish identifiers so the raw email is never used as a lookup key. */
export function emailKeyOf(email: string): string {
  return `email:${createHash('sha256').update(normalizeEmail(email)).digest('hex')}`
}

export function createPartnerRequestRouter(deps: PartnerRequestRouterDeps): Router {
  const { partnerRequests, identity } = deps
  const router = express.Router()

  /** Try to resolve the submitter's identity. ANY failure (no credential, an
   *  invalid one, an unconfigured acceptor) degrades to `undefined` — this route
   *  is never gated on identity. A resolved non-animaId identity (an anonymous
   *  `commitment`) also yields `undefined` — there is no anima to attach. */
  async function tryResolveAnimaId(req: Request): Promise<string | undefined> {
    try {
      const auctor = await identity.resolve(
        credentialsFromHeaders(req.headers as Record<string, string | undefined>, req.body),
      )
      return 'animaId' in auctor ? auctor.animaId : undefined
    } catch {
      return undefined
    }
  }

  const wrap = (fn: (req: Request, res: Response) => Promise<void>) =>
    async (req: Request, res: Response): Promise<void> => {
      try {
        await fn(req, res)
      } catch (err) {
        if (err instanceof ApiError) {
          res.status(err.httpStatus).json({ error: err.toBody() })
        } else {
          log.error('unhandled partner-request error', { path: req.path, error: String((err as Error)?.stack ?? err) })
          res.status(500).json({ error: Errors.internal().toBody() })
        }
      }
    }

  // POST / — file a partner-program intake request. Mounted at `/v1/partner-requests`. Public.
  router.post('/', wrap(async (req, res) => {
    const body = req.body ?? {}

    const contactEmail = typeof body.contactEmail === 'string' ? body.contactEmail.trim() : ''
    if (!contactEmail || !EMAIL_RE.test(contactEmail)) {
      throw Errors.inputMalformed('a valid contactEmail is required')
    }
    const useCase = typeof body.useCase === 'string' ? body.useCase.trim() : ''
    if (!useCase) throw Errors.inputMalformed('useCase is required')

    const nomen = typeof body.nomen === 'string' && body.nomen.trim() ? body.nomen.trim() : undefined
    const org = typeof body.org === 'string' && body.org.trim() ? body.org.trim() : undefined
    const notes = typeof body.notes === 'string' && body.notes.trim() ? body.notes.trim() : undefined

    const animaId = await tryResolveAnimaId(req)

    // Rate limit (5/hour/email): counted-window check against the emailKey index —
    // mirrors querelaRouter.ts's per-owner check, adapted to key on the submitter's
    // (hashed, normalized) email since most submitters have no resolvable identity.
    const emailKey = emailKeyOf(contactEmail)
    const recent = await partnerRequests.findByEmailKey(emailKey)
    const windowStart = Date.now() - RATE_LIMIT_WINDOW_MS
    const recentCount = recent.filter(r => r.natum.getTime() >= windowStart).length
    if (recentCount >= RATE_LIMIT_MAX) {
      throw new ApiError('rate.limited', 'Too many partner requests from this email — please try again later', 429, {
        retryable: true,
        retryAfter: RATE_LIMIT_WINDOW_MS / 1000,
      })
    }

    const created = await partnerRequests.create({
      contactEmail,
      useCase,
      emailKey,
      ...(nomen !== undefined ? { nomen } : {}),
      ...(org !== undefined ? { org } : {}),
      ...(notes !== undefined ? { notes } : {}),
      ...(animaId !== undefined ? { animaId } : {}),
    })
    res.status(200).json({ id: created.id })
  }))

  return router
}
