// =============================================================================
// PARTNER REQUEST — a public "become a B2B partner" lead
// =============================================================================
//
// The front door of the B2B partner program: anyone can ask to become a
// partner via `POST /v1/partner-requests` (public, no auth required). A
// platform admin then reviews the queue and approves/declines. Approval of a
// request that carries an `animaId` provisions a real `Partner` record + a
// working API key (see `src/types/partner.ts` + `src/crystal/apiKeys.ts`); a
// request with no `animaId` (a fully anonymous submitter) can only be marked
// `approved` — there is no email-verified signup flow in this codebase to
// safely attach credentials to, so that case is a deliberate dead end, not a
// bug (see `partnerAdminRouter.ts`).
//
// A "partner" here is deliberately simple: an ordinary `Anima` that has been
// approved. No on-chain agent, NFT, or treasury concept is involved — that is
// a separate, unrelated system (`Legatus`/treasury) elsewhere in the codebase.
//
// Own small dedicated store, keyed by `id` — following this codebase's
// convention of never widening `Anima` for a feature-specific flag (see
// `Sponsio`/`Querela`/`Bursa`: small dedicated stores, not shared fields).
// =============================================================================

export interface PartnerRequest {
  id: string
  /** Submitter's chosen display name, if given. */
  nomen?: string
  /** Submitter's organization/company name, if given. */
  org?: string
  /** Contact email — required. Used for the reviewer to follow up, and as the
   *  rate-limit key (most submitters have no resolvable identity). */
  contactEmail: string
  /** The submitter's `animaId`, ONLY when `identity.resolve()` succeeded and
   *  returned an animaId-bearing `AuctorKey` at submission time. Absent for a
   *  fully anonymous submitter (no credential presented, or resolution failed) —
   *  this is the normal case, not an error. */
  animaId?: string
  /** Free-text description of the intended use case — required. */
  useCase: string
  /** Optional free-text notes. */
  notes?: string
  /** "pending" = unreviewed; "approved"/"declined" = reviewed by a platform admin. */
  status: 'pending' | 'approved' | 'declined'
  /**
   * Opaque rate-limit key derived from `contactEmail` (normalized + hashed —
   * mirrors `ownerKeyOf`'s hashing of bearer-ish identifiers, and Querela's
   * stored `contentHash` field for its own indexed lookup). NEVER derived from
   * anything other than `contactEmail` — this is an internal indexing field,
   * not part of the public request shape callers submit.
   */
  emailKey: string
  /** "natum" = born — when this request was filed. */
  natum: Date
  /** When a platform admin decided this request (approved/declined). */
  decidedAt?: Date
  /** The admin `animaId` that decided this request. */
  decidedBy?: string
}

// ---------------------------------------------------------------------------
// PartnerRequestStore — the PartnerRequest repository interface
// ---------------------------------------------------------------------------

export interface PartnerRequestStore {
  create(input: Omit<PartnerRequest, 'id' | 'natum' | 'status' | 'decidedAt' | 'decidedBy'> & { status?: PartnerRequest['status'] }): Promise<PartnerRequest>
  find(id: string): Promise<PartnerRequest | null>
  /** ADMIN: every request across ALL submitters, optionally narrowed by status. Newest first. */
  list(filter?: { status?: PartnerRequest['status'] }): Promise<PartnerRequest[]>
  update(id: string, patch: Partial<Pick<PartnerRequest, 'status' | 'decidedAt' | 'decidedBy'>>): Promise<PartnerRequest>
  /** Rate-limit lookup: every request sharing `emailKey`, for the counted-window
   *  check in `partnerRequestRouter.ts` (mirrors `QuerelaStore.findByOwner`). */
  findByEmailKey(emailKey: string): Promise<PartnerRequest[]>
}
