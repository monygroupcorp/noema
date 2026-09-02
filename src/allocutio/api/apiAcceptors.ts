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
import type { CredentialAcceptors, ApiKeyIdentity } from './IdentityResolver.js'
import { AgentJwtVerifier, type JwksFetch } from './AgentJwtVerifier.js'

/**
 * One verified `users.apiKeys[]` record, as the injected key lookup hands it over.
 *
 * `maxImpetusPerRun` is carried as the RAW STORED STRING — the store's own shape (a stringified
 * bigint, so a value larger than a JS number survives Mongo) — and is parsed here, in the
 * hermetic layer, rather than at the database seam. A key minted before the field existed simply
 * omits it.
 */
export interface ApiKeyAccount {
  /** The stable account id — the `'api'` persona's externusId. */
  accountId: string
  /**
   * Per-run impetus ceiling recorded on the key, RAW AS STORED and deliberately `unknown`: it
   * comes out of a schemaless collection, so declaring it `string` here would be a promise the
   * database never made. `parseKeyImpetusCeiling` below is the only thing that decides what it
   * means, and it refuses anything it cannot read. Absent → the key sets no ceiling.
   */
  maxImpetusPerRun?: unknown
}

/**
 * Parse a stored `maxImpetusPerRun` into the bigint the admission check compares against.
 *
 *   • `undefined` in  → `undefined` out: the key carries no ceiling (every pre-existing key).
 *   • a canonical non-negative integer string → that value.
 *   • ANYTHING ELSE → `null`, meaning "this key is not usable".
 *
 * The last case is the one that matters. A stored ceiling that cannot be read must never
 * degrade to "no ceiling": that would turn a corrupt record into an UNCAPPED key, which is the
 * exact failure this field exists to prevent. Refusing the key fails closed instead — the
 * partner gets a 401 and someone fixes the record, and no run is admitted in the meantime.
 */
export function parseKeyImpetusCeiling(raw: unknown): bigint | null | undefined {
  if (raw === undefined || raw === null) return undefined
  if (typeof raw !== 'string' || !/^\d+$/.test(raw)) return null
  try {
    return BigInt(raw)
  } catch {
    return null
  }
}

export interface AcceptorDeps {
  personae: Pick<PersonaStore, 'findByExternus' | 'findOrCreate'>
  animae: Pick<AnimaStore, 'create'>
  /** Legacy web JWT secret (`process.env.JWT_SECRET`). Absent → JWT auth is unconfigured. */
  jwtSecret?: string
  /**
   * Validate an API key → the stored record behind it (its `'api'` persona externusId, plus
   * whatever limits the key itself carries), or null when the key does not verify. Injected —
   * `index.ts` plugs in the `users.apiKeys[]` lookup.
   */
  verifyApiKeyToAccountId?: (apiKey: string) => Promise<ApiKeyAccount | null>
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
      ? async (key: string): Promise<ApiKeyIdentity | null> => {
          const acct = await verifyApiKeyToAccountId(key)
          if (!acct) return null
          // Read the ceiling BEFORE resolving the anima: an unreadable ceiling refuses the key
          // outright (see `parseKeyImpetusCeiling`), and refusing it here means the refusal
          // costs no persona lookup and mints no anima on a key that will not be admitted.
          const ceiling = parseKeyImpetusCeiling(acct.maxImpetusPerRun)
          if (ceiling === null) return null
          const animaId = await resolveOrCreateAnima(personae, animae, 'api', acct.accountId)
          return ceiling === undefined ? { animaId } : { animaId, maxImpetusPerRun: ceiling }
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
