// =============================================================================
// IdentityResolver — request credentials → crystal `AuctorKey`.
// =============================================================================
//
// The API edge turns whatever a request carries (a Bearer JWT, an `X-API-Key`,
// an arcanum `commitment`, or a web3 signature bundle) into the crystal's
// identity union `AuctorKey` (`{ animaId }` for identified callers, `{ commitment }`
// for anonymous arcanum spends).
//
// The actual credential-verification primitives — JWT signature check, internal
// API-key lookup, web3 signature recovery — are INJECTED as `CredentialAcceptors`.
// This keeps the resolver hermetic and unit-testable: the real wiring to jwt /
// the internal data API plugs in at app construction and is validated on staging.

import type { AuctorKey } from '../../flow/types.js'
import { Errors } from './errors.js'

// ---------------------------------------------------------------------------
// Credentials — the raw bits pulled off a request
// ---------------------------------------------------------------------------

export interface Credentials {
  /** Bearer token, e.g. `Authorization: Bearer <jwt>`. */
  authorization?: string
  /** Raw API key, e.g. from the `X-API-Key` header. */
  apiKey?: string
  /** An arcanum spend commitment — self-asserting, anonymous identity. */
  commitment?: string
  /** A web3 signature bundle (address + signature over a nonce). */
  web3?: { address: string; signature: string; nonce: string }
}

// ---------------------------------------------------------------------------
// CredentialAcceptors — the injected verification seams
// ---------------------------------------------------------------------------
//
// Each acceptor returns the resolved `animaId` on success, or `null` on a
// verification failure. The real implementations (jwt verify, internal-API key
// lookup, web3 signature recovery) are wired in at app construction.

/**
 * A verified API key's identity: the anima it authenticates as, plus any spend
 * ceiling minted onto the key ITSELF.
 *
 * An API key is issued by the platform, not by its bearer, so a limit recorded on
 * the key is a limit the bearer cannot edit. `maxImpetusPerRun` is that limit at the
 * per-run altitude — see `CrystalApi.InvokeOpts.keyMaxImpetusPerRun` for how it binds.
 * Absent (the shape every key had before this field existed) means the key imposes no
 * ceiling of its own and admission behaves exactly as it always has.
 *
 * There is deliberately no AGGREGATE ceiling here: the account's own balance already
 * bounds everything a key can spend in total, through the settle path every caller
 * goes through.
 */
export interface ApiKeyIdentity {
  animaId: string
  /** Hard per-run admission cap (impetus). Absent → the key adds no cap of its own. */
  maxImpetusPerRun?: bigint
}

export interface CredentialAcceptors {
  /**
   * Federated SSO (JWKS) verification of a Bearer token, tried BEFORE `verifyJwt`.
   * Contract: resolves the token's `iss` against the trusted-issuer registry and
   *   • returns `null` when `iss` is not a registered active issuer (or the token
   *     is not an ES256 assertion) → the resolver falls through to `verifyJwt`;
   *   • returns the `animaId` on successful federated verification;
   *   • THROWS an `ApiError` (401 `auth.invalid` / 503) when the token IS federated
   *     but fails verification — so a garbage assertion is a 401, never a 403.
   */
  verifyAgentJwt?(token: string): Promise<string | null>
  verifyJwt?(token: string): Promise<string | null>
  /**
   * API-key verification. Returns the key's `ApiKeyIdentity` — the resolved `animaId`
   * and any ceiling the key carries — or `null` when the key does not verify.
   */
  validateApiKey?(key: string): Promise<ApiKeyIdentity | null>
  verifyWeb3?(w: { address: string; signature: string; nonce: string }): Promise<string | null>
}

// ---------------------------------------------------------------------------
// ResolvedCaller — the AuctorKey plus the limits its CREDENTIAL carries
// ---------------------------------------------------------------------------

/**
 * What one request's credential resolved to.
 *
 * `auctor` is the identity the crystal knows: the same `AuctorKey` `resolve()` has always
 * returned, and the ONLY part that is ever persisted (it lands verbatim on `Inceptio.by`).
 * Anything else here describes the CREDENTIAL, not the account, and stays out of the crystal —
 * which is why it rides alongside the `AuctorKey` rather than inside it.
 */
export interface ResolvedCaller {
  auctor: AuctorKey
  /**
   * Per-run spend ceiling minted onto the credential (an API key). Absent for every other
   * credential kind and for keys that carry none. Routers thread this into
   * `CrystalApi.invokeFlow`, where it binds as a floor under the caller's own `maxImpetus`.
   */
  maxImpetusPerRun?: bigint
}

// ---------------------------------------------------------------------------
// IdentityResolver
// ---------------------------------------------------------------------------

export class IdentityResolver {
  constructor(private readonly acceptors: CredentialAcceptors) {}

  /**
   * Resolve raw `Credentials` into an `AuctorKey`.
   *
   * The identity-only view of `resolveCaller` — unchanged in behaviour and in shape, so
   * every caller that only needs "who is this" keeps working exactly as before. A route
   * that ADMITS SPEND wants `resolveCaller` instead: it also carries the limits the
   * credential itself imposes, which this view drops.
   */
  async resolve(creds: Credentials): Promise<AuctorKey> {
    return (await this.resolveCaller(creds)).auctor
  }

  /**
   * Resolve raw `Credentials` into an `AuctorKey` plus whatever limits the credential carries.
   *
   * Priority order:
   *   1. `commitment` — anonymous arcanum spend, accepted as-is (the real spend
   *      validation / double-spend check happens downstream in ActumInceptor).
   *   2. `apiKey`     — looked up via `validateApiKey`.
   *   3. `authorization` (`Bearer …`) — verified via `verifyJwt`.
   *   4. `web3`       — verified via `verifyWeb3`.
   *   5. nothing      — `auth.missing`.
   *
   * If a credential is present but its acceptor isn't configured, this throws
   * `auth.invalid` ('<kind> auth not configured').
   */
  async resolveCaller(creds: Credentials): Promise<ResolvedCaller> {
    // 1. commitment — self-asserting anonymous identity, no acceptor needed.
    if (creds.commitment) {
      return { auctor: { commitment: creds.commitment } }
    }

    // 2. apiKey
    if (creds.apiKey) {
      if (!this.acceptors.validateApiKey) {
        throw Errors.authInvalid('apiKey auth not configured')
      }
      const identity = await this.acceptors.validateApiKey(creds.apiKey)
      if (!identity) throw Errors.authInvalid('invalid API key')
      // The ceiling rides BESIDE the AuctorKey, never inside it: `{ animaId }` is what the
      // crystal persists as `Inceptio.by`, and a per-credential limit is not part of who
      // the caller is.
      return {
        auctor: { animaId: identity.animaId },
        ...(identity.maxImpetusPerRun !== undefined ? { maxImpetusPerRun: identity.maxImpetusPerRun } : {}),
      }
    }

    // 3. authorization: Bearer <jwt>
    if (creds.authorization && creds.authorization.startsWith('Bearer ')) {
      const token = creds.authorization.slice('Bearer '.length)

      // 3a. Federated SSO (JWKS) first. It only claims tokens whose `iss` is a
      //     registered active `Issuer`; otherwise it returns null and we fall
      //     through to the legacy web JWT. A federated token that FAILS throws
      //     its own ApiError (401/503) — never falls through to a catch-all 403.
      if (this.acceptors.verifyAgentJwt) {
        const federatedAnimaId = await this.acceptors.verifyAgentJwt(token)
        if (federatedAnimaId) return { auctor: { animaId: federatedAnimaId } }
      }

      // 3b. Legacy web JWT (env-secret HS256).
      if (!this.acceptors.verifyJwt) {
        throw Errors.authInvalid('bearer auth not configured')
      }
      const animaId = await this.acceptors.verifyJwt(token)
      if (!animaId) throw Errors.authInvalid('invalid token')
      return { auctor: { animaId } }
    }

    // 4. web3 signature bundle
    if (creds.web3) {
      if (!this.acceptors.verifyWeb3) {
        throw Errors.authInvalid('web3 auth not configured')
      }
      const animaId = await this.acceptors.verifyWeb3(creds.web3)
      if (!animaId) throw Errors.authInvalid('web3 verification failed')
      return { auctor: { animaId } }
    }

    // 5. nothing provided
    throw Errors.authMissing()
  }
}

// ---------------------------------------------------------------------------
// credentialsFromHeaders — pure header/body → Credentials mapper
// ---------------------------------------------------------------------------
//
// Maps the standard places a request carries credentials into a `Credentials`
// bundle, so the route layer can build it uniformly. Pure — no framework types.

export function credentialsFromHeaders(
  headers: Record<string, string | undefined>,
  body?: any,
): Credentials {
  const creds: Credentials = {}

  if (headers.authorization) creds.authorization = headers.authorization
  if (headers['x-api-key']) creds.apiKey = headers['x-api-key']
  // Anon commitment: body (POST) OR the `x-commitment` header — the header is the
  // only channel on bodyless requests (GET /runs/:id, the SSE stream), so without
  // it an anon caller could start a run but never retrieve or observe it.
  if (body?.commitment) creds.commitment = body.commitment
  else if (headers['x-commitment']) creds.commitment = headers['x-commitment']
  if (body?.web3) creds.web3 = body.web3

  return creds
}
