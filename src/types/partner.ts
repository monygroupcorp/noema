// =============================================================================
// PARTNER — an approved B2B partner account
// =============================================================================
//
// A "partner" is deliberately simple: an ordinary `Anima` that a platform admin
// has approved via the partner-request review flow (`partnerAdminRouter.ts`).
// There is NO on-chain agent, NFT, or treasury concept here — that is a
// separate, unrelated system (`Legatus`/treasury/Bursa) elsewhere in the
// codebase; do not conflate the two.
//
// {animaId}-keyed small dedicated store — one record per partner Anima,
// mirroring `Sponsio`'s convention of never widening `Anima` itself for a
// feature-specific concept. Created exactly once, by the approval route, only
// for a request that carries an `animaId` (see `partnerRequest.ts`'s header).
// =============================================================================

export interface Partner {
  /** FK -> Anima. One Partner record per partner anima. */
  animaId: string
  /** "active" = has a working API key; "revoked" = access pulled (manual op, no
   *  route in this item mutates this yet — set at creation only). */
  status: 'active' | 'revoked'
  org?: string
  contactEmail?: string
  /** FK -> the PartnerRequest this partner was provisioned from. */
  sourceRequestId: string
  /** "natum" = born — when this partner record was created. */
  natum: Date
  /**
   * The billing account invoices are issued against. Absent until the partner sets one, and
   * its absence is a REFUSAL, not a default: no API key is minted for a partner with no
   * billing account, and a partner key stops authenticating if the account is removed
   * (`apiAcceptors.ts`). A post-paid customer with nowhere to send the invoice is a customer
   * generating on credit nobody agreed to extend.
   *
   * Carried on `Partner` rather than in a store of its own: it is one more fact about the
   * same B2B relationship this record already is, with the same lifetime, and there is no
   * read of it that does not already hold the Partner.
   */
  billing?: PartnerBilling
}

/** Where an invoice goes and on what terms it is due. */
export interface PartnerBilling {
  /** Where invoices are sent. Distinct from `contactEmail` — accounts payable is rarely the
   *  person who filed the partner request. */
  billingEmail: string
  /** The legal entity being billed, as it should appear on the invoice. */
  billedTo: string
  /** Days from issue until payment is due. Typed by the partner's own agreement with us, so
   *  it lives on the record rather than as a platform constant. */
  netDays: number
  /** When this billing account was last set. */
  setAt: Date
}

export interface PartnerStore {
  create(input: Omit<Partner, 'natum' | 'status'> & { status?: Partner['status'] }): Promise<Partner>
  find(animaId: string): Promise<Partner | null>
  list(filter?: { status?: Partner['status'] }): Promise<Partner[]>
  setStatus(animaId: string, status: Partner['status']): Promise<void>
  /** Set (or replace) the billing account invoices are issued against. Separate from
   *  `create` because it is the partner's own, self-serve act — the admin who approved the
   *  request does not know where the partner's invoices should go. */
  setBilling(animaId: string, billing: PartnerBilling): Promise<void>
}
