// =============================================================================
// agentCardRouter — serves the ERC-8004 platform agent card (ADR-0011 §5).
// =============================================================================
//
//   GET /.well-known/agent-card.json        — the platform (NOEMA) card
//
// §5 assigns Noema the role of x402 *capability execution target*: this route is
// how another agent discovers that we exist and how to pay us. §5 also states that
// per-agent discovery cards are CLIENT-hosted (the client serves its own
// `…/agents/{tokenId}/card`); Noema does not federate per-agent `.well-known` cards
// for this client, so no per-agent route lives here.

import express, { type Router, type Request, type Response } from 'express'
import type { LegatusStore } from '../../types/legatus.js'
import type { Modorum } from '../../types/modus.js'
import type { AuctorKey } from '../../flow/types.js'
import type { Appearance } from '../../types/consuetudo.js'
import { buildPlatformCard, type PlatformCardConfig } from './agentCard.js'
import type { X402Config } from '../../crystal/x402Pricing.js'

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

  // The platform card — cacheable, no per-request state.
  router.get('/.well-known/agent-card.json', (_req: Request, res: Response): void => {
    res.setHeader('Cache-Control', 'public, max-age=300')
    res.json(buildPlatformCard(deps.platform))
  })

  return router
}
