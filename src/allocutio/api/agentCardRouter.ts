// =============================================================================
// agentCardRouter — serves the ERC-8004 agent cards (ADR-0011 §7/§8, Phase 2).
// =============================================================================
//
//   GET /.well-known/agent-card.json        — the platform (NOEMA) card
//   GET /api/v1/agents/:agentId/card         — a per-agent capability card
//
// The per-agent card is the discoverable "camel agent link": it advertises the
// agent's x402-callable Modus (endpoint + price + input schema + on-chain
// registration), so another agent can resolve → pay → run. Composed from existing
// primitives (Legatus + the agent's workspace Modus + the x402 quote) — no new type.

import express, { type Router, type Request, type Response } from 'express'
import type { LegatusStore } from '../../types/legatus.js'
import type { Modorum } from '../../types/modus.js'
import type { AuctorKey } from '../../flow/types.js'
import type { Appearance } from '../../types/consuetudo.js'
import { buildAgentCard, buildPlatformCard, type PlatformCardConfig } from './agentCard.js'
import { buildQuote, acceptFor, type X402Config } from '../../crystal/x402Pricing.js'

export interface AgentCardRouterDeps {
  legati: Pick<LegatusStore, 'findByAgentId'>
  modorum: Pick<Modorum, 'find'>
  /** Baseline run-cost estimate (empty inputs) → the advertised price. */
  quoteImpetus: (modusId: string) => Promise<bigint>
  x402Config: X402Config
  platform: PlatformCardConfig
  publicBase: string
  /** Optional per-agent art for the card image (the agent's own appearance). */
  appearance?: (owner: AuctorKey) => Promise<Appearance | undefined>
}

export function createAgentCardRouter(deps: AgentCardRouterDeps): Router {
  const router = express.Router()
  const base = deps.publicBase.replace(/\/$/, '')

  // The platform card — cacheable, no per-request state.
  router.get('/.well-known/agent-card.json', (_req: Request, res: Response): void => {
    res.setHeader('Cache-Control', 'public, max-age=300')
    res.json(buildPlatformCard(deps.platform))
  })

  // A per-agent capability card.
  router.get('/api/v1/agents/:agentId/card', async (req: Request, res: Response): Promise<void> => {
    const agentId = String(req.params.agentId)
    const legatus = await deps.legati.findByAgentId(agentId)
    if (!legatus || legatus.status !== 'active') {
      res.status(404).json({ error: { code: 'AGENT_NOT_FOUND', message: 'Agent not found or inactive' } })
      return
    }
    if (!legatus.workspaceModusId) {
      res.status(404).json({ error: { code: 'NO_CAPABILITY', message: 'Agent has no callable modus' } })
      return
    }
    const modus = await deps.modorum.find(legatus.workspaceModusId)
    if (!modus) {
      res.status(404).json({ error: { code: 'NO_CAPABILITY', message: 'Agent modus not found' } })
      return
    }
    const impetus = await deps.quoteImpetus(modus.id)
    const quote = buildQuote(impetus, deps.x402Config)
    const accept = acceptFor(quote, deps.x402Config)
    const appearance = deps.appearance ? await deps.appearance({ animaId: legatus.animaId }) : undefined
    const image = appearance?.avatarUrl ?? appearance?.bannerUrl

    res.setHeader('Cache-Control', 'public, max-age=60')
    res.json(buildAgentCard({
      legatus, modus, quote, accept, publicBase: base,
      ...(image ? { image } : {}),
    }))
  })

  return router
}
