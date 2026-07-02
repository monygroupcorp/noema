// =============================================================================
// sessionToken — mint / verify the fiat-auth session JWT + one-time link tokens.
// =============================================================================
//
// A session is a bearer JWT signed with `JWT_SECRET` (HS256). CRITICAL (the
// same-Anima trap, docs/spec/fiat-auth.md §trap): the token carries the resolved
// `animaId` DIRECTLY in `sub` under `typ:'session'`. `apiAcceptors.verifyJwt` special-
// cases `typ:'session'` to return `sub` as-is (no `'web'`-genus re-resolution), so
// login and every subsequent `/v1` request land on the ONE anima the `'password'`
// persona established. Mint and accept MUST agree on this shape.
// =============================================================================

import jwt from 'jsonwebtoken'
import { randomBytes, createHash } from 'node:crypto'

export const SESSION_TYP = 'session' as const

/** Default session lifetime (seconds) — 7 days. Override via `SESSION_TTL_SECONDS`. */
export const DEFAULT_SESSION_TTL_SECONDS = 7 * 24 * 60 * 60

export interface Session {
  token: string
  tokenType: 'Bearer'
  /** Lifetime in seconds. */
  expiresIn: number
}

/** Mint a session bearer token for `animaId`. */
export function mintSession(animaId: string, jwtSecret: string, ttlSeconds = DEFAULT_SESSION_TTL_SECONDS): Session {
  const token = jwt.sign({ sub: animaId, typ: SESSION_TYP }, jwtSecret, { expiresIn: ttlSeconds })
  return { token, tokenType: 'Bearer', expiresIn: ttlSeconds }
}

/** Verify a session token → its `animaId`, or `null` if invalid/expired/not a session. */
export function readSession(token: string, jwtSecret: string): string | null {
  try {
    const payload = jwt.verify(token, jwtSecret)
    if (typeof payload === 'string') return null
    if (payload.typ !== SESSION_TYP) return null
    return typeof payload.sub === 'string' ? payload.sub : null
  } catch {
    return null
  }
}

/** A single-use email link token: the plaintext (goes in the email) + its stored SHA-256 hash. */
export interface LinkToken {
  plaintext: string
  hash: string
}

/** Generate a 256-bit URL-safe token and its SHA-256 hash (what the store persists). */
export function makeLinkToken(): LinkToken {
  const plaintext = randomBytes(32).toString('base64url')
  return { plaintext, hash: hashLinkToken(plaintext) }
}

/** Hash a presented link token the same way, to look up its row. */
export function hashLinkToken(plaintext: string): string {
  return createHash('sha256').update(plaintext).digest('hex')
}
