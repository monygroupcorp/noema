// =============================================================================
// partnerContract — the one B2B agreement, its version, and what it must say
// =============================================================================
//
// A B2B API customer does not get a key for asking. It gets one for signing the API
// Customer Agreement, and the signature records WHICH version was signed
// (`types/partnerContract.ts`). That makes the version id load-bearing: it is stamped
// onto the key (`ApiKeyEntry.contractVersion`), and the credential acceptor refuses a
// partner key whose stamp is not the version this deployment is running
// (`apiAcceptors.ts`). Bump it without republishing the page, or republish the page
// without bumping it, and a customer is bound to text nobody can read.
//
// So the version lives HERE, in code, and `tests/unit/api/partnerContract.test.ts`
// holds it equal to the `Version:` line of the published page. The same test holds the
// page to the four commitments below — the ones the agreement exists to make. They are
// declared as patterns rather than prose so that rewording the page is free and
// DELETING one of them is not.
//
// The page itself is published at `PARTNER_CONTRACT_PATH` and mirrored into
// `docs/legal/` (guard-legal-mirror keeps the two byte-identical).
// =============================================================================

/**
 * The version of the API Customer Agreement this deployment issues keys against.
 *
 * Equal to the `Version:` line of the published page — held so by a hermetic guard.
 * Bumping it is a deliberate act with teeth: every partner key stamped with an older
 * version stops authenticating, and its holder must re-sign and rotate. That is the
 * mechanism section 5 of the agreement describes; it is not a formality.
 */
export const PARTNER_CONTRACT_VERSION = 'api-2026-09-17'

/** Where the agreement is published — the path a partner is sent to read before signing. */
export const PARTNER_CONTRACT_PATH = '/legal/api-terms'

/** The published page, relative to the repository root. The guard reads it from here. */
export const PARTNER_CONTRACT_SOURCE = 'src/platforms/web/app/src/content/api-terms.md'

/**
 * The commitments the agreement must carry to be the thing this feature claims it is.
 * Each is a label (what it is) and a pattern (how to find it in the page). A rewrite that
 * drops one fails the guard; a rewrite that keeps the substance passes.
 */
export const PARTNER_CONTRACT_COMMITMENTS: ReadonlyArray<{ label: string; pattern: RegExp }> = [
  {
    label: 'input warranty — the customer warrants its rights in what it sends',
    pattern: /You warrant, for every input/i,
  },
  {
    label: 'indemnity — the customer defends and indemnifies us for its inputs and outputs',
    pattern: /You will defend, indemnify, and hold us harmless/i,
  },
  {
    label: "our right to cut a key — suspension or revocation at our discretion, without notice",
    pattern: /We may suspend or revoke any key immediately, without notice/i,
  },
  {
    label: 'no named-artist styles, binding BOTH sides',
    pattern: /Neither side trades on a named living artist's identity/i,
  },
] as const
