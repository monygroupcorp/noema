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
//
// NOTE (partner-embed-05-dashboard): this file is a verbatim mirror of the type
// this dashboard's sibling branch, `partner-embed-06-partner-intake`, defines
// (same path). That branch also owns `PartnerStore`'s real implementations
// (`MemoryPartner`/`MongoPartner`), the admin approval route, and the
// container/`Ring` wiring that constructs a real store — none of which exist on
// this branch yet. This dashboard only ever calls `PartnerStore.find`, injected
// exactly like `apiRouter.ts`'s other optional stores (see `partners?:
// PartnerStore` on `createApiRouter`'s deps) — production wiring of a REAL
// store into that dependency is intentionally left to whichever branch merges
// second; until then `GET /v1/me/partner` answers 503 `internal.unavailable`
// (`Errors.partnerDirectoryUnavailable`), never a silent 404.
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
}

export interface PartnerStore {
  create(input: Omit<Partner, 'natum' | 'status'> & { status?: Partner['status'] }): Promise<Partner>
  find(animaId: string): Promise<Partner | null>
  list(filter?: { status?: Partner['status'] }): Promise<Partner[]>
  setStatus(animaId: string, status: Partner['status']): Promise<void>
}
