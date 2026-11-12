import { timingSafeEqual } from 'node:crypto'

/**
 * Constant-time check of an `x-internal-secret` header value against the configured secret.
 * Header-only by design: a query-string credential lands in access logs, browser history and
 * the Referer header, so there is no query fallback here (mirrors `jobToken.ts`'s pattern).
 */
export function internalSecretMatches(secret: string | undefined, header: unknown): boolean {
  if (!secret || typeof header !== 'string') return false
  const expected = Buffer.from(secret, 'utf8')
  const provided = Buffer.from(header, 'utf8')
  return expected.length === provided.length && timingSafeEqual(expected, provided)
}
