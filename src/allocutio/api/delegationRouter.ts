// =============================================================================
// delegationRouter — the agent-owner's delegation links + the redeem gate (§7).
// =============================================================================
//
//   POST   /widget/:agentId/delegations       — mint an invite link      (owner)
//   GET    /widget/:agentId/delegations        — list the agent's links   (owner)
//   DELETE /widget/:agentId/delegations/:id    — revoke a link            (owner)
//   POST   /widget/:agentId/auth/redeem        — redeem a code → session  (public)
//
// The owner ops are gated by an INJECTED `authorizeOwner` seam (it plugs into whatever
// owner-auth we finalize — wallet==ownerAddress, an owner account session, etc.); the
// delegation lifecycle itself is fully real. Redeem is the public entrance gate a
// community member hits with the code the owner shared.

import express, { type Router, type Request, type Response } from 'express'
import type { LegatusStore, Legatus } from '../../types/legatus.js'
import type { DelegationService, DelegatioView } from '../../crystal/DelegationService.js'

export interface DelegationRouterDeps {
  delegations: DelegationService
  legati: Pick<LegatusStore, 'findByAgentId'>
  /** Owner-gate for create/list/revoke: is this request the agent's owner? */
  authorizeOwner: (req: Request, legatus: Legatus) => Promise<boolean>
  /** Public base for absolute join URLs (default https://noema.art). */
  publicBase?: string
}

function fail(res: Response, status: number, code: string, message: string): void {
  res.status(status).json({ error: { code, message } })
}

/** bigint → string on the wire. */
function serialize(d: DelegatioView): Record<string, unknown> {
  return {
    id: d.id, agentId: d.agentId, token: d.token,
    ...(d.label !== undefined ? { label: d.label } : {}),
    ...(d.spendCapPoints !== undefined ? { spendCapPoints: d.spendCapPoints.toString() } : {}),
    spentPoints: d.spentPoints.toString(),
    ...(d.remainingPoints !== undefined ? { remainingPoints: d.remainingPoints.toString() } : {}),
    ...(d.expiresAt ? { expiresAt: d.expiresAt } : {}),
    isExpired: d.isExpired, status: d.status, natum: d.natum,
  }
}

function toPositiveBigOrUndef(raw: unknown): bigint | null | undefined {
  if (raw === undefined || raw === null) return undefined
  if (typeof raw === 'number' && Number.isInteger(raw) && raw > 0) return BigInt(raw)
  if (typeof raw === 'string' && /^[0-9]+$/.test(raw) && raw !== '0') return BigInt(raw)
  return null   // present but malformed
}

export function createDelegationRouter(deps: DelegationRouterDeps): Router {
  const base = (deps.publicBase ?? 'https://noema.art').replace(/\/$/, '')
  const router = express.Router({ mergeParams: true })

  /** Resolve the agent + enforce the owner gate, or write the error. */
  async function requireOwner(req: Request, res: Response): Promise<Legatus | null> {
    const legatus = await deps.legati.findByAgentId(String(req.params.agentId))
    if (!legatus || legatus.status === 'revoked') { fail(res, 404, 'AGENT_NOT_FOUND', 'Agent not found'); return null }
    if (!(await deps.authorizeOwner(req, legatus))) { fail(res, 403, 'NOT_OWNER', 'Only the agent owner may manage delegations'); return null }
    return legatus
  }

  // POST /:agentId/delegations — mint a delegation link.
  router.post('/:agentId/delegations', async (req: Request, res: Response): Promise<void> => {
    const legatus = await requireOwner(req, res)
    if (!legatus) return
    const spendCapPoints = toPositiveBigOrUndef(req.body?.spendCapPoints)
    if (spendCapPoints === null) { fail(res, 400, 'input.malformed', 'spendCapPoints must be a positive integer (impetus points)'); return }
    const label = typeof req.body?.label === 'string' ? req.body.label.slice(0, 120) : undefined
    const expiresInHours = typeof req.body?.expiresInHours === 'number' && req.body.expiresInHours > 0 ? req.body.expiresInHours : undefined
    const { delegation, token, joinPath } = await deps.delegations.create(legatus.agentId, {
      ...(label !== undefined ? { label } : {}),
      ...(spendCapPoints !== undefined ? { spendCapPoints } : {}),
      ...(expiresInHours !== undefined ? { expiresInHours } : {}),
    })
    res.status(200).json({
      delegation: serialize({ ...delegation, isExpired: false, ...(delegation.spendCapPoints !== undefined ? { remainingPoints: delegation.spendCapPoints } : {}) }),
      token, joinUrl: `${base}${joinPath}`,
    })
  })

  // GET /:agentId/delegations — list.
  router.get('/:agentId/delegations', async (req: Request, res: Response): Promise<void> => {
    const legatus = await requireOwner(req, res)
    if (!legatus) return
    const list = await deps.delegations.list(legatus.agentId)
    res.status(200).json({ delegations: list.map(serialize) })
  })

  // DELETE /:agentId/delegations/:id — revoke.
  router.delete('/:agentId/delegations/:id', async (req: Request, res: Response): Promise<void> => {
    const legatus = await requireOwner(req, res)
    if (!legatus) return
    const ok = await deps.delegations.revoke(legatus.agentId, String(req.params.id))
    if (!ok) { fail(res, 404, 'NOT_FOUND', 'Delegation not found'); return }
    res.status(200).json({ ok: true })
  })

  // POST /:agentId/auth/redeem — the public entrance gate: code → delegation session.
  router.post('/:agentId/auth/redeem', async (req: Request, res: Response): Promise<void> => {
    const token = typeof req.body?.token === 'string' ? req.body.token.trim() : ''
    if (!token) { fail(res, 400, 'input.malformed', 'token (invite code) is required'); return }
    const result = await deps.delegations.redeem(String(req.params.agentId), token)
    if (!result.ok) {
      const status = result.code === 'invalid_token' || result.code === 'agent_mismatch' ? 404 : 403
      fail(res, status, result.code.toUpperCase(), `Delegation ${result.code.replace('_', ' ')}`)
      return
    }
    res.status(200).json({
      session: result.session, expiresIn: result.expiresIn, agentId: result.agentId,
      ...(result.remainingPoints !== undefined ? { remainingPoints: result.remainingPoints.toString() } : {}),
    })
  })

  return router
}
