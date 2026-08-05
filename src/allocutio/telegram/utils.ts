/**
 * Escape all Telegram MarkdownV2 special characters.
 * Must be applied to every user-supplied or DB-sourced string
 * before embedding in a MarkdownV2 message.
 * Content inside backtick code spans does NOT need this.
 */
export function escapeMarkdownV2(text: string): string {
  // Official special chars per Telegram Bot API docs:
  return text.replace(/[_*[\]()~`>#+\-=|{}.!\\]/g, '\\$&')
}

/**
 * Format a wallet address for display: first 6 + last 4 chars.
 * "0xDEADBEEF...BEEF" — always 12 visible chars + ellipsis.
 */
export function abbreviateAddress(address: string): string {
  return address.slice(0, 6) + '...' + address.slice(-4)
}
