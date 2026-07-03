// =============================================================================
// DELEGATIO — a delegated, capped, revocable right to spend an agent's balance.
// =============================================================================
//
// "Delegatio" (delegationis, f.) = a delegation, an entrusting-away (Latin, from
// delegare: to assign/entrust). The widget's PRIMARY entrance. A sponsor funds an
// agent's balance (Sponsio, ADR-0011 §2); the agent OWNER then issues Delegationes —
// opaque invite tokens — to community members. Redeeming a token grants a short-lived
// session that runs the agent's (public) modi, spending the AGENT's sponsor-fed
// balance up to the delegation's cap. This is how "the balance is used by whoever the
// agent owner provides a code to."
//
// Mirrors the legacy CAMEL `DelegationService` (create / list / revoke / redeem):
// per-token `spendCapPoints` budget + optional expiry, owner list/revoke, redeem → a
// session. The token is the shareable invite code (`/join/:agentId/:token`).

export interface Delegatio {
  id: string
  /** The agent whose balance this delegation may spend (ERC-8004 agentId, e.g. camel42). */
  agentId: string
  /** The opaque invite token — the shareable code. UNIQUE. */
  token: string
  /** Owner's label for the link (e.g. "discord mods"). */
  label?: string
  /** Max impetus points this delegation may spend IN TOTAL (undefined = uncapped, bounded
   *  only by the agent's live balance). Points = impetus, the same unit runs are quoted in. */
  spendCapPoints?: bigint
  /** Running total spent under this delegation — `recordSpend` increments it; a run is
   *  refused once `spentPoints >= spendCapPoints`. */
  spentPoints: bigint
  /** Optional hard expiry — redeem + runs refuse past it. */
  expiresAt?: Date
  status: 'active' | 'revoked'
  /** "natum" = born — when the owner created the link. */
  natum: Date
}

/** The fields an owner supplies to mint a Delegatio; id/token/spentPoints/status/natum struck by the store. */
export type DelegatioDraft = {
  agentId: string
  label?: string
  spendCapPoints?: bigint
  expiresAt?: Date
}

/**
 * Delegationum ("of the delegations" — genitive plural). The delegation-token store.
 */
export interface Delegationum {
  /** Mint a new delegation with a fresh unique token. */
  create(draft: DelegatioDraft): Promise<Delegatio>
  find(id: string): Promise<Delegatio | null>
  /** Redeem lookup — the token is the invite code. */
  findByToken(token: string): Promise<Delegatio | null>
  /** The owner dashboard — every delegation for one agent, newest first. */
  listByAgent(agentId: string): Promise<Delegatio[]>
  setStatus(id: string, status: Delegatio['status']): Promise<void>
  /**
   * Atomically add `points` to `spentPoints` ONLY while the row is active, unexpired, and
   * (if capped) would not exceed `spendCapPoints`. Returns the updated row on success, or
   * null if the spend would breach the cap / the link is dead — the caller must treat null
   * as "refused" (this is the budget guard; the CAS makes it race-safe under concurrent runs).
   */
  recordSpend(id: string, points: bigint, now: Date): Promise<Delegatio | null>
}
