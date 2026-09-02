// =============================================================================
// querelaAdminRouter — GET/PATCH /v1/admin/reports (admin read + triage of
// submitted Querela reports)
// =============================================================================
//
// The read half of the private Querela store (see src/types/Querela.ts's header:
// no GitHub egress, no sanitizer — nothing here leaves the database, and this
// router doesn't change that). Split out of the public `querelaRouter.ts` (which
// only ever does `POST /v1/reports`) into its own file, the same way
// `treasuryAdminRouter.ts` sits apart from the public treasury routes — this is
// the admin half of one resource's two surfaces.
//
// Read + triage only: list across every owner, and flip `status` via the
// existing `QuerelaStore.update()`. No threading, no reply-to-submitter, no
// notifications — those stay out of scope for this item.
//
// Gate: PLATFORM-ADMIN ONLY, the exact predicate `CrystalApi._assertPlatformAdmin`
// enforces (`auctor.animaId === PLATFORM_ANIMA_ID` — a single hardcoded admin
// identity, not a role system). That method is private to `CrystalApi` and this
// router does not depend on the `CrystalApi` facade (`querelaRouter.ts` doesn't
// either — it's a small, directly-injected `QuerelaStore` router), so the
// predicate is reproduced here verbatim: same env var, same fallback, same
// comparison, same forbidden message. This mirrors how `PLATFORM_ANIMA_ID` is
// already re-declared per-file (not imported from one place) in
// src/ledger/hooks/{platformSkim,studioSpend,sessionSpend}.ts. If
// `_assertPlatformAdmin` ever changes, this must change with it.
//
// Identity resolution mirrors `vestigiaRouter.ts`'s `resolveCaller` (cited in
// querelaRouter.ts's header as the OTHER seam) — a plain `identity.resolve(...)`,
// its own `ApiError`s (auth.missing / auth.invalid) left to propagate as-is. No
// bursaToken short-circuit: unlike the public submit route, this surface is
// never anon-capable, so there's nothing to short-circuit.
// =============================================================================

import express, { type Request, type Response, type Router } from 'express'
import type { QuerelaStore, Querela } from '../../types/Querela.js'
import type { AuctorKey } from '../../flow/types.js'
import type { Credentials } from '../../allocutio/api/IdentityResolver.js'
import { credentialsFromHeaders } from '../../allocutio/api/IdentityResolver.js'
import { ApiError, Errors } from '../../allocutio/api/errors.js'
import { makeLogger } from '../../lib/logger.js'

const log = makeLogger('querela:admin-router')

export interface QuerelaAdminRouterDeps {
  querelae: QuerelaStore
  identity: { resolve(creds: Credentials): Promise<AuctorKey> }
}

const KINDS = ['bug', 'feature', 'feedback'] as const
type Kind = typeof KINDS[number]
const STATUSES = ['new', 'closed'] as const
type Status = typeof STATUSES[number]

// Reproduces CrystalApi.ts's `_assertPlatformAdmin` verbatim (same env var, same
// fallback, same predicate, same message) — see file header for why this is a
// deliberate duplication rather than an import.
const PLATFORM_ANIMA_ID = process.env.PLATFORM_ANIMA_ID ?? 'platform'
function assertPlatformAdmin(auctor: AuctorKey): void {
  if (!('animaId' in auctor) || auctor.animaId !== PLATFORM_ANIMA_ID) {
    throw Errors.authForbidden('this operation is restricted to the platform administrator')
  }
}

export function createQuerelaAdminRouter(deps: QuerelaAdminRouterDeps): Router {
  const { querelae, identity } = deps
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
          log.error('unhandled querela admin error', { path: req.path, error: String((err as Error)?.stack ?? err) })
          res.status(500).json({ error: Errors.internal().toBody() })
        }
      }
    }

  // GET /reports — list submitted reports across ALL owners (platform-admin only).
  // Mounted at `/v1/admin/reports`. Optional ?kind= / ?status= narrow the result.
  router.get('/', wrap(async (req, res) => {
    await resolveAdmin(req)

    const kindRaw = req.query.kind
    const kind = typeof kindRaw === 'string' ? kindRaw : undefined
    if (kind !== undefined && !KINDS.includes(kind as Kind)) {
      throw Errors.inputMalformed(`kind must be one of ${KINDS.join(', ')}`)
    }
    const statusRaw = req.query.status
    const status = typeof statusRaw === 'string' ? statusRaw : undefined
    if (status !== undefined && !STATUSES.includes(status as Status)) {
      throw Errors.inputMalformed(`status must be one of ${STATUSES.join(', ')}`)
    }

    const reports = await querelae.list({
      ...(kind !== undefined ? { kind: kind as Kind } : {}),
      ...(status !== undefined ? { status: status as Status } : {}),
    })
    res.status(200).json({ reports })
  }))

  // PATCH /reports/:id — triage: set status. Mounted at `/v1/admin/reports/:id`.
  // Uses the existing `QuerelaStore.update()` — no new mutation logic.
  router.patch('/:id', wrap(async (req, res) => {
    await resolveAdmin(req)

    const status = req.body?.status
    if (typeof status !== 'string' || !STATUSES.includes(status as Status)) {
      throw Errors.inputMalformed(`status must be one of ${STATUSES.join(', ')}`)
    }

    const id = String(req.params.id)
    const existing = await querelae.find(id)
    if (!existing) throw Errors.notFoundQuerela(id)

    const updated: Querela = await querelae.update(id, { status: status as Status })
    res.status(200).json({ report: updated })
  }))

  return router
}
