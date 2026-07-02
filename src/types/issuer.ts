// =============================================================================
// ISSUER — a federated identity provider whose JWTs we accept (SSO allow-list).
// =============================================================================
//
// Multi-issuer JWKS verification is *federated identity*, not agent auth: any
// white-label partner running an IdP can publish a JWKS and have its users land
// as real Noema `Anima`s. The CAMEL client (`camelcabal.fun`) is one such issuer;
// its assertions are agent-shaped, but the verification path is universal.
//
// An `Issuer` is the trusted-issuer allow-list entry: `issuerId` MUST equal the
// JWT `iss` claim exactly, and `jwksUrl` is where its signing keys are published.
// Only `status:'active'` issuers are honored; suspending an issuer instantly
// stops accepting its tokens without deleting the record.
// =============================================================================

export interface Issuer {
  /** MUST equal the JWT `iss` claim exactly, e.g. `https://camelcabal.fun`. */
  issuerId: string
  /** Human-readable name, e.g. `CAMEL`. */
  name: string
  /** JWKS endpoint, e.g. `https://camelcabal.fun/.well-known/jwks.json`. */
  jwksUrl: string
  status: 'active' | 'suspended'
  /** "natum" = born — when this issuer was registered. */
  natum?: Date
}

/** "Issuers" — nominative plural. The trusted-issuer registry. */
export type Issuers = Issuer[]

/**
 * IssuerStore — the trusted-issuer registry.
 * The JWKS acceptor reads `findByIssuerId` on every federated Bearer token, so
 * it must be cheap (indexed on `issuerId`); admin surfaces use `upsert`/`list`.
 */
export interface IssuerStore {
  /** The hot path: resolve an asserted `iss` → its **active** issuer, or null. */
  findByIssuerId(issuerId: string): Promise<Issuer | null>
  /** Every issuer regardless of status (admin listing). */
  list(): Promise<Issuers>
  /** Register or update an issuer (keyed on `issuerId`). */
  upsert(issuer: Pick<Issuer, 'issuerId' | 'name' | 'jwksUrl'> & { status?: Issuer['status'] }): Promise<Issuer>
  /** Set an issuer's status (suspend/reactivate) without touching its keys. */
  setStatus(issuerId: string, status: Issuer['status']): Promise<void>
}
