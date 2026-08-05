// =============================================================================
// agentCard — ERC-8004 agent cards (the discoverable capability surface, §7/§8).
// =============================================================================
//
// ERC-8004 "Trustless Agents": an agent registers an on-chain agentId whose URI
// resolves to an AGENT CARD (the `#registration-v1` JSON). Another agent fetches
// the card to learn what the agent does, how to reach it, and how to PAY — the
// "open for business" sign that makes agent-to-agent transactions work.
//
// We serve two levels:
//   • the PLATFORM card (NOEMA) — the aggregate profile at /.well-known/agent-card.json;
//   • a PER-AGENT card — each camel agent's card, whose whole point is to advertise
//     that agent's x402-callable Modus: the endpoint, the price, the input schema, and
//     the on-chain registration. This is the "camel agent link" a caller resolves →
//     pays via x402 → we run the Modus and return the result.
//
// Pure builders (no I/O): the router resolves the pieces and calls these.

import type { Legatus } from '../../types/legatus.js'
import type { Modus } from '../../types/modus.js'
import type { X402Accept, X402Quote } from '../../types/x402.js'
import { aditusToJsonSchema } from './aditusToJsonSchema.js'

const ERC8004_REGISTRATION_V1 = 'https://eips.ethereum.org/EIPS/eip-8004#registration-v1'

export interface PlatformCardConfig {
  name: string
  description: string
  publicBase: string
  image?: string
  /** On-chain registration (set once NOEMA is registered), e.g. from env. */
  registration?: { agentId: number; agentRegistry: string }
  categories?: string[]
}

/** The platform-level NOEMA card — the aggregate profile agents discover first. */
export function buildPlatformCard(cfg: PlatformCardConfig): Record<string, unknown> {
  const base = cfg.publicBase.replace(/\/$/, '')
  return {
    type: ERC8004_REGISTRATION_V1,
    name: cfg.name,
    description: cfg.description,
    ...(cfg.image ? { image: cfg.image } : {}),
    services: [
      { name: 'web', endpoint: base, version: '1.0.0' },
      { name: 'MCP', endpoint: `${base}/api/v1/mcp`, version: '2025-06-18' },
    ],
    x402Support: true,
    active: true,
    registrations: cfg.registration ? [cfg.registration] : [],
    supportedTrust: ['reputation'],
    capabilities: {
      categories: cfg.categories ?? ['text-to-image', 'image-to-image', 'text-to-video'],
      paymentMethods: ['x402', 'credits'],
    },
  }
}

export interface AgentCardInput {
  legatus: Pick<Legatus, 'agentId' | 'tokenId' | 'adapter' | 'chainId' | 'ownerAddress'>
  modus: Pick<Modus, 'nomen' | 'aditus'>
  /** The x402 quote + accept for a baseline (empty-input) run — the advertised price. */
  quote: X402Quote
  accept: X402Accept
  publicBase: string
  /** The agent's display image (NFT art), if resolvable. */
  image?: string
  description?: string
}

/**
 * A per-agent ERC-8004 card. The heart is the `x402` service + the `capabilities.x402`
 * block: the exact endpoint, the input JSON Schema (from the Modus `aditus`), and the
 * price. A discovering agent GETs the endpoint → 402 → pays → we run the Modus. The
 * on-chain `registrations` entry ties the card back to the NFT (tokenId @ the adapter
 * registry) so an agent can verify identity before transacting.
 */
export function buildAgentCard(input: AgentCardInput): Record<string, unknown> {
  const base = input.publicBase.replace(/\/$/, '')
  const { legatus, modus } = input
  const endpoint = `${base}/api/v1/x402/agents/${legatus.agentId}/spell/${encodeURIComponent(modus.nomen)}`

  const registrations: Array<{ agentId: number; agentRegistry: string }> = []
  if (legatus.tokenId && legatus.adapter && Number.isFinite(Number(legatus.tokenId))) {
    registrations.push({
      agentId: Number(legatus.tokenId),
      agentRegistry: `eip155:${legatus.chainId ?? 1}:${legatus.adapter}`,
    })
  }

  return {
    type: ERC8004_REGISTRATION_V1,
    name: `Agent ${legatus.agentId}`,
    description: input.description ?? `On-chain agent "${modus.nomen}" — pay-per-call via x402.`,
    ...(input.image ? { image: input.image } : {}),
    services: [
      { name: 'x402', endpoint, version: '2' },
    ],
    x402Support: true,
    active: true,
    registrations,
    supportedTrust: ['reputation'],
    capabilities: {
      paymentMethods: ['x402'],
      x402: {
        endpoint,
        input: aditusToJsonSchema(modus.aditus),
        price: {
          amount: input.accept.amount,
          currency: input.quote.currency,
          network: input.accept.network,
          asset: input.accept.asset,
          payTo: input.accept.payTo,
        },
      },
    },
  }
}
