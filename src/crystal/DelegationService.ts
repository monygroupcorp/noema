// =============================================================================
// DelegationService — issue / list / revoke / redeem agent-balance delegations.
// =============================================================================
//
// The owner mints capped, optionally-expiring invite tokens; a community member
// redeems a token for a short-lived DELEGATION SESSION (a signed JWT carrying the
// agentId + delegationId, NOT an animaId — it grants the right to spend the AGENT's
// balance, not to act as a person). The run path verifies the session and charges the
// delegation's cap via `Delegationum.recordSpend`. Mirrors the legacy CAMEL
// DelegationService; the session is `typ:'delegation'` to keep it distinct from the
// account session (`sessionToken.ts`, `typ:'session'`).

import jwt from 'jsonwebtoken'
import type { Delegatio, Delegationum } from '../types/delegatio.js'

export const DELEGATION_TYP = 'delegation' as const
export const DEFAULT_DELEGATION_TTL_SECONDS = 24 * 60 * 60

export interface DelegationSession {
  agentId: string
  delegationId: string
}

export type RedeemResult =
  | { ok: true; session: string; expiresIn: number; agentId: string; delegationId: string; remainingPoints?: bigint }
  | { ok: false; code: 'invalid_token' | 'agent_mismatch' | 'revoked' | 'expired' | 'exhausted' }

export interface DelegatioView extends Delegatio {
  isExpired: boolean
  /** cap − spent, when capped. */
  remainingPoints?: bigint
}

export interface DelegationServiceDeps {
  delegationes: Delegationum
  /** HS256 secret for the delegation session JWT (reuse JWT_SECRET). */
  jwtSecret: string
  ttlSeconds?: number
}

export class DelegationService {
  constructor(private deps: DelegationServiceDeps) {}

  /** Mint a delegation link (owner-gated upstream). Returns the token + its join path. */
  async create(
    agentId: string,
    opts: { label?: string; spendCapPoints?: bigint; expiresInHours?: number } = {},
  ): Promise<{ delegation: Delegatio; token: string; joinPath: string }> {
    const expiresAt = opts.expiresInHours && opts.expiresInHours > 0
      ? new Date(Date.now() + opts.expiresInHours * 60 * 60 * 1000)
      : undefined
    const delegation = await this.deps.delegationes.create({
      agentId,
      ...(opts.label !== undefined ? { label: opts.label } : {}),
      ...(opts.spendCapPoints !== undefined ? { spendCapPoints: opts.spendCapPoints } : {}),
      ...(expiresAt ? { expiresAt } : {}),
    })
    return { delegation, token: delegation.token, joinPath: `/join/${encodeURIComponent(agentId)}/${delegation.token}` }
  }

  /** The owner dashboard — the agent's delegations with derived expiry + remaining budget. */
  async list(agentId: string, now = new Date()): Promise<DelegatioView[]> {
    const ds = await this.deps.delegationes.listByAgent(agentId)
    return ds.map((d) => ({
      ...d,
      isExpired: d.expiresAt ? d.expiresAt <= now : false,
      ...(d.spendCapPoints !== undefined ? { remainingPoints: d.spendCapPoints - d.spentPoints } : {}),
    }))
  }

  /** Revoke a delegation (owner-gated). Returns false if it isn't this agent's. */
  async revoke(agentId: string, delegationId: string): Promise<boolean> {
    const d = await this.deps.delegationes.find(delegationId)
    if (!d || d.agentId !== agentId) return false
    await this.deps.delegationes.setStatus(delegationId, 'revoked')
    return true
  }

  /** Exchange an invite token for a delegation session (public — this is the entrance gate). */
  async redeem(agentId: string, token: string, now = new Date()): Promise<RedeemResult> {
    const d = await this.deps.delegationes.findByToken(token)
    if (!d) return { ok: false, code: 'invalid_token' }
    if (d.agentId !== agentId) return { ok: false, code: 'agent_mismatch' }
    if (d.status !== 'active') return { ok: false, code: 'revoked' }
    if (d.expiresAt && d.expiresAt <= now) return { ok: false, code: 'expired' }
    if (d.spendCapPoints !== undefined && d.spentPoints >= d.spendCapPoints) return { ok: false, code: 'exhausted' }
    const ttl = this.deps.ttlSeconds ?? DEFAULT_DELEGATION_TTL_SECONDS
    const session = jwt.sign({ agentId, did: d.id, typ: DELEGATION_TYP }, this.deps.jwtSecret, { expiresIn: ttl })
    return {
      ok: true, session, expiresIn: ttl, agentId, delegationId: d.id,
      ...(d.spendCapPoints !== undefined ? { remainingPoints: d.spendCapPoints - d.spentPoints } : {}),
    }
  }

  /** Verify a delegation session JWT → { agentId, delegationId }, or null. */
  verifySession(token: string): DelegationSession | null {
    try {
      const p = jwt.verify(token, this.deps.jwtSecret)
      if (typeof p === 'string' || p.typ !== DELEGATION_TYP) return null
      return typeof p.agentId === 'string' && typeof p.did === 'string'
        ? { agentId: p.agentId, delegationId: p.did }
        : null
    } catch {
      return null
    }
  }
}
