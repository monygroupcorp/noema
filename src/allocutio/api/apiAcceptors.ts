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
import type { CredentialAcceptors } from './IdentityResolver.js'

export interface AcceptorDeps {
  personae: Pick<PersonaStore, 'findByExternus' | 'findOrCreate'>
  animae: Pick<AnimaStore, 'create'>
  /** Legacy web JWT secret (`process.env.JWT_SECRET`). Absent → JWT auth is unconfigured. */
  jwtSecret?: string
  /** Validate an API key → a stable account id (its `'api'` persona externusId), or null. Injected. */
  verifyApiKeyToAccountId?: (apiKey: string) => Promise<string | null>
  /** Verify a web3 sig bundle → the signer address, or null. Injected. */
  verifyWeb3ToAddress?: (w: { address: string; signature: string; nonce: string }) => Promise<string | null>
}

/** Find the anima behind a VERIFIED external identity, or mint one on first sight. */
async function resolveOrCreateAnima(
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
  const { personae, animae, jwtSecret, verifyApiKeyToAccountId, verifyWeb3ToAddress } = deps
  return {
    verifyJwt: jwtSecret
      ? async (token: string): Promise<string | null> => {
          let payload: JwtPayload | string
          try {
            payload = jwt.verify(token, jwtSecret)
          } catch {
            return null
          }
          if (typeof payload === 'string') return null
          const ext = payload.userId ?? payload.sub ?? payload._id ?? payload.id
          if (!ext) return null
          return resolveOrCreateAnima(personae, animae, 'web', String(ext))
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
