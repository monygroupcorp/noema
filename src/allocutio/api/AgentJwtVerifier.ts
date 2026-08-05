// =============================================================================
// AgentJwtVerifier — federated ES256/JWKS assertion verification (universal SSO).
// =============================================================================
//
// Re-expresses the legacy `agentJwtVerifier.js` on crystal primitives. A partner
// IdP (the `Issuer` registry) publishes a JWKS; this verifies a Bearer assertion
// against it: decode `iss` → look up an **active** `Issuer` → fetch/cache its
// JWKS → match `kid` (refetch-once on rotation) → verify ES256 with `aud:noema.art`.
//
// Return contract (the acceptor + resolver depend on it exactly):
//   • returns `null` when the token is NOT a federated assertion we own — an
//     unregistered/suspended `iss`, a non-ES256 alg, or an undecodable token.
//     The caller then falls through to the legacy web (HS256) JWT path.
//   • returns `{ payload, issuer }` on successful verification.
//   • THROWS an `ApiError` when the token IS federated (registered `iss`) but
//     fails: bad signature / expired / missing-or-unknown `kid` → 401
//     `auth.invalid`; JWKS unreachable/malformed → 503 (retryable). This is what
//     makes the auth-shadow probe return 401, never a catch-all 403.
//
// SSRF: the JWKS URL comes from the admin-controlled registry, but we still
// validate the host is a plain hostname over https (the dev override may relax
// to http for a loopback worker). Never fetch an IP literal or a bare label.

import jwt, { type JwtPayload, type JwtHeader } from 'jsonwebtoken'
import { createPublicKey, type JsonWebKey } from 'node:crypto'
import type { Issuer, IssuerStore } from '../../types/issuer.js'
import { ApiError, Errors } from './errors.js'

/** 503 for a federated token whose issuer JWKS we could not reach/parse. */
function jwksUnavailable(message: string): ApiError {
  return new ApiError('internal.upstream_unavailable', message, 503, { retryable: true, retryAfter: 15 })
}

/** Plain-hostname guard (SSRF defense): letters/digits/hyphens/dots, ≥1 dot,
 *  no IP literals, credentials, ports, paths, or bare labels like `localhost`. */
function isValidHostname(host: string): boolean {
  if (typeof host !== 'string') return false
  return /^[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+$/.test(host)
}

/** The subset of the WHATWG `fetch` Response we use — injectable for hermetic tests. */
export interface JwksResponse {
  ok: boolean
  status: number
  statusText: string
  json(): Promise<unknown>
  headers: { get(name: string): string | null }
}
export type JwksFetch = (url: string) => Promise<JwksResponse>

/** A single JWK (only the fields we forward to `createPublicKey`). */
interface Jwk {
  kid?: string
  kty?: string
  crv?: string
  x?: string
  y?: string
  [k: string]: unknown
}

interface CacheEntry {
  keys?: Jwk[]
  expiresAt?: number
  promise?: Promise<Jwk[]>
}

export interface VerifiedAssertion {
  payload: JwtPayload
  issuer: Issuer
}

export interface AgentJwtVerifierDeps {
  /** Trusted-issuer registry — resolves the asserted `iss` → JWKS URL. */
  issuers: Pick<IssuerStore, 'findByIssuerId'>
  /** Injected fetch (defaults to global `fetch`). Hermetic tests pass a stub. */
  fetchFn?: JwksFetch
  /** JWKS cache TTL when the response carries no `Cache-Control: max-age`. */
  jwksTtlSeconds?: number
  /** Parsed `AGENT_JWKS_OVERRIDE` — `{ "<issuer-host>": "<base-url>" }`. The JWKS
   *  is then fetched from `<base-url>/.well-known/jwks.json` (http allowed for dev). */
  jwksOverride?: Record<string, string>
  /** Clock injection for TTL tests (defaults to `Date.now`). */
  now?: () => number
}

export class AgentJwtVerifier {
  private readonly issuers: Pick<IssuerStore, 'findByIssuerId'>
  private readonly fetchFn: JwksFetch
  private readonly jwksTtlSeconds: number
  private readonly jwksOverride: Record<string, string>
  private readonly now: () => number
  /** Keyed by `issuerId`. */
  private readonly cache = new Map<string, CacheEntry>()

  constructor(deps: AgentJwtVerifierDeps) {
    this.issuers = deps.issuers
    this.fetchFn = deps.fetchFn ?? defaultFetch
    this.jwksTtlSeconds = deps.jwksTtlSeconds ?? 3600
    this.jwksOverride = deps.jwksOverride ?? {}
    this.now = deps.now ?? (() => Date.now())
  }

  /**
   * Verify a Bearer token as a federated assertion. See the return contract in
   * the file header. `null` = "not mine, try the next acceptor".
   */
  async verify(token: string): Promise<VerifiedAssertion | null> {
    // 1. Decode (no signature check) to read `iss`/`alg`/`kid`.
    const decoded = jwt.decode(token, { complete: true })
    if (!decoded || typeof decoded.payload === 'string') return null
    const header = decoded.header as JwtHeader
    const payload = decoded.payload as JwtPayload

    const iss = typeof payload.iss === 'string' ? payload.iss : undefined
    if (!iss) return null

    // 2. Only claim the token if `iss` is a registered, active issuer.
    const issuer = await this.issuers.findByIssuerId(iss)
    if (!issuer) return null   // unknown/suspended → fall through to the legacy web JWT

    // From here the token IS federated: every failure throws (401/503), never null.
    if (header.alg !== 'ES256') {
      throw Errors.authInvalid(`INVALID_ASSERTION: unsupported alg '${header.alg}' (expected ES256)`)
    }
    if (!header.kid) {
      throw Errors.authInvalid('INVALID_ASSERTION: token missing kid header claim')
    }

    // 3. Resolve the signing key (refetch once on a kid miss — issuer key rotation).
    let jwk = (await this.getJwks(issuer)).find(k => k.kid === header.kid)
    if (!jwk) {
      this.cache.delete(issuer.issuerId)
      jwk = (await this.getJwks(issuer)).find(k => k.kid === header.kid)
      if (!jwk) {
        throw Errors.authInvalid(`INVALID_ASSERTION: no key with kid '${header.kid}' in JWKS for ${iss}`)
      }
    }

    // 4. JWK → PEM.
    let pem: string
    try {
      pem = createPublicKey({ key: jwk as unknown as JsonWebKey, format: 'jwk' })
        .export({ type: 'spki', format: 'pem' }).toString()
    } catch (err) {
      throw Errors.authInvalid(`INVALID_ASSERTION: unusable signing key — ${(err as Error).message}`)
    }

    // 5. Verify signature + registered claims. `aud`/`iss` are pinned.
    let verified: JwtPayload
    try {
      const result = jwt.verify(token, pem, { algorithms: ['ES256'], audience: 'noema.art', issuer: iss })
      if (typeof result === 'string') throw new Error('unexpected string payload')
      verified = result
    } catch (err) {
      const name = (err as Error).name
      if (name === 'TokenExpiredError') throw Errors.authInvalid('INVALID_ASSERTION: assertion has expired')
      throw Errors.authInvalid(`INVALID_ASSERTION: ${(err as Error).message}`)
    }

    return { payload: verified, issuer }
  }

  // ---------------------------------------------------------------------------
  // JWKS fetch + cache (in-flight dedup, TTL from Cache-Control, refetch on miss)
  // ---------------------------------------------------------------------------

  private async getJwks(issuer: Issuer): Promise<Jwk[]> {
    const entry = this.cache.get(issuer.issuerId)
    if (entry?.keys && entry.expiresAt && entry.expiresAt > this.now()) return entry.keys
    if (entry?.promise) return entry.promise   // coalesce concurrent fetches

    const promise = this.doFetchJwks(issuer)
    this.cache.set(issuer.issuerId, { promise })
    return promise
  }

  private async doFetchJwks(issuer: Issuer): Promise<Jwk[]> {
    const url = this.resolveJwksUrl(issuer)

    let res: JwksResponse
    try {
      res = await this.fetchFn(url)
    } catch (err) {
      this.cache.delete(issuer.issuerId)
      throw jwksUnavailable(`Failed to fetch JWKS from ${url}: ${(err as Error).message}`)
    }
    if (!res.ok) {
      this.cache.delete(issuer.issuerId)
      throw jwksUnavailable(`JWKS endpoint returned ${res.status} ${res.statusText} for ${url}`)
    }

    let data: unknown
    try {
      data = await res.json()
    } catch (err) {
      this.cache.delete(issuer.issuerId)
      throw jwksUnavailable(`Failed to parse JWKS JSON from ${url}: ${(err as Error).message}`)
    }
    const keys = (data as { keys?: unknown })?.keys
    if (!Array.isArray(keys)) {
      this.cache.delete(issuer.issuerId)
      throw jwksUnavailable(`JWKS response from ${url} is missing a 'keys' array`)
    }

    // TTL from Cache-Control: max-age, else the configured default.
    let ttlSeconds = this.jwksTtlSeconds
    const cc = res.headers.get('cache-control')
    const m = cc?.match(/max-age=(\d+)/)
    if (m) ttlSeconds = parseInt(m[1], 10)

    this.cache.set(issuer.issuerId, { keys: keys as Jwk[], expiresAt: this.now() + ttlSeconds * 1000 })
    return keys as Jwk[]
  }

  /** Apply the dev override (keyed by issuer host), else the registry `jwksUrl`. SSRF-guarded. */
  private resolveJwksUrl(issuer: Issuer): string {
    let issuerHost: string
    try {
      issuerHost = new URL(issuer.issuerId).host
    } catch {
      throw jwksUnavailable(`Issuer '${issuer.issuerId}' is not a valid URL`)
    }

    const overrideBase = this.jwksOverride[issuerHost]
    if (overrideBase) {
      return overrideBase.replace(/\/$/, '') + '/.well-known/jwks.json'
    }

    let jwksHost: string
    try {
      const u = new URL(issuer.jwksUrl)
      jwksHost = u.host
      if (u.protocol !== 'https:') {
        throw jwksUnavailable(`Refusing non-https JWKS URL for ${issuer.issuerId}: ${issuer.jwksUrl}`)
      }
    } catch (err) {
      if (err instanceof ApiError) throw err
      throw jwksUnavailable(`Issuer '${issuer.issuerId}' has an invalid jwksUrl: ${issuer.jwksUrl}`)
    }
    if (!isValidHostname(jwksHost)) {
      throw jwksUnavailable(`Refusing to fetch JWKS: host '${jwksHost}' failed hostname validation`)
    }
    return issuer.jwksUrl
  }
}

/** Default fetch: global `fetch` with a 10s timeout. */
const defaultFetch: JwksFetch = async (url) => {
  const signal = typeof AbortSignal?.timeout === 'function' ? AbortSignal.timeout(10_000) : undefined
  const res = await fetch(url, signal ? { signal } : {})
  return res as unknown as JwksResponse
}

/** Parse `AGENT_JWKS_OVERRIDE` (a JSON object of host → base-url). Tolerates junk → `{}`. */
export function parseJwksOverride(raw: string | undefined): Record<string, string> {
  if (!raw) return {}
  try {
    const parsed = JSON.parse(raw)
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      const out: Record<string, string> = {}
      for (const [k, v] of Object.entries(parsed)) if (typeof v === 'string') out[k] = v
      return out
    }
  } catch { /* malformed → no override */ }
  return {}
}
