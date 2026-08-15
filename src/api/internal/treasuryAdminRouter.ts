// =============================================================================
// treasuryAdminRouter — manual treasury funding (ADR-0011 §8; faucet is OFF in prod).
// =============================================================================
//
// The CAMEL faucet is off in prod (`subsidyMode:'off'`, all grants manual), so
// parity needs an admin path to fund a treasury and top up an agent. On crystal:
//   • fund  = `issue` `minted` signa onto the treasury `Anima`.
//   • topup = ledger `transfer` treasury `Anima` → agent `Anima`.
// No `debitBalance`, no stored integer — the treasury balance is Σ its valid signa.
//
//   POST /internal/v1/admin/treasury/:treasuryId/fund   { points }
//   POST /internal/v1/admin/treasury/:treasuryId/topup  { agentId, points }
//
// `topup` credits a `Legatus` (an agent), so a plain account — an `Anima` with no agent
// binding — has no route to credit at all. `grant` is that verb:
//   • grant = `issue` `minted` signa directly onto a named `Anima`.
//
//   POST /internal/v1/admin/animae/:animaId/grant       { points, memo? }
//
// Gated by `x-internal-secret` (same discipline as the other /internal routers).

import express, { type Router, type Request, type Response } from 'express'
import type { Signorum } from '../../types/significandi.js'
import type { LegatusStore } from '../../types/legatus.js'
import type { AnimaStore } from '../../types/anima.js'
import type { TreasuryConfig } from '../../crystal/AgentProvisioner.js'

export interface TreasuryAdminDeps {
  signorum: Pick<Signorum, 'issue' | 'transfer' | 'balance'>
  legati: Pick<LegatusStore, 'findByAgentId'>
  animae: Pick<AnimaStore, 'find'>
  treasury: (treasuryId: string) => TreasuryConfig | null
  /** `x-internal-secret` gate. Absent → every request is refused (401). */
  secret?: string
}

/**
 * Per-call ceiling on `grant`, in points. Not a security boundary — the caller already
 * holds the internal secret — but a bound on how large a single mistyped amount can be.
 */
export const MAX_GRANT_POINTS = 200_000n

function parsePoints(raw: unknown): bigint | null {
  if (typeof raw === 'number' && Number.isInteger(raw) && raw > 0) return BigInt(raw)
  if (typeof raw === 'string' && /^[0-9]+$/.test(raw) && raw !== '0') return BigInt(raw)
  return null
}

export function createTreasuryAdminRouter(deps: TreasuryAdminDeps): Router {
  const router = express.Router()

  // The gate is unconditional: an unconfigured secret refuses every request rather than
  // admitting it. Configuration is asserted at boot (see `src/index.ts`).
  router.use((req: Request, res: Response, next): void => {
    const provided = req.headers['x-internal-secret'] ?? req.query.token
    if (!deps.secret || provided !== deps.secret) {
      res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'invalid internal secret' } })
      return
    }
    next()
  })

  // POST /admin/treasury/:treasuryId/fund { points } — mint into the treasury Anima.
  router.post('/admin/treasury/:treasuryId/fund', async (req: Request, res: Response): Promise<void> => {
    const treasury = deps.treasury(String(req.params.treasuryId))
    if (!treasury) { res.status(404).json({ error: { code: 'TREASURY_NOT_FOUND', message: 'Treasury not found' } }); return }
    const points = parsePoints(req.body?.points)
    if (points === null) { res.status(400).json({ error: { code: 'BAD_REQUEST', message: 'points must be a positive integer' } }); return }

    await deps.signorum.issue({ animaId: treasury.animaId, forma: 'minted', valor: points, auctor: 'admin:treasury-fund' })
    const balance = await deps.signorum.balance({ animaId: treasury.animaId })
    res.status(200).json({ treasuryId: treasury.treasuryId, funded: points.toString(), balance: balance.toString() })
  })

  // POST /admin/treasury/:treasuryId/topup { agentId, points } — transfer to an agent.
  router.post('/admin/treasury/:treasuryId/topup', async (req: Request, res: Response): Promise<void> => {
    const treasury = deps.treasury(String(req.params.treasuryId))
    if (!treasury) { res.status(404).json({ error: { code: 'TREASURY_NOT_FOUND', message: 'Treasury not found' } }); return }
    const agentId = typeof req.body?.agentId === 'string' ? req.body.agentId : null
    const points = parsePoints(req.body?.points)
    if (!agentId || points === null) { res.status(400).json({ error: { code: 'BAD_REQUEST', message: 'agentId and a positive points are required' } }); return }

    const legatus = await deps.legati.findByAgentId(agentId)
    if (!legatus) { res.status(404).json({ error: { code: 'AGENT_NOT_FOUND', message: 'Agent not found' } }); return }

    const moved = await deps.signorum.transfer(
      { animaId: treasury.animaId },
      { animaId: legatus.animaId },
      points,
      { auctor: 'admin:treasury-topup', contextId: agentId },
    )
    if (!moved.ok) {
      res.status(402).json({ error: { code: 'INSUFFICIENT_FUNDS', message: `Treasury balance ${moved.available} cannot cover ${points}` } })
      return
    }
    const agentBalance = await deps.signorum.balance({ animaId: legatus.animaId })
    res.status(200).json({ treasuryId: treasury.treasuryId, agentId, toppedUp: points.toString(), agentBalance: agentBalance.toString() })
  })

  // POST /admin/animae/:animaId/grant { points, memo? } — mint `minted` signa onto a plain Anima.
  //
  // The anima must exist BEFORE any ledger write: `issue` accepts any animaId string, and a signum
  // written against an id that belongs to nobody is unspendable and surfaces in no balance, so a
  // mistyped id would silently succeed. The 404 is what makes the id meaningful.
  //
  // NOT IDEMPOTENT: this route carries no replay key, so a repeated call mints again. Callers that
  // need exactly-once must not retry blindly.
  router.post('/admin/animae/:animaId/grant', async (req: Request, res: Response): Promise<void> => {
    const animaId = String(req.params.animaId)
    const points = parsePoints(req.body?.points)
    if (points === null) { res.status(400).json({ error: { code: 'BAD_REQUEST', message: 'points must be a positive integer' } }); return }
    if (points > MAX_GRANT_POINTS) {
      res.status(400).json({ error: { code: 'BAD_REQUEST', message: `points must not exceed ${MAX_GRANT_POINTS}` } })
      return
    }

    const anima = await deps.animae.find(animaId)
    if (!anima) { res.status(404).json({ error: { code: 'ANIMA_NOT_FOUND', message: 'Anima not found' } }); return }

    const memo = typeof req.body?.memo === 'string' && req.body.memo.length > 0 ? req.body.memo : null
    await deps.signorum.issue({
      animaId: anima.id,
      forma: 'minted',
      valor: points,
      auctor: 'admin:anima-grant',
      ...(memo ? { contextId: memo } : {}),
    })
    const balance = await deps.signorum.balance({ animaId: anima.id })
    res.status(200).json({ animaId: anima.id, granted: points.toString(), balance: balance.toString() })
  })

  return router
}
