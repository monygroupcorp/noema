// =============================================================================
// apiAcceptors — wire the IdentityResolver's credential acceptors to the crystal.
// =============================================================================
//
// Each acceptor turns a VERIFIED credential into a stable `externusId`, then maps
// it to an `animaId` via the same persona "find-or-create on first sight" path the
// Telegram resolver uses (`personae.findByExternus(genus, ext)` → `activeAnimaId`,
// else mint an anima + link a persona). The crystal already models `'web'`/`'api'`
// personae, so this needs no new identity bridge — `Anima.id` (a uuid) is reached
// only through the persona, never the legacy `masterAccountId`.
//
// JWT verification is done inline (jsonwebtoken is pure crypto — hermetic). The
// api-key + web3 verifiers reach legacy services, so they're INJECTED — the factory
// logic stays hermetic; `index.ts` plugs in the real primitives (validated on staging).

import jwt, { type JwtPayload } from 'jsonwebtoken'
import type { AnimaStore } from '../../types/anima.js'
import type { PersonaStore, PersonaGenus } from '../../types/persona.js'
import type { IssuerStore } from '../../types/issuer.js'
import type { ErasedDenylistStore } from '../../types/erasure.js'
import type { CredentialAcceptors } from './IdentityResolver.js'
import { AgentJwtVerifier, type JwksFetch } from './AgentJwtVerifier.js'

export interface AcceptorDeps {
  personae: Pick<PersonaStore, 'findByExternus' | 'findOrCreate'>
  animae: Pick<AnimaStore, 'create'>
  /** Legacy web JWT secret (`process.env.JWT_SECRET`). Absent → JWT auth is unconfigured. */
  jwtSecret?: string
  /** Validate an API key → a stable account id (its `'api'` persona externusId), or null. Injected. */
  verifyApiKeyToAccountId?: (apiKey: string) => Promise<string | null>
  /** Verify a web3 sig bundle → the signer address, or null. Injected. */
  verifyWeb3ToAddress?: (w: { address: string; signature: string; nonce: string }) => Promise<string | null>
  /** Trusted-issuer registry for federated (JWKS) SSO. Absent → no federated acceptor. */
  issuers?: Pick<IssuerStore, 'findByIssuerId'>
  /** Injected JWKS fetch (defaults to global fetch inside the verifier). */
  jwksFetch?: JwksFetch
  /** Parsed `AGENT_JWKS_OVERRIDE` (host → base-url) for the JWKS acceptor. */
  jwksOverride?: Record<string, string>
  /**
   * Erased-account (session-revocation) denylist (noema-025). Consulted by `verifyJwt` — a
   * session whose resolved `animaId` is on it is REJECTED (returns null → 401/invalid), which is
   * how a GDPR-erased soul's still-signature-valid JWT is revoked (sessions are otherwise
   * stateless). Absent → no revocation layer (the pre-noema-025 behaviour).
   */
  denylist?: ErasedDenylistStore
}

/** The federated persona externusId for a verified `(iss, sub)` — issuer-namespaced
 *  so subjects never collide across issuers. Shared by the JWKS acceptor and the
 *  agent-provisioning compat route so re-auth lands on the same Anima. */
export function federatedExternusId(iss: string, sub: string): string {
  return `${iss}::${sub}`
}

/** Find the anima behind a VERIFIED external identity, or mint one on first sight. */
export async function resolveOrCreateAnima(
  personae: AcceptorDeps['personae'],
  animae: AcceptorDeps['animae'],
  genus: PersonaGenus,
  externusId: string,
): Promise<string> {
  const existing = await personae.findByExternus(genus, externusId)
  if (existing) return existing.activeAnimaId
  const anima = await animae.create({ nomen: `${genus}:${externusId}` })
  await personae.findOrCreate(genus, externusId, { animaId: anima.id })
  return anima.id
}

export function makeCredentialAcceptors(deps: AcceptorDeps): CredentialAcceptors {
  const { personae, animae, jwtSecret, verifyApiKeyToAccountId, verifyWeb3ToAddress, issuers, denylist } = deps

  // Federated SSO acceptor — built only when a trusted-issuer registry is wired.
  // A verified assertion lands as a `'federated'` persona keyed by `<iss>::<sub>`
  // (issuer-namespaced so subjects never collide across issuers), minting an anima
  // on first sight exactly like the web/api paths. Verification failures throw
  // their own ApiError (401/503) up through the resolver — they do NOT return null.
  const agentVerifier = issuers
    ? new AgentJwtVerifier({
        issuers,
        ...(deps.jwksFetch ? { fetchFn: deps.jwksFetch } : {}),
        ...(deps.jwksOverride ? { jwksOverride: deps.jwksOverride } : {}),
      })
    : undefined

  return {
    verifyAgentJwt: agentVerifier
      ? async (token: string): Promise<string | null> => {
          const result = await agentVerifier.verify(token)
          if (!result) return null   // not a registered federated issuer → try the next acceptor
          const { payload, issuer } = result
          const sub = typeof payload.sub === 'string' ? payload.sub : undefined
          if (!sub) return null
          return resolveOrCreateAnima(personae, animae, 'federated', federatedExternusId(issuer.issuerId, sub))
        }
      : undefined,

    verifyJwt: jwtSecret
      ? async (token: string): Promise<string | null> => {
          let payload: JwtPayload | string
          try {
            payload = jwt.verify(token, jwtSecret)
          } catch {
            return null
          }
          if (typeof payload === 'string') return null
          // Fiat-auth session tokens (authRouter) carry the resolved `animaId` DIRECTLY in
          // `sub` under `typ:'session'`. Use it as-is — the `'password'` persona already
          // established this anima at register/verify, so re-resolving under `'web'` would
          // split the account in two (docs/spec/fiat-auth.md §trap).
          let resolved: string | null
          if (payload.typ === 'session') {
            resolved = typeof payload.sub === 'string' ? payload.sub : null
          } else {
            const ext = payload.userId ?? payload.sub ?? payload._id ?? payload.id
            if (!ext) return null
            resolved = await resolveOrCreateAnima(personae, animae, 'web', String(ext))
          }
          if (!resolved) return null
          // Session revocation (noema-025): a GDPR-erased soul's JWT is still SIGNATURE-valid
          // (sessions are stateless), so reject it here if the resolved animaId is denylisted.
          if (denylist && (await denylist.has(resolved))) return null
          return resolved
        }
      : undefined,

    validateApiKey: verifyApiKeyToAccountId
      ? async (key: string): Promise<string | null> => {
          const acct = await verifyApiKeyToAccountId(key)
          return acct ? resolveOrCreateAnima(personae, animae, 'api', acct) : null
        }
      : undefined,

    verifyWeb3: verifyWeb3ToAddress
      ? async (w: { address: string; signature: string; nonce: string }): Promise<string | null> => {
          const addr = await verifyWeb3ToAddress(w)
          return addr ? resolveOrCreateAnima(personae, animae, 'web', addr.toLowerCase()) : null
        }
      : undefined,
  }
}
