// =============================================================================
// LinkTokenStore — short-lived one-time codes that bridge web ⇆ Telegram bot.
// =============================================================================
//
// The Telegram backup/recovery channel can't use a stateless JWT: the bot deep-link
// `/start` payload is length-limited (≤64 chars, `[A-Za-z0-9_-]`), too small for a JWT.
// So a random opaque code is minted, its SHA-256 stored here with a short TTL, and looked
// up (single-use) when redeemed. Two directions, distinguished by `kind`:
//   • 'tg-link'    — WEB (authed) mints → BOT redeems on `/start link_<code>`, re-pointing
//                    the Telegram persona at the web account's soul.
//   • 'tg-recover' — BOT mints (on /recover) → WEB redeems, minting a session (forgot-password).
//
// Only the hash is stored (a dump never yields a usable code); redemption deletes the row.
// =============================================================================

export type LinkTokenKind = 'tg-link' | 'tg-recover'

export interface LinkTokenStore {
  /** Mint a one-time code bound to `animaId`; returns the plaintext code (store keeps only its hash). */
  issue(animaId: string, kind: LinkTokenKind, ttlSeconds: number): Promise<string>
  /** Redeem a code (single-use) → the bound `animaId`, or `null` if unknown/expired/wrong-kind. */
  consume(code: string, kind: LinkTokenKind): Promise<string | null>
}
