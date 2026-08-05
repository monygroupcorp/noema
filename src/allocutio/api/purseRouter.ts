// =============================================================================
// purseRouter — mint / dashboard / reclaim / revoke owned Bursa purses (§7).
// =============================================================================
//
//   POST /v1/purses                 — mint a shareable purse (funds from your balance,
//                                      or an agent's you own via `fundFromAgentId`)
//   GET  /v1/purses                 — your purses + leftover credits (the dashboard)
//   POST /v1/purses/:token/reclaim  — pull leftover credits back to your balance
//   POST /v1/purses/:token/revoke   — drain + revoke a purse
//
// This IS the delegation system, reduced to the crystal core: an owned Bursa purse +
// the existing bearer-token run path. The purse's `token` is the invite code; runs spend
// it through `/v1/runs` (`x-bursa-token`) — no new credential, no new run path. Purses are
// owner-linked (identified callers only); the anon Bursa path is untouched.

import express, { type Router, type Request, type Response } from 'express'
import type { Signorum } from '../../types/significandi.js'
import type { AnimaStore } from '../../types/anima.js'
import type { Bursarum, Bursa } from '../../types/bursa.js'
import type { AuctorKey } from '../../flow/types.js'
import type { Credentials } from './IdentityResolver.js'
import { credentialsFromHeaders } from './IdentityResolver.js'
import { mintOwnedPurse, reclaimOwnedPurse } from '../../crystal/ownedPurse.js'

export interface PurseRouterDeps {
  identity: { resolve(creds: Credentials): Promise<AuctorKey> }
  signorum: Pick<Signorum, 'reserve' | 'settle' | 'release' | 'issue'>
  bursarium: Pick<Bursarum, 'create' | 'findByToken' | 'debit' | 'setStatus' | 'listByOwner'>
  /** For an agent-funded purse: the funding anima if `callerAnimaId` owns `agentId`, else null. */
  fundFromAgent?: (agentId: string, callerAnimaId: string) => Promise<{ animaId: string } | null>
  /** Identity store — reads the caller's `disputeFrozen` flag to block purse MINT (a value-outflow /
   *  bearer-value-extraction path) while a chargeback is pending (noema-082, Q3 freeze boundary).
   *  Absent → the freeze check is skipped (dev/in-memory). RECLAIM (value inflow) is never blocked. */
  animae?: Pick<AnimaStore, 'find'>
  publicBase?: string
}

function fail(res: Response, status: number, code: string, message: string): void {
  res.status(status).json({ error: { code, message } })
}

function serialize(b: Bursa): Record<string, unknown> {
  return {
    token: b.id, credits: b.credits.toString(), createdAt: b.createdAt,
    ...(b.label !== undefined ? { label: b.label } : {}),
    status: b.status ?? 'active',
  }
}

export function createPurseRouter(deps: PurseRouterDeps): Router {
  const base = (deps.publicBase ?? 'https://noema.art').replace(/\/$/, '')
  const router = express.Router()

  /** Purses are owner-linked — the caller MUST be an identified account (not anon). */
  async function requireAnima(req: Request, res: Response): Promise<string | null> {
    let auctor: AuctorKey
    try {
      auctor = await deps.identity.resolve(credentialsFromHeaders(req.headers as Record<string, string | undefined>, req.body))
    } catch {
      fail(res, 401, 'auth.invalid', 'Sign in to manage purses'); return null
    }
    if (!('animaId' in auctor)) { fail(res, 403, 'auth.forbidden', 'Purses require an identified account'); return null }
    return auctor.animaId
  }

  // POST /v1/purses — mint.
  router.post('/', async (req: Request, res: Response): Promise<void> => {
    const animaId = await requireAnima(req, res)
    if (!animaId) return
    // Dispute freeze (noema-082, Q3): minting an owned purse extracts bearer value from the caller's
    // balance — the exact outflow a disputing fraudster would use — so it is blocked while frozen.
    // (Purse RECLAIM, value returning IN, is deliberately NOT gated.)
    if (deps.animae) {
      const anima = await deps.animae.find(animaId)
      if (anima?.disputeFrozen) {
        fail(res, 403, 'auth.forbidden', 'This account is frozen pending review of a payment dispute. Minting purses is paused until the dispute is resolved.'); return
      }
    }
    const rawCredits = req.body?.credits
    const credits = typeof rawCredits === 'number' && Number.isInteger(rawCredits) && rawCredits > 0 ? BigInt(rawCredits)
      : typeof rawCredits === 'string' && /^[1-9][0-9]*$/.test(rawCredits) ? BigInt(rawCredits) : null
    if (credits === null) { fail(res, 400, 'input.malformed', 'credits must be a positive integer (impetus points)'); return }
    const label = typeof req.body?.label === 'string' ? req.body.label.slice(0, 120) : undefined

    // Funding source: an agent you own (fund from its balance) or yourself.
    let fundFrom: { animaId: string } | undefined
    let agentId: string | undefined
    if (typeof req.body?.fundFromAgentId === 'string' && req.body.fundFromAgentId) {
      const aid: string = req.body.fundFromAgentId
      agentId = aid
      const resolved = deps.fundFromAgent ? await deps.fundFromAgent(aid, animaId) : null
      if (!resolved) { fail(res, 403, 'NOT_OWNER', 'You do not own that agent'); return }
      fundFrom = resolved
    }

    const result = await mintOwnedPurse(deps, {
      owner: { animaId }, credits,
      ...(label !== undefined ? { label } : {}),
      ...(fundFrom ? { fundFrom } : {}),
    })
    if (!result.ok) { res.status(402).json({ error: { code: 'INSUFFICIENT_BALANCE', message: 'Not enough credits to fund this purse' }, available: result.available.toString() }); return }
    const joinUrl = agentId ? `${base}/join/${encodeURIComponent(agentId)}/${result.bursa.id}` : undefined
    res.status(200).json({ ...serialize(result.bursa), ...(joinUrl ? { joinUrl } : {}) })
  })

  // GET /v1/purses — the dashboard.
  router.get('/', async (req: Request, res: Response): Promise<void> => {
    const animaId = await requireAnima(req, res)
    if (!animaId) return
    const mine = await deps.bursarium.listByOwner(animaId)
    res.status(200).json({ purses: mine.map(serialize) })
  })

  // POST /v1/purses/:token/(reclaim|revoke).
  for (const verb of ['reclaim', 'revoke'] as const) {
    router.post(`/:token/${verb}`, async (req: Request, res: Response): Promise<void> => {
      const animaId = await requireAnima(req, res)
      if (!animaId) return
      const out = await reclaimOwnedPurse(deps, { token: String(req.params.token), owner: { animaId }, revoke: verb === 'revoke' })
      if (!out.ok) { fail(res, 404, 'NOT_FOUND', 'Purse not found or not yours'); return }
      res.status(200).json({ ok: true, refunded: out.refunded.toString() })
    })
  }

  return router
}
