// =============================================================================
// telegramWebAppAuth — verify the identity Telegram signs into a Mini App launch
// =============================================================================
//
// When the bot opens a page as a Mini App (an inline `web_app` button), Telegram hands the page
// `initData`: a query string carrying the user, an `auth_date` and a `hash`. The hash is an
// HMAC-SHA256 over the other fields, keyed by HMAC-SHA256("WebAppData", <bot token>), so only
// Telegram and this server can produce it. A valid one proves which Telegram user opened the
// page, with no code for anyone to paste and nothing secret in a link.
//
// https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app
//
// Pure: no I/O. Freshness is bounded by `auth_date`; that a given payload is redeemed only
// once is the caller's job (the auth router claims its hash in the link-token store).
// =============================================================================

import { createHmac, timingSafeEqual } from 'node:crypto'

export type WebAppInitDataVerdict =
  | { ok: true; telegramUserId: string; hash: string }
  | { ok: false; reason: 'malformed' | 'bad_hash' | 'expired' | 'no_user' }

/** Seconds a launch may run ahead of this server's clock before it reads as forged. */
export const CLOCK_SKEW_SECONDS = 60

export function verifyWebAppInitData(
  initData: string,
  botToken: string,
  opts: { now: Date; maxAgeSeconds: number },
): WebAppInitDataVerdict {
  if (!initData || !botToken) return { ok: false, reason: 'malformed' }

  const params = new URLSearchParams(initData)
  const fields = new Map<string, string>()
  for (const [key, value] of params) {
    // A repeated key has no single value to sign; Telegram never sends one.
    if (fields.has(key)) return { ok: false, reason: 'malformed' }
    fields.set(key, value)
  }
  const hash = fields.get('hash')
  if (!hash || !/^[0-9a-f]{64}$/.test(hash)) return { ok: false, reason: 'malformed' }
  fields.delete('hash')

  const checkString = [...fields.keys()].sort().map(k => `${k}=${fields.get(k)}`).join('\n')
  const secret = createHmac('sha256', 'WebAppData').update(botToken).digest()
  const expected = createHmac('sha256', secret).update(checkString).digest()
  if (!timingSafeEqual(expected, Buffer.from(hash, 'hex'))) return { ok: false, reason: 'bad_hash' }

  const authDate = Number(fields.get('auth_date'))
  if (!Number.isInteger(authDate) || authDate <= 0) return { ok: false, reason: 'malformed' }
  const ageSeconds = Math.floor(opts.now.getTime() / 1000) - authDate
  if (ageSeconds > opts.maxAgeSeconds || ageSeconds < -CLOCK_SKEW_SECONDS) return { ok: false, reason: 'expired' }

  let id: unknown
  try {
    id = (JSON.parse(fields.get('user') ?? 'null') as { id?: unknown } | null)?.id
  } catch {
    return { ok: false, reason: 'malformed' }
  }
  if (typeof id !== 'number' || !Number.isSafeInteger(id) || id <= 0) return { ok: false, reason: 'no_user' }

  return { ok: true, telegramUserId: String(id), hash }
}
