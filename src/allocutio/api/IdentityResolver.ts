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

export interface CredentialAcceptors {
  verifyJwt?(token: string): Promise<string | null>
  validateApiKey?(key: string): Promise<string | null>
  verifyWeb3?(w: { address: string; signature: string; nonce: string }): Promise<string | null>
}

// ---------------------------------------------------------------------------
// IdentityResolver
// ---------------------------------------------------------------------------

export class IdentityResolver {
  constructor(private readonly acceptors: CredentialAcceptors) {}

  /**
   * Resolve raw `Credentials` into an `AuctorKey`.
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
  async resolve(creds: Credentials): Promise<AuctorKey> {
    // 1. commitment — self-asserting anonymous identity, no acceptor needed.
    if (creds.commitment) {
      return { commitment: creds.commitment }
    }

    // 2. apiKey
    if (creds.apiKey) {
      if (!this.acceptors.validateApiKey) {
        throw Errors.authInvalid('apiKey auth not configured')
      }
      const animaId = await this.acceptors.validateApiKey(creds.apiKey)
      if (!animaId) throw Errors.authInvalid('invalid API key')
      return { animaId }
    }

    // 3. authorization: Bearer <jwt>
    if (creds.authorization && creds.authorization.startsWith('Bearer ')) {
      if (!this.acceptors.verifyJwt) {
        throw Errors.authInvalid('bearer auth not configured')
      }
      const token = creds.authorization.slice('Bearer '.length)
      const animaId = await this.acceptors.verifyJwt(token)
      if (!animaId) throw Errors.authInvalid('invalid token')
      return { animaId }
    }

    // 4. web3 signature bundle
    if (creds.web3) {
      if (!this.acceptors.verifyWeb3) {
        throw Errors.authInvalid('web3 auth not configured')
      }
      const animaId = await this.acceptors.verifyWeb3(creds.web3)
      if (!animaId) throw Errors.authInvalid('web3 verification failed')
      return { animaId }
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
