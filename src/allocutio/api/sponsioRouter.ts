// =============================================================================
// sponsioRouter — user-facing sponsorship management (ADR-0011 §2).
// =============================================================================
//
//   POST /v1/sponsorships          — pledge to top up a beneficiary on a cadence
//   GET  /v1/sponsorships          — the caller's own pledges
//   POST /v1/sponsorships/:id/pause  | /resume   — hold / release a pledge
//
// The sponsor is ALWAYS the authenticated caller's Anima (you can only pledge your
// own pool). Anyone can fund that pool with a normal ledger transfer — the pooled-
// singular model means there is no group to manage here. The sweeper (SubsidySweeper)
// does the actual dripping; this router only manages pledges.

import express, { type Router, type Request, type Response } from 'express'
import type { SponsioStore, SubsidyCadence } from '../../types/sponsio.js'
import type { AuctorKey } from '../../flow/types.js'
import type { Credentials } from './IdentityResolver.js'
import { credentialsFromHeaders } from './IdentityResolver.js'

export interface SponsioRouterDeps {
  sponsiones: SponsioStore
  identity: { resolve(creds: Credentials): Promise<AuctorKey> }
}

const CADENCES: SubsidyCadence[] = ['weekly', 'biweekly', 'monthly']

function fail(res: Response, status: number, code: string, message: string): void {
  res.status(status).json({ error: { code, message } })
}

/** Positive-bigint parser from a JSON number or decimal string. */
function toPositiveBig(raw: unknown): bigint | null {
  if (typeof raw === 'number' && Number.isInteger(raw) && raw > 0) return BigInt(raw)
  if (typeof raw === 'string' && /^[0-9]+$/.test(raw) && raw !== '0') return BigInt(raw)
  return null
}
function toNonNegBigOrUndef(raw: unknown): bigint | null | undefined {
  if (raw === undefined || raw === null) return undefined
  if (typeof raw === 'number' && Number.isInteger(raw) && raw >= 0) return BigInt(raw)
  if (typeof raw === 'string' && /^[0-9]+$/.test(raw)) return BigInt(raw)
  return null // present but malformed
}

export function createSponsioRouter(deps: SponsioRouterDeps): Router {
  const router = express.Router()

  /** The caller must be an identified Anima (sponsorship needs a fundable pool). */
  async function requireAnima(req: Request, res: Response): Promise<string | null> {
    let auctor: AuctorKey
    try {
      auctor = await deps.identity.resolve(credentialsFromHeaders(req.headers as Record<string, string | undefined>, req.body))
    } catch {
      fail(res, 401, 'auth.invalid', 'Authentication required to manage sponsorships')
      return null
    }
    if (!('animaId' in auctor)) {
      fail(res, 403, 'auth.forbidden', 'Sponsorship requires an identified account')
      return null
    }
    return auctor.animaId
  }

  // POST /v1/sponsorships — create a pledge from the caller's pool to a beneficiary.
  router.post('/', async (req: Request, res: Response): Promise<void> => {
    const sponsorId = await requireAnima(req, res)
    if (!sponsorId) return

    const beneficiaryId = req.body?.beneficiaryAnimaId
    if (typeof beneficiaryId !== 'string' || !beneficiaryId) return fail(res, 400, 'input.malformed', 'beneficiaryAnimaId is required')
    if (beneficiaryId === sponsorId) return fail(res, 400, 'input.malformed', 'cannot sponsor yourself')

    const grant = toPositiveBig(req.body?.grant)
    if (grant === null) return fail(res, 400, 'input.malformed', 'grant must be a positive integer (impetus points)')

    const cadence = req.body?.cadence
    if (!CADENCES.includes(cadence)) return fail(res, 400, 'input.malformed', `cadence must be one of ${CADENCES.join(', ')}`)

    const balanceCap = toNonNegBigOrUndef(req.body?.balanceCap)
    if (balanceCap === null) return fail(res, 400, 'input.malformed', 'balanceCap must be a non-negative integer')
    const capTotal = toNonNegBigOrUndef(req.body?.capTotal)
    if (capTotal === null) return fail(res, 400, 'input.malformed', 'capTotal must be a non-negative integer')

    const sponsio = await deps.sponsiones.create({
      sponsor: { animaId: sponsorId },
      beneficiarius: { animaId: beneficiaryId },
      subsidia: { grant, cadence, ...(balanceCap !== undefined ? { balanceCap } : {}) },
      ...(capTotal !== undefined ? { capTotal } : {}),
    })
    res.status(200).json({ sponsorship: serialize(sponsio) })
  })

  // GET /v1/sponsorships — the caller's own pledges.
  router.get('/', async (req: Request, res: Response): Promise<void> => {
    const sponsorId = await requireAnima(req, res)
    if (!sponsorId) return
    const mine = await deps.sponsiones.listBySponsor(sponsorId)
    res.status(200).json({ sponsorships: mine.map(serialize) })
  })

  // POST /v1/sponsorships/:id/(pause|resume) — owner-gated lifecycle.
  for (const [verb, status] of [['pause', 'paused'], ['resume', 'active']] as const) {
    router.post(`/:id/${verb}`, async (req: Request, res: Response): Promise<void> => {
      const sponsorId = await requireAnima(req, res)
      if (!sponsorId) return
      const s = await deps.sponsiones.find(String(req.params.id))
      if (!s || s.sponsor.animaId !== sponsorId) return fail(res, 404, 'not_found.sponsorship', 'Sponsorship not found')
      if (s.status === 'exhausted') return fail(res, 409, 'conflict.exhausted', 'Sponsorship has reached its lifetime cap')
      await deps.sponsiones.setStatus(s.id, status)
      res.status(200).json({ sponsorship: serialize({ ...s, status }) })
    })
  }

  return router
}

/** bigint → string on the wire. */
function serialize(s: import('../../types/sponsio.js').Sponsio): Record<string, unknown> {
  return {
    id: s.id,
    sponsor: s.sponsor,
    beneficiarius: s.beneficiarius,
    subsidia: {
      grant: s.subsidia.grant.toString(),
      cadence: s.subsidia.cadence,
      ...(s.subsidia.balanceCap !== undefined ? { balanceCap: s.subsidia.balanceCap.toString() } : {}),
    },
    ...(s.capTotal !== undefined ? { capTotal: s.capTotal.toString() } : {}),
    drippedTotal: s.drippedTotal.toString(),
    ...(s.lastDripCycle ? { lastDripCycle: s.lastDripCycle } : {}),
    status: s.status,
    natum: s.natum,
  }
}
