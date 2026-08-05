// =============================================================================
// jobToken — a per-job pod credential (BYO-secrets Phase C, "C0").
// =============================================================================
// The seam that lets a pod authenticate a callback *as a specific job* without
// any server-side binding table. It is a SELF-VERIFYING HMAC token: the claims
// (`{ actumId, ownerKey, exp }`) travel in the token body and are signed with a
// server-only secret. Verification recomputes the signature and checks expiry —
// no DB lookup, nothing to store, nothing to garbage-collect. That is the
// crystal reduction of "invent a per-job credential": the token IS the binding.
//
// Today its sole consumer is the weight-download proxy (`/internal/weights/:id`,
// C1): the pod presents `Authorization: Bearer <jobToken>`; the proxy verifies
// it, reads `ownerKey` from the claims, and streams the owner's gated weights
// through with their BYO token attached. The same primitive can later
// authenticate the currently-unauthenticated `/runner/*` callbacks.
//
// Format: `<b64url(payloadJSON)>.<b64url(hmac-sha256)>`. Compact, urlsafe, no deps.
// The secret comes from `JOB_TOKEN_SECRET` (feature-gate: absent → no minting,
// and the proxy declines — the gated-weight path stays dark, matching house style).
// =============================================================================

import { createHmac, timingSafeEqual } from 'node:crypto'

/** Claims bound into a job token. `exp` is epoch-millis (compared against a clock). */
export interface JobTokenClaims {
  /** The Actum this token authorizes — the run whose pod holds it. */
  actumId: string
  /** Stable owner key (`ownerKeyOf(auctor)`) — who the pod may fetch private weights as. */
  ownerKey: string
  /** Absolute expiry, epoch-millis. A verify past this returns null. */
  exp: number
}

function b64urlEncode(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function b64urlDecode(s: string): Buffer {
  const pad = s.length % 4 === 0 ? '' : '='.repeat(4 - (s.length % 4))
  return Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/') + pad, 'base64')
}

function sign(secret: string, payloadB64: string): Buffer {
  return createHmac('sha256', secret).update(payloadB64).digest()
}

/**
 * Mint a signed, self-verifying job token. The claims are readable to anyone who
 * holds the token (they are only b64url, not encrypted) but cannot be forged
 * without the secret. Never mint with a secret you would not also verify with.
 */
export function mintJobToken(secret: string, claims: JobTokenClaims): string {
  const payloadB64 = b64urlEncode(Buffer.from(JSON.stringify(claims), 'utf8'))
  const sigB64 = b64urlEncode(sign(secret, payloadB64))
  return `${payloadB64}.${sigB64}`
}

/**
 * Verify a job token and return its claims, or null if it is malformed, the
 * signature does not match `secret`, or it has expired (`exp <= now`). Signature
 * comparison is constant-time. `now` is injected for hermetic tests (defaults to
 * wall-clock).
 */
export function verifyJobToken(
  secret: string,
  token: string,
  now: number = Date.now(),
): JobTokenClaims | null {
  const dot = token.indexOf('.')
  if (dot <= 0 || dot === token.length - 1) return null
  const payloadB64 = token.slice(0, dot)
  const sigB64 = token.slice(dot + 1)

  const expected = sign(secret, payloadB64)
  let given: Buffer
  try {
    given = b64urlDecode(sigB64)
  } catch {
    return null
  }
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null

  let claims: JobTokenClaims
  try {
    claims = JSON.parse(b64urlDecode(payloadB64).toString('utf8')) as JobTokenClaims
  } catch {
    return null
  }
  if (
    !claims || typeof claims.actumId !== 'string' || typeof claims.ownerKey !== 'string' ||
    typeof claims.exp !== 'number'
  ) return null
  if (claims.exp <= now) return null
  return claims
}
