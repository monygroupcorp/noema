// =============================================================================
// AgentProvisioner — the CAMEL onboarding saga on crystal primitives (ADR-0011 §5).
// =============================================================================
//
// Re-expresses `agentProvisioningApi.js` as a crystal saga. The load-bearing
// simplification (ADR): the treasury is an ordinary `Anima`, the agent is an
// `Anima` (minted by the federated JWKS acceptor) + a `Legatus` sidecar, and the
// starter grant is a first-class ledger `transfer` — no `treasuries` collection,
// no stored integer balances, no `debitBalance`.
//
// Ordering preserved from Stack B: create the workspace + Legatus FIRST, then move
// money LAST with a fresh read; compensate (suspend the Legatus) on a shortfall so
// `suspended` is resumable and `revoked` is terminal. Idempotent on the unique
// `agentId` (a concurrent duplicate → E11000 → treated as an idempotent race win).
//
// The grant is 0 in prod (the faucet is off — grants are manual admin top-ups), so
// the transfer step is usually a no-op; it stays general for a funded treasury.

import { randomUUID } from 'node:crypto'
import type { LegatusStore, Legatus } from '../types/legatus.js'
import type { Signorum } from '../types/significandi.js'
import type { Modorum, Modus } from '../types/modus.js'
import { deriveAgentWorkspace } from './deriveAgentWorkspace.js'

/** Per-treasury provisioning config. NOT a stored noun (ADR forbids a `treasuries`
 *  type) — injected config, like route config. Prod has exactly one (`camelcabal-1`). */
export interface TreasuryConfig {
  treasuryId: string
  /** The treasury's `Anima` id (the funding source). By convention === `treasuryId`. */
  animaId: string
  /** FK → the `Issuer` allowed to onboard against this treasury (== JWT `iss`). */
  issuerId: string
  /** The starter-workspace template compositus `Modus` id (legacy `starterWorkspaceSlug`). */
  templateModusId: string
  /** The compositus aditus port the NFT image bakes into. Default `input_second_image`. */
  nftImageInputKey?: string
  /** Starter grant in impetus points. Prod = 0 (faucet off; grants are manual). */
  starterGrant: bigint
  status: 'active' | 'suspended'
}

/** The verified JWT claims + resolved agent Anima the saga needs. */
export interface ProvisionInput {
  /** The agent's `Anima` id — resolved by the federated acceptor (find-or-create). */
  agentAnimaId: string
  agentId: string
  tokenId?: string
  ownerAddress: string
  chainId?: number
  adapter?: string
  issuerId: string
  scope: string[]
  sessionExpiresAt?: Date
  /** Best-effort NFT presentation from the agent card / token metadata. */
  nftImageUrl?: string
  nftName?: string
  nftDescription?: string
}

export type ProvisionOutcome =
  | { ok: true; httpStatus: 200 | 202; legatus: Legatus; grantedPoints: bigint }
  | {
      ok: false
      httpStatus: 404 | 403 | 409 | 402 | 503
      code:
        | 'TREASURY_NOT_FOUND'
        | 'TREASURY_SUSPENDED'
        | 'AGENT_REVOKED'
        | 'INSUFFICIENT_FUNDS'
        | 'TEMPLATE_NOT_FOUND'
        | 'WORKSPACE_CREATION_FAILED'
      message: string
    }

export interface AgentProvisionerDeps {
  legati: LegatusStore
  signorum: Pick<Signorum, 'transfer'>
  modorum: Pick<Modorum, 'find' | 'register'>
  /** Resolve a treasuryId → its config, or null if unknown. */
  treasury: (treasuryId: string) => TreasuryConfig | null
  /** Best-effort R2 mirror of the NFT image; falls back to the direct URL on failure. */
  mirrorImage?: (url: string, agentId: string) => Promise<string>
  /** Injectable revoke-token minter (defaults to a uuid). */
  newRevokeToken?: () => string
}

export class AgentProvisioner {
  constructor(private readonly deps: AgentProvisionerDeps) {}

  async provision(treasuryId: string, input: ProvisionInput): Promise<ProvisionOutcome> {
    const treasury = this.deps.treasury(treasuryId)
    if (!treasury) return { ok: false, httpStatus: 404, code: 'TREASURY_NOT_FOUND', message: 'Treasury not found' }
    if (treasury.status !== 'active') {
      return { ok: false, httpStatus: 403, code: 'TREASURY_SUSPENDED', message: 'Treasury is suspended' }
    }

    // ── Idempotency / resume ────────────────────────────────────────────────
    const existing = await this.deps.legati.findByAgentId(input.agentId)
    if (existing) {
      if (existing.status === 'active') {
        return { ok: true, httpStatus: 200, legatus: existing, grantedPoints: 0n }
      }
      if (existing.status === 'revoked') {
        return { ok: false, httpStatus: 409, code: 'AGENT_REVOKED', message: 'This agent account has been permanently revoked' }
      }
      // suspended → retry the financial step only (the workspace already exists).
      const granted = await this.grant(treasury, existing)
      if (!granted.ok) return granted
      await this.deps.legati.setStatus(existing.id, 'active')
      return { ok: true, httpStatus: 202, legatus: { ...existing, status: 'active' }, grantedPoints: granted.points }
    }

    // ── Fresh provision ─────────────────────────────────────────────────────
    // 1. Clone the starter workspace (NFT-baked, private to the agent), register it.
    const template = await this.deps.modorum.find(treasury.templateModusId)
    if (!template) {
      return { ok: false, httpStatus: 503, code: 'TEMPLATE_NOT_FOUND', message: 'Starter workspace template not found' }
    }
    let workspace: Modus
    try {
      const imageUrl = await this.resolveImage(input)
      workspace = deriveAgentWorkspace(template, {
        slug: `agent-ws-${input.agentId}`,
        name: input.nftName || input.agentId,
        animaId: input.agentAnimaId,
        nft: { imageInputKey: treasury.nftImageInputKey ?? 'input_second_image', imageUrl },
        placeholders: {
          '$NFT_NAME': input.nftName ?? '',
          '$NFT_TOKEN_ID': input.tokenId ?? '',
          '$NFT_IMAGE': imageUrl,
          '$NFT_DESCRIPTION': input.nftDescription ?? '',
        },
      })
      await this.deps.modorum.register(workspace)
    } catch (err) {
      return { ok: false, httpStatus: 503, code: 'WORKSPACE_CREATION_FAILED', message: `Failed to create agent workspace: ${(err as Error).message}` }
    }

    // 2. Create the Legatus sidecar (unique agentId → E11000 on a concurrent race).
    let legatus: Legatus
    try {
      legatus = await this.deps.legati.create({
        agentId: input.agentId,
        ...(input.tokenId !== undefined ? { tokenId: input.tokenId } : {}),
        ownerAddress: input.ownerAddress,
        ...(input.chainId !== undefined ? { chainId: input.chainId } : {}),
        ...(input.adapter !== undefined ? { adapter: input.adapter } : {}),
        animaId: input.agentAnimaId,
        treasuryId: treasury.treasuryId,
        issuerId: input.issuerId,
        scope: input.scope,
        workspaceModusId: workspace.id,
        payoutPolicy: { mode: 'self-fund' },
        revokeToken: (this.deps.newRevokeToken ?? defaultRevokeToken)(),
        ...(input.sessionExpiresAt ? { sessionExpiresAt: input.sessionExpiresAt } : {}),
      })
    } catch (err) {
      if ((err as { code?: number }).code === 11000) {
        // A concurrent request won the race — treat as idempotent success if it's active.
        const raced = await this.deps.legati.findByAgentId(input.agentId)
        if (raced && raced.status === 'active') return { ok: true, httpStatus: 200, legatus: raced, grantedPoints: 0n }
      }
      throw err
    }

    // 3. Move the starter grant LAST (fresh read inside transfer). Compensate on shortfall.
    const granted = await this.grant(treasury, legatus)
    if (!granted.ok) {
      await this.deps.legati.setStatus(legatus.id, 'suspended')   // resumable
      return granted
    }

    return { ok: true, httpStatus: 202, legatus, grantedPoints: granted.points }
  }

  /** Transfer the starter grant treasury→agent. `0` is a no-op success (faucet off). */
  private async grant(
    treasury: TreasuryConfig,
    legatus: Legatus,
  ): Promise<{ ok: true; points: bigint } | (ProvisionOutcome & { ok: false })> {
    if (treasury.starterGrant <= 0n) return { ok: true, points: 0n }
    const res = await this.deps.signorum.transfer(
      { animaId: treasury.animaId },
      { animaId: legatus.animaId },
      treasury.starterGrant,
      { auctor: 'agent:starter-grant', contextId: legatus.agentId },
    )
    if (!res.ok) {
      return { ok: false, httpStatus: 402, code: 'INSUFFICIENT_FUNDS', message: 'Treasury has insufficient balance for the starter grant' }
    }
    return { ok: true, points: treasury.starterGrant }
  }

  private async resolveImage(input: ProvisionInput): Promise<string> {
    if (!input.nftImageUrl) return ''
    if (!this.deps.mirrorImage) return input.nftImageUrl
    try {
      return await this.deps.mirrorImage(input.nftImageUrl, input.agentId)
    } catch {
      return input.nftImageUrl   // mirror is best-effort; the direct URL still works
    }
  }
}

function defaultRevokeToken(): string {
  return `rvk_${randomUUID().replace(/-/g, '')}`
}
