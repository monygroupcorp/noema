// =============================================================================
// partnerAdminRouter — GET/PATCH /v1/admin/partner-requests (admin review +
// approval-provisioning of the B2B partner program intake queue)
// =============================================================================
//
// Read + decide the queue `partnerRequestRouter.ts` fills. Split into its own
// file the same way `querelaAdminRouter.ts` sits apart from the public
// `querelaRouter.ts` — the admin half of one resource's two surfaces.
//
// Gate: PLATFORM-ADMIN ONLY, the exact predicate `CrystalApi._assertPlatformAdmin`
// enforces (`auctor.animaId === PLATFORM_ANIMA_ID` — a single hardcoded admin
// identity, not a role system). That method is private to `CrystalApi`, and
// this router — like `querelaRouter.ts`/`querelaAdminRouter.ts` — is
// intentionally not built on the CrystalApi facade, so the predicate is
// reproduced here VERBATIM: same env var, same fallback, same comparison, same
// forbidden message. Mirrors the precedent of `PLATFORM_ANIMA_ID` being
// re-declared per-file (not imported from one place) in
// `src/ledger/hooks/{platformSkim,studioSpend,sessionSpend}.ts` and in
// `querelaAdminRouter.ts`. If `_assertPlatformAdmin` ever changes, this must
// change with it.
//
// PROVISIONING ON APPROVAL:
//   - Approving a request that carries an `animaId` creates exactly one
//     `Partner` record for that animaId (reused if one already exists — see
//     inline comment). It does NOT mint an API key. The admin approving a
//     request is frequently NOT the partner (the whole point of a review
//     queue is a third party deciding on someone else's application) — handing
//     the raw key to whoever clicked Approve would hand a credential to the
//     wrong person. Key issuance is self-serve, by the partner themselves,
//     once they can see they're approved: see `rotatePartnerApiKey`
//     (`src/crystal/apiKeys.ts`) called from the partner-only route in
//     `apiRouter.ts`. This router never touches a key at all.
//   - Approving a request with NO `animaId` (a fully anonymous submission)
//     ONLY flips `status` to `'approved'`. No `Partner` record either.
//     This is a DELIBERATE gap: there is no email-verified signup flow in this
//     codebase to safely close it (an email address alone is not proof of
//     control over any account). Not a bug — see `partnerRequest.ts`'s header.
//   - A request that already has a decision (`status !== 'pending'`) refuses
//     a second PATCH with `409 conflict.already_decided`.
// =============================================================================

import express, { type Request, type Response, type Router } from 'express'
import type { PartnerRequestStore } from '../../types/partnerRequest.js'
import type { PartnerStore } from '../../types/partner.js'
import type { AuctorKey } from '../../flow/types.js'
import type { Credentials } from '../../allocutio/api/IdentityResolver.js'
import { credentialsFromHeaders } from '../../allocutio/api/IdentityResolver.js'
import { ApiError, Errors } from '../../allocutio/api/errors.js'
import { makeLogger } from '../../lib/logger.js'

const log = makeLogger('partner:admin-router')

export interface PartnerAdminRouterDeps {
  partnerRequests: PartnerRequestStore
  partners: PartnerStore
  identity: { resolve(creds: Credentials): Promise<AuctorKey> }
}

const REQUEST_STATUSES = ['pending', 'approved', 'declined'] as const
type RequestStatus = typeof REQUEST_STATUSES[number]
const DECISIONS = ['approved', 'declined'] as const
type Decision = typeof DECISIONS[number]

// Reproduces CrystalApi.ts's `_assertPlatformAdmin` verbatim — see file header for why this
// is a deliberate duplication rather than an import.
const PLATFORM_ANIMA_ID = process.env.PLATFORM_ANIMA_ID ?? 'platform'
function assertPlatformAdmin(auctor: AuctorKey): void {
  if (!('animaId' in auctor) || auctor.animaId !== PLATFORM_ANIMA_ID) {
    throw Errors.authForbidden('this operation is restricted to the platform administrator')
  }
}

export function createPartnerAdminRouter(deps: PartnerAdminRouterDeps): Router {
  const { partnerRequests, partners, identity } = deps
  const router = express.Router()

  /** Resolve the caller's AuctorKey and assert platform-admin. Any credential
   *  failure surfaces `identity.resolve`'s own ApiError (auth.missing/auth.invalid)
   *  unchanged; a resolved-but-non-admin caller gets auth.forbidden. */
  async function resolveAdmin(req: Request): Promise<AuctorKey> {
    const auctor = await identity.resolve(
      credentialsFromHeaders(req.headers as Record<string, string | undefined>, req.body),
    )
    assertPlatformAdmin(auctor)
    return auctor
  }

  const wrap = (fn: (req: Request, res: Response) => Promise<void>) =>
    async (req: Request, res: Response): Promise<void> => {
      try {
        await fn(req, res)
      } catch (err) {
        if (err instanceof ApiError) {
          res.status(err.httpStatus).json({ error: err.toBody() })
        } else {
          log.error('unhandled partner admin error', { path: req.path, error: String((err as Error)?.stack ?? err) })
          res.status(500).json({ error: Errors.internal().toBody() })
        }
      }
    }

  // GET / — list partner requests across ALL submitters (platform-admin only).
  // Mounted at `/v1/admin/partner-requests`. Optional ?status= narrows the result.
  router.get('/', wrap(async (req, res) => {
    await resolveAdmin(req)

    const statusRaw = req.query.status
    const status = typeof statusRaw === 'string' ? statusRaw : undefined
    if (status !== undefined && !REQUEST_STATUSES.includes(status as RequestStatus)) {
      throw Errors.inputMalformed(`status must be one of ${REQUEST_STATUSES.join(', ')}`)
    }

    const requests = await partnerRequests.list(status !== undefined ? { status: status as RequestStatus } : undefined)
    res.status(200).json({ requests })
  }))

  // PATCH /:id — decide a request: approve or decline. Approving a request that carries an
  // animaId provisions a Partner record and nothing else — no API key is minted here (see this
  // file's header for why the key is the partner's own, self-serve call). Either decision is
  // visible to the applicant at `GET /v1/me/partner-request`; nothing mails them.
  // Mounted at `/v1/admin/partner-requests/:id`.
  router.patch('/:id', wrap(async (req, res) => {
    const auctor = await resolveAdmin(req)
    // Safe post-`assertPlatformAdmin`: it throws unless `'animaId' in auctor`.
    const adminAnimaId = (auctor as { animaId: string }).animaId

    const status = req.body?.status
    if (typeof status !== 'string' || !DECISIONS.includes(status as Decision)) {
      throw Errors.inputMalformed(`status must be one of ${DECISIONS.join(', ')}`)
    }

    const id = String(req.params.id)
    const existing = await partnerRequests.find(id)
    if (!existing) throw Errors.notFoundPartnerRequest(id)
    if (existing.status !== 'pending') {
      throw Errors.conflictAlreadyDecided(id, existing.status)
    }

    let partnerAnimaId: string | undefined

    if (status === 'approved' && existing.animaId) {
      const animaId = existing.animaId
      // Reuse an existing Partner record for this animaId if one is already there (e.g. a
      // second, unrelated partner request from someone already approved once) — never a
      // second Partner row for the same animaId. No key is minted here — see this file's
      // header: the partner mints their own, self-serve, once they see they're approved.
      const existingPartner = await partners.find(animaId)
      if (!existingPartner) {
        await partners.create({ animaId, sourceRequestId: existing.id, ...(existing.org ? { org: existing.org } : {}), contactEmail: existing.contactEmail })
      }
      partnerAnimaId = animaId
    }

    const updated = await partnerRequests.update(id, { status: status as Decision, decidedAt: new Date(), decidedBy: adminAnimaId })

    res.status(200).json({
      request: updated,
      ...(partnerAnimaId ? { partner: await partners.find(partnerAnimaId) } : {}),
    })
  }))

  return router
}
