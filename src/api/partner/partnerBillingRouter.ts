// =============================================================================
// partnerBillingRouter — GET/POST /v1/admin/partner-billing (read a partner's
// meter, and issue the invoice drawn from it)
// =============================================================================
//
// The platform's side of the B2B billing desk, split from `partnerAdminRouter.ts` the same
// way that file is split from the public `partnerRequestRouter.ts`: one resource, one
// surface. The review queue decides who may buy; this decides what they owe.
//
// Gate: PLATFORM-ADMIN ONLY, the same predicate `partnerAdminRouter.ts` reproduces from
// `CrystalApi._assertPlatformAdmin` — same env var, same fallback, same comparison, same
// message. Reproduced again here for the same reason it is reproduced there (this router,
// like its siblings, is not built on the CrystalApi facade), and it must change with it.
//
// WHY ISSUING IS A REQUEST AND NOT A CRON. Issuing is the act that fixes what a customer
// owes for a period; after it, the meter can keep moving and the bill does not. A schedule
// can be hung off this route later, and the route is the same either way — but the first
// invoice a customer receives goes out under someone's hand, and the period-collision
// refusal in the store means a second press bills nobody twice.
//
// The partner's OWN reads of the same facts live on the `/v1/me/partner/*` surface
// (`apiRouter.ts`): the meter the invoice was drawn from, and the invoices themselves.
// =============================================================================

import express, { type Request, type Response, type Router } from 'express'
import type { PartnerStore } from '../../types/partner.js'
import type { PartnerUsageStore } from '../../types/partnerUsage.js'
import type { PartnerInvoiceStore } from '../../types/partnerInvoice.js'
import type { AuctorKey } from '../../flow/types.js'
import type { Credentials } from '../../allocutio/api/IdentityResolver.js'
import { credentialsFromHeaders } from '../../allocutio/api/IdentityResolver.js'
import { ApiError, Errors } from '../../allocutio/api/errors.js'
import { draftInvoice } from '../../ledger/partnerInvoicing.js'
import { makeLogger } from '../../lib/logger.js'

const log = makeLogger('partner:billing-router')

export interface PartnerBillingRouterDeps {
  partners: PartnerStore
  usage: PartnerUsageStore
  invoices: PartnerInvoiceStore
  identity: { resolve(creds: Credentials): Promise<AuctorKey> }
}

// Reproduces CrystalApi.ts's `_assertPlatformAdmin` verbatim — see file header.
const PLATFORM_ANIMA_ID = process.env.PLATFORM_ANIMA_ID ?? 'platform'
function assertPlatformAdmin(auctor: AuctorKey): void {
  if (!('animaId' in auctor) || auctor.animaId !== PLATFORM_ANIMA_ID) {
    throw Errors.authForbidden('this operation is restricted to the platform administrator')
  }
}

/** Parse a half-open `[from, to)` period. Both bounds required and ISO-8601: a billing period
 *  with a defaulted edge is a bill nobody can check, and the caller knows which period it means. */
export function parsePeriod(fromRaw: unknown, toRaw: unknown): { from: Date; to: Date } {
  const parse = (raw: unknown, name: 'from' | 'to'): Date => {
    if (typeof raw !== 'string' || raw.length === 0) throw Errors.inputMalformed(`${name} is required — an ISO-8601 timestamp`)
    const at = new Date(raw)
    if (Number.isNaN(at.getTime())) throw Errors.inputMalformed(`${name} must be an ISO-8601 timestamp`)
    return at
  }
  const from = parse(fromRaw, 'from')
  const to = parse(toRaw, 'to')
  if (to.getTime() <= from.getTime()) throw Errors.inputMalformed('to must be after from')
  return { from, to }
}

export function createPartnerBillingRouter(deps: PartnerBillingRouterDeps): Router {
  const { partners, usage, invoices, identity } = deps
  const router = express.Router()

  async function resolveAdmin(req: Request): Promise<void> {
    const auctor = await identity.resolve(
      credentialsFromHeaders(req.headers as Record<string, string | undefined>, req.body),
    )
    assertPlatformAdmin(auctor)
  }

  const wrap = (fn: (req: Request, res: Response) => Promise<void>) =>
    async (req: Request, res: Response): Promise<void> => {
      try {
        await fn(req, res)
      } catch (err) {
        if (err instanceof ApiError) {
          res.status(err.httpStatus).json({ error: err.toBody() })
        } else {
          log.error('unhandled partner billing error', { path: req.path, error: String((err as Error)?.stack ?? err) })
          res.status(500).json({ error: Errors.internal().toBody() })
        }
      }
    }

  // GET /:animaId/usage?from&to — what an invoice for this window would say, before one is
  // issued. The same rollup the partner reads for itself at `GET /v1/me/partner/usage`, from the
  // other side of the desk. Mounted at `/v1/admin/partner-billing/:animaId/usage`.
  router.get('/:animaId/usage', wrap(async (req, res) => {
    await resolveAdmin(req)
    const animaId = String(req.params.animaId)
    const { from, to } = parsePeriod(req.query.from, req.query.to)
    res.status(200).json({ animaId, from, to, rollup: await usage.sumPeriod(animaId, from, to) })
  }))

  // POST /:animaId/invoices — issue an invoice for a period, drawn from the meter.
  // Body: `{ from, to, issuedAt? }`, ISO-8601, window half-open `[from, to)`.
  // Mounted at `/v1/admin/partner-billing/:animaId/invoices`.
  router.post('/:animaId/invoices', wrap(async (req, res) => {
    await resolveAdmin(req)
    const animaId = String(req.params.animaId)
    const partner = await partners.find(animaId)
    if (!partner || partner.status === 'revoked') throw Errors.notFoundPartner()
    if (!partner.billing) throw Errors.partnerBillingRequired()
    const { from, to } = parsePeriod(req.body?.from, req.body?.to)

    let issuedAt: Date | undefined
    if (req.body?.issuedAt !== undefined) {
      issuedAt = new Date(String(req.body.issuedAt))
      if (Number.isNaN(issuedAt.getTime())) throw Errors.inputMalformed('issuedAt must be an ISO-8601 timestamp')
    }

    try {
      const invoice = await draftInvoice(
        { usage, invoices },
        { animaId, billing: partner.billing, periodStart: from, periodEnd: to, ...(issuedAt ? { issuedAt } : {}) },
      )
      res.status(200).json({ invoice })
    } catch (err) {
      // The store's once-per-period refusal, turned into the 409 it is. A 500 here would report
      // an internal fault for an admin asking a reasonable question and being told the period is
      // already billed.
      const message = err instanceof Error ? err.message : String(err)
      if (message.includes('already billed for this period')) {
        throw Errors.conflictPeriodAlreadyBilled(animaId, `${from.toISOString()} to ${to.toISOString()}`)
      }
      throw err
    }
  }))

  // GET /:animaId/invoices — every invoice issued to this partner, newest first.
  // Mounted at `/v1/admin/partner-billing/:animaId/invoices`.
  router.get('/:animaId/invoices', wrap(async (req, res) => {
    await resolveAdmin(req)
    res.status(200).json({ invoices: await invoices.list(String(req.params.animaId)) })
  }))

  return router
}
