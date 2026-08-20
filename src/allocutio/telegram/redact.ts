/**
 * Outbound text normalisation — the last thing every Telegram message passes through.
 *
 * Some values that flow through a run are platform plumbing rather than anything a
 * reader should see: a file link resolved from `getFileLink()` is a transport detail,
 * carries credentials by construction, and means nothing to the person reading the
 * chat. Normalising at the sender means a surface renders such a value as what it is
 * ("(image)") without every surface having to remember to.
 */

/** `https://api.telegram.org/file/bot<id>:<secret>/...` (and the non-`file/` API form). */
const TELEGRAM_TOKEN_URL = /https?:\/\/api\.telegram\.org\/(?:file\/)?bot\d+:[A-Za-z0-9_-]+\S*/gi

/** A bare `<id>:<secret>` bot token anywhere in the text. */
const BARE_BOT_TOKEN = /\b\d{6,}:[A-Za-z0-9_-]{30,}\b/g

/**
 * Replace any Telegram bot token — and the file URLs that embed one — with a
 * harmless placeholder. Returns the text unchanged when there is nothing to scrub.
 */
export function redactSecrets(text: string): string
export function redactSecrets(text: undefined): undefined
export function redactSecrets(text: string | undefined): string | undefined
export function redactSecrets(text: string | undefined): string | undefined {
  if (typeof text !== 'string' || text.length === 0) return text
  let out = text.replace(TELEGRAM_TOKEN_URL, '(image)')
  const token = process.env.BOT_TOKEN
  if (token && token.length > 10 && out.includes(token)) out = out.split(token).join('***')
  return out.replace(BARE_BOT_TOKEN, '***')
}

/**
 * Scrub the caption carried in a send/edit `extra` object, leaving every other
 * field (keyboards, parse mode, reply targets) untouched.
 */
export function redactExtra<T>(extra: T): T {
  if (!extra || typeof extra !== 'object') return extra
  const withCaption = extra as { caption?: unknown }
  if (typeof withCaption.caption !== 'string') return extra
  const scrubbed = redactSecrets(withCaption.caption)
  if (scrubbed === withCaption.caption) return extra
  return { ...(extra as object), caption: scrubbed } as T
}
