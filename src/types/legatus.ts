// =============================================================================
// LEGATUS — the agent sidecar: an on-chain-payable delegated envoy (ADR-0011 §5).
// =============================================================================
//
// "Legatus" = envoy/legate in Latin — one who acts with delegated authority and
// earns for the principal who sent him. This is the ONE genuinely agent-specific
// record in the CAMEL→crystal migration; everything else (treasury=Anima,
// federated auth=Issuer, sponsorship=Sponsio) is a universal platform primitive.
//
// A Legatus hangs off an otherwise-ordinary `Anima` (the agent's balance-bearing
// identity, minted by the federated JWKS acceptor on first auth). It records the
// on-chain binding (ERC-8004 agentId/tokenId/owner/adapter), the funding treasury,
// the derived starter workspace, the monetization/payout config, and a revocable,
// scoped session. Distinct from a federated *human* login because the identity is
// an on-chain, transferable, payable asset and the actor is autonomous.
//
// `agentId` is UNIQUE — it is the idempotency key for provisioning. `id` is the
// "agentAccountId" the client stores and the manifest/revoke paths are keyed by.

export interface Legatus {
  /** The "agentAccountId" — the manifest/revoke path key the client persists. */
  id: string
  /** ERC-8004 agentId, e.g. `camel42`. UNIQUE — the provisioning idempotency key. */
  agentId: string
  /** The NFT token id (string form). */
  tokenId?: string
  /** The current on-chain owner at assertion time, lowercased `0x…40hex`. */
  ownerAddress: string
  /** EVM chain id parsed from the JWT `sub` (`agent:<chainId>:<adapter>:<agentId>`). */
  chainId?: number
  /** The adapter contract address (lowercased) parsed from `sub`. Payout resolves via it. */
  adapter?: string
  /** FK → the agent's `Anima` (the federated persona's active anima). */
  animaId: string
  /** FK → the funding treasury — an ordinary `Anima` whose id is the treasuryId. */
  treasuryId: string
  /** FK → the `Issuer` that asserted this agent (== JWT `iss`). */
  issuerId: string
  /** Granted capability scope, e.g. `['generate']`. */
  scope: string[]
  /** The derived private starter-workspace `Modus` (a compositus spell) id, once cloned. */
  workspaceModusId?: string
  /**
   * How owner rev-share settles. `self-fund` = the agent spends its own balance
   * (the shipped CAMEL default); `withdraw`/`split` route earnings to an address.
   */
  payoutPolicy?: { mode: 'self-fund' | 'withdraw' | 'split'; withdrawAddress?: string }
  /** Opaque bearer that gates `POST /api/v1/sessions/:id/revoke`. */
  revokeToken: string
  /**
   * Per-partner CSP `frame-ancestors` allowlist for this agent's `/widget` embed
   * (ADR-0011 §7). Unset (the common case) falls back to the platform-wide
   * `WIDGET_FRAME_ANCESTORS` list, and then to `'self'` if that is unset too —
   * see `widgetRouter.ts`. Not writable via any endpoint yet; set directly on the
   * record until a dedicated write path exists.
   */
  frameAncestors?: string[]
  /** When the current delegated session expires (from the JWT `exp`). */
  sessionExpiresAt?: Date
  /**
   * `active` = provisioned + funded; `suspended` = a prior attempt failed after the
   * record existed (resumable — retry funds it); `revoked` = terminal (owner killed it).
   */
  status: 'active' | 'suspended' | 'revoked'
  /** "natum" = born — when the sidecar was created. */
  natum: Date
}

/** "Legati" — nominative plural. The agent-sidecar registry. */
export type Legati = Legatus[]

export interface LegatusStore {
  /** Idempotency lookup — the unique `agentId`. */
  findByAgentId(agentId: string): Promise<Legatus | null>
  /** By the `agentAccountId` (manifest/revoke path key). */
  findById(id: string): Promise<Legatus | null>
  /** Every agent of one NFT collection — the ERC-8004 `adapter` contract (lowercased)
   *  parsed from the JWT `sub`. Backs the collection gallery (ADR-0011 §7). */
  listByCollection(adapter: string): Promise<Legati>
  /**
   * Create a sidecar. `agentId` is uniquely indexed — a concurrent duplicate
   * throws a Mongo E11000 (code 11000) the saga treats as an idempotent race win.
   */
  create(input: Omit<Legatus, 'id' | 'natum' | 'status'> & { status?: Legatus['status'] }): Promise<Legatus>
  setStatus(id: string, status: Legatus['status']): Promise<void>
  setWorkspace(id: string, workspaceModusId: string): Promise<void>
}
