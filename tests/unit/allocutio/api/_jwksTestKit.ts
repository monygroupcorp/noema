// Shared hermetic kit for the federated-JWKS tests: a real P-256 keypair, an
// ES256 token signer, and a fake `JwksFetch` serving the public JWK. No network.
import { generateKeyPairSync } from 'node:crypto'
import jwt from 'jsonwebtoken'
import type { JwksFetch, JwksResponse } from '../../../../src/allocutio/api/AgentJwtVerifier.js'

export const ISS = 'https://camelcabal.fun'
export const JWKS_URL = 'https://camelcabal.fun/.well-known/jwks.json'

export interface KeyKit {
  privatePem: string
  jwk: Record<string, unknown>   // public JWK with kid/alg/use
  kid: string
}

/** Generate a P-256 keypair and export the public half as a JWK with a kid. */
export function makeKey(kid = 'key-1'): KeyKit {
  const { publicKey, privateKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' })
  const jwk = publicKey.export({ format: 'jwk' }) as Record<string, unknown>
  jwk.kid = kid
  jwk.alg = 'ES256'
  jwk.use = 'sig'
  const privatePem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString()
  return { privatePem, jwk, kid }
}

/** The canonical camel404 assertion payload shape (§8 of ADR-0011). */
export function camelClaims(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    iss: ISS,
    aud: 'noema.art',
    sub: 'agent:1:0xADAPTER:camel42',
    agentId: 'camel42',
    tokenId: '42',
    owner_at_assertion: '0x' + 'a'.repeat(40),
    scope: ['generate'],
    exp: Math.floor(Date.now() / 1000) + 600,
    ...over,
  }
}

/** Sign an ES256 token with the kit's private key + kid. */
export function signES256(kit: KeyKit, claims: Record<string, unknown>): string {
  return jwt.sign(claims, kit.privatePem, { algorithm: 'ES256', keyid: kit.kid })
}

/** A JwksFetch stub serving `{ keys }`, counting calls and letting a test flip the keyset. */
export function fakeJwksFetch(opts: {
  keys: () => Record<string, unknown>[]
  cacheControl?: string
  fail?: () => { throwErr?: string; status?: number } | undefined
}): { fetchFn: JwksFetch; calls: () => number; urls: () => string[] } {
  let n = 0
  const urls: string[] = []
  const fetchFn: JwksFetch = async (url: string): Promise<JwksResponse> => {
    n++
    urls.push(url)
    const f = opts.fail?.()
    if (f?.throwErr) throw new Error(f.throwErr)
    const status = f?.status ?? 200
    return {
      ok: status >= 200 && status < 300,
      status,
      statusText: status === 200 ? 'OK' : 'ERR',
      json: async () => ({ keys: opts.keys() }),
      headers: { get: (name: string) => (name.toLowerCase() === 'cache-control' ? (opts.cacheControl ?? null) : null) },
    }
  }
  return { fetchFn, calls: () => n, urls: () => urls }
}
