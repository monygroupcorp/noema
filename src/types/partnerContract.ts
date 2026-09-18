// =============================================================================
// PARTNER CONTRACT SIGNATURE — one organization's acceptance of one version
// =============================================================================
//
// The signature, not the agreement. The agreement is a published page and a version
// constant (`src/crystal/partnerContract.ts`); this is the record that a particular
// partner accepted a particular version of it, at a particular moment, through a named
// human. It exists so the question "which text is this customer bound by?" has an answer
// that survives the page being revised.
//
// Append-only by construction: signing again writes a NEW row rather than editing the old
// one, because a superseded signature is still the thing that governed the runs made under
// it. The read every gate needs is "is there a signature at version V for this anima?",
// which is `findCurrent`.
//
// {animaId}-keyed lookup, own small dedicated store — the same convention `Partner` and
// `Sponsio` follow, and for the same reason: never widen `Anima` for a feature's flag.
// =============================================================================

export interface PartnerContractSignature {
  id: string
  /** FK -> Anima. The partner organization's account. */
  animaId: string
  /** The agreement version accepted — matched against `PARTNER_CONTRACT_VERSION`. */
  version: string
  /** The human who signed, as they typed it. Not verified; it is the name on the record. */
  signerName: string
  /** The signer's role at the organization, if given. */
  signerTitle?: string
  /** When the signature was taken. */
  signedAt: Date
}

export interface PartnerContractStore {
  /** Record an acceptance. Always appends — an earlier signature is never edited or replaced. */
  sign(input: Omit<PartnerContractSignature, 'id' | 'signedAt'> & { signedAt?: Date }): Promise<PartnerContractSignature>
  /** The signature this anima holds at `version`, or null. The gate every key mint and every
   *  partner-key admission asks. Returns the EARLIEST such signature — re-signing the same
   *  version does not move the date the customer became bound by it. */
  findCurrent(animaId: string, version: string): Promise<PartnerContractSignature | null>
  /** Every signature this anima has given, newest first — the partner's own audit trail. */
  list(animaId: string): Promise<PartnerContractSignature[]>
}
