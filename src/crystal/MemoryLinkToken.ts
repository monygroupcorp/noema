// =============================================================================
// MemoryLinkToken — in-memory one-time link/recovery codes for tests/dev.
// =============================================================================
//
// Same semantics as MongoLinkToken (hash-keyed, single-use, TTL) without Mongo.
// =============================================================================

import { type LinkTokenStore, type LinkTokenKind } from '../types/linkToken.js'
import { makeLinkToken, hashLinkToken } from './sessionToken.js'

interface Row { animaId: string; kind: LinkTokenKind; expiresAt: number }

export class MemoryLinkToken implements LinkTokenStore {
  private readonly byHash = new Map<string, Row>()

  constructor(private readonly now: () => Date = () => new Date()) {}

  async issue(animaId: string, kind: LinkTokenKind, ttlSeconds: number): Promise<string> {
    const { plaintext, hash } = makeLinkToken()
    this.byHash.set(hash, { animaId, kind, expiresAt: this.now().getTime() + ttlSeconds * 1000 })
    return plaintext
  }

  async consume(code: string, kind: LinkTokenKind): Promise<string | null> {
    const hash = hashLinkToken(code)
    const row = this.byHash.get(hash)
    if (!row || row.kind !== kind) return null
    this.byHash.delete(hash)   // single-use
    if (row.expiresAt <= this.now().getTime()) return null
    return row.animaId
  }
}
