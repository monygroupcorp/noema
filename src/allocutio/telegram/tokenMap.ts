import { randomBytes } from 'node:crypto'

/**
 * TokenMap — maps short random tokens to arbitrary session keys.
 * Tokens are 8 hex chars (4 bytes). Collision probability negligible
 * for the number of concurrent live sessions.
 */
export class TokenMap {
  private readonly map = new Map<string, string>()

  /** Store a session key, return an 8-char token. */
  encode(sessionKey: string): string {
    const token = randomBytes(4).toString('hex')
    this.map.set(token, sessionKey)
    return token
  }

  /** Retrieve the session key for a token. Returns null if unknown/expired. */
  decode(token: string): string | null {
    return this.map.get(token) ?? null
  }

  /** Remove a token after it has been used or session expires. */
  revoke(token: string): void {
    this.map.delete(token)
  }
}
