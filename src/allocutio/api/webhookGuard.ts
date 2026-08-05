// =============================================================================
// webhookGuard — block SSRF via a caller-supplied `webhookUrl`.
// =============================================================================
//
// `options.webhookUrl` is attacker-controlled (the API caller). The server POSTs
// the terminal run event to it, so without a guard a caller could aim it at
// internal services (cloud metadata 169.254.169.254, localhost, private ranges)
// and use the server as a request origin. This permits only `https:` to a public
// host. NOTE: it does NOT defeat DNS-rebinding (a public name resolving to a
// private IP) — full protection requires checking the resolved address at connect
// time; this is the pragmatic literal-range guard.

const PRIVATE_V4: RegExp[] = [
  /^0\./,            // "this" network / unspecified
  /^10\./,           // RFC1918
  /^127\./,          // loopback
  /^169\.254\./,     // link-local (incl. cloud metadata 169.254.169.254)
  /^192\.168\./,     // RFC1918
  /^172\.(1[6-9]|2\d|3[01])\./, // RFC1918 172.16.0.0/12
]

/** True iff `raw` is a safe public https webhook target. */
export function isSafeWebhookUrl(raw: string): boolean {
  let u: URL
  try {
    u = new URL(raw)
  } catch {
    return false
  }
  if (u.protocol !== 'https:') return false

  let host = u.hostname.toLowerCase()
  if (!host || host === 'localhost' || host.endsWith('.localhost')) return false

  // IPv6 literal — URL.hostname keeps the brackets (`[::1]`); strip them. Reject
  // loopback / unspecified / unique-local (fc00::/7) / link-local (fe80::/10).
  if (host.startsWith('[') && host.endsWith(']')) host = host.slice(1, -1)
  if (host === '::1' || host === '::' || host.startsWith('fc') || host.startsWith('fd') || host.startsWith('fe80:')) {
    return false
  }

  // IPv4 literal in a private/loopback/link-local range.
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) {
    return !PRIVATE_V4.some((re) => re.test(host))
  }

  return true
}
